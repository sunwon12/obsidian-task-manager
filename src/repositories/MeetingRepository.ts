// LLD §5.4: MeetingRepository.
// TaskRepository와 동일 패턴이지만 archive/status 없음.

import { TFile, TFolder, normalizePath, type App } from "obsidian";
import type { DiagnosticsLog } from "../core/diagnostics";
import { ulidOf } from "../core/ids";
import { joinPath, safeTitle } from "../core/paths";
import { laterOf } from "../core/time";
import { parseMeeting, serializeMeeting } from "../parser/meetingMarkdown";
import type { Meeting, MeetingId } from "../core/types";

const RETRY_MAX = 3;
const RETRY_BASE_MS = 100;
const SHORT_ID_RE = /(meeting_[0-9A-HJKMNP-TV-Z]+)\.md$/;

export class MeetingRepository {
  private readonly pendingSaves = new Map<MeetingId, Meeting>();
  private flushInFlight: Promise<void> | null = null;
  private readonly pathById = new Map<MeetingId, string>();
  private readonly shortIds = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly diagnostics: DiagnosticsLog,
    private readonly meetingsFolder: string,
  ) {}

  async findAll(): Promise<Meeting[]> {
    this.shortIds.clear();
    this.pathById.clear();

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(this.meetingsFolder + "/"));

    const meetings: Meeting[] = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.["type"] !== "meeting") continue;

      try {
        const raw = await this.app.vault.cachedRead(file);
        const parsed = parseMeeting(raw);
        if (!parsed) {
          this.diagnostics.record({
            kind: "parse",
            path: file.path,
            message: "schema validation failed",
          });
          continue;
        }
        const m: Meeting = {
          ...parsed.meeting,
          knownMtime: file.stat.mtime,
          path: file.path,
        };
        meetings.push(m);
        this.pathById.set(m.id, file.path);
        const short = this.shortIdOfPath(file.path);
        if (short) this.shortIds.add(short);
      } catch (err) {
        this.diagnostics.record({
          kind: "parse",
          path: file.path,
          message: "parse error",
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return meetings;
  }

  async create(meeting: Meeting, body: string): Promise<Meeting> {
    await this.ensureFolderExists(this.meetingsFolder);
    const path = await this.allocatePath(meeting);
    const draft: Meeting = { ...meeting, path, knownMtime: 0 };
    await this.app.vault.create(path, serializeMeeting(draft, body));
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`create failed: ${path}`);

    const persisted: Meeting = { ...meeting, path, knownMtime: file.stat.mtime };
    this.pathById.set(meeting.id, path);
    const short = this.shortIdOfPath(path);
    if (short) this.shortIds.add(short);
    return persisted;
  }

  async saveImmediate(meeting: Meeting): Promise<void> {
    this.pendingSaves.set(meeting.id, meeting);
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    if (this.pendingSaves.size === 0) return;

    const batch = Array.from(this.pendingSaves.values());
    this.pendingSaves.clear();

    this.flushInFlight = this.runBatch(batch).finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  private async runBatch(batch: Meeting[]): Promise<void> {
    for (const m of batch) {
      try {
        await this.persistWithRetry(m);
      } catch (err) {
        this.diagnostics.record({
          kind: "flush",
          entityId: m.id,
          path: m.path,
          message: "persist failed after retries",
          cause: err instanceof Error ? err.message : String(err),
        });
        this.pendingSaves.set(m.id, m);
      }
    }
  }

  private async persistWithRetry(m: Meeting): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
      try {
        await this.persist(m);
        return;
      } catch (err) {
        lastErr = err;
        await sleep(RETRY_BASE_MS * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  private async persist(m: Meeting): Promise<void> {
    const file = this.fileOf(m.id);
    const currentRaw = await this.app.vault.read(file);
    if (file.stat.mtime > m.knownMtime) {
      const external = parseMeeting(currentRaw);
      if (external) {
        const merged: Meeting = {
          ...m,
          passthrough: external.meeting.passthrough,
          fieldOrder: external.meeting.fieldOrder,
          updatedAt: laterOf(m.updatedAt, external.meeting.updatedAt),
        };
        const body = stripFrontmatter(currentRaw);
        await this.app.vault.modify(file, serializeMeeting(merged, body));
        this.diagnostics.record({
          kind: "conflict",
          entityId: m.id,
          path: file.path,
          message: "meeting external change merged",
        });
        return;
      }
      // 외부가 unparseable → conflicted copy
      const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
      const newPath = m.path.replace(/\.md$/, ` - conflict ${stamp}.md`);
      await this.app.vault.create(newPath, serializeMeeting({ ...m, path: newPath }, ""));
      this.diagnostics.record({
        kind: "conflict",
        entityId: m.id,
        path: file.path,
        message: "meeting external change unparseable; wrote conflicted copy",
      });
      return;
    }
    const body = stripFrontmatter(currentRaw);
    await this.app.vault.modify(file, serializeMeeting(m, body));
  }

  async delete(meetingId: MeetingId): Promise<void> {
    const file = this.fileOf(meetingId);
    await this.app.vault.trash(file, true);
    this.pathById.delete(meetingId);
    const short = this.shortIdOfPath(file.path);
    if (short) this.shortIds.delete(short);
  }

  getKnownPath(id: MeetingId): string | undefined {
    return this.pathById.get(id);
  }

  private fileOf(id: MeetingId): TFile {
    const path = this.pathById.get(id);
    if (!path) throw new Error(`Unknown meeting id: ${id}`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Missing file: ${path}`);
    return file;
  }

  private async allocatePath(m: Meeting): Promise<string> {
    const safe = safeTitle(m.title || "untitled");
    const ulidPart = ulidOf(m.id);
    for (let len = 8; len <= 26; len++) {
      const short = `meeting_${ulidPart.slice(0, len)}`;
      if (this.shortIds.has(short)) continue;
      const path = normalizePath(joinPath(this.meetingsFolder, `${safe} - ${short}.md`));
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
    }
    throw new Error(`path allocation exhausted for ${m.id}`);
  }

  private shortIdOfPath(path: string): string {
    const match = path.match(SHORT_ID_RE);
    return match && match[1] ? match[1] : "";
  }

  private async ensureFolderExists(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;
    if (existing) return;
    await this.app.vault.createFolder(path);
  }
}

function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return m ? (m[1] ?? "") : raw;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
