// LLD §5.2: TaskRepository.
// ADR-0004(immediate vs debounced), 0005(metadataCache), 0008(passthrough) 모두 구현.
//
// 책임:
// - findAll: metadataCache 우선 스캔, schema 위반 파일은 diagnostics 기록 후 skip
// - create: safeTitle + short ID로 path 할당
// - saveImmediate: 의미 데이터 즉시 flush (debounce 없음)
// - queueSave + flush: 시각/high-frequency 변경용, 동시성 안전
// - persist: mtime conflict 검사 + passthrough 보존
// - handleConflict: field merge 시도 → 실패 시 conflicted copy
// - archive: rename + archivedAt 추가 (saveImmediate)
// - delete: vault.trash (시스템 휴지통)

import { TFile, TFolder, normalizePath, type App } from "obsidian";
import type { DiagnosticsLog } from "../core/diagnostics";
import { makeShortId, ulidOf } from "../core/ids";
import { joinPath, safeTitle } from "../core/paths";
import { laterOf, nowIso } from "../core/time";
import { parseTask, serializeTask } from "../parser/taskMarkdown";
import type { Task, TaskId } from "../core/types";

const RETRY_MAX = 3;
const RETRY_BASE_MS = 100;
const SHORT_ID_RE = /(task_[0-9A-HJKMNP-TV-Z]+)\.md$/;

export class TaskRepository {
  private readonly pendingSaves = new Map<TaskId, Task>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight: Promise<void> | null = null;
  private readonly pathById = new Map<TaskId, string>();
  private readonly shortIds = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly diagnostics: DiagnosticsLog,
    private readonly debounceMs: number,
    private readonly tasksFolder: string,
    private readonly archiveFolder: string,
  ) {}

  // ---------- Read (T-202) ----------

  async findAll(): Promise<Task[]> {
    this.shortIds.clear();
    this.pathById.clear();

    const files = this.app.vault
      .getMarkdownFiles()
      .filter(
        (f) =>
          f.path.startsWith(this.tasksFolder + "/") ||
          f.path.startsWith(this.archiveFolder + "/"),
      );

    const tasks: Task[] = [];

    for (const file of files) {
      // 부팅 직후엔 metadataCache가 아직 이 파일을 인덱싱하지 못했을 수 있다
      // (특히 plugin 외부에서 디스크에 직접 생성된 파일). 캐시 미존재를 "task 아님"으로
      // 오판해 조용히 skip하면 그 파일은 재스캔 경로가 없어 세션 내내 유실된다.
      // 캐시가 있을 때만 type 사전필터로 쓰고, 없으면 raw 파싱으로 판별한다.
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && fm["type"] !== "task") continue;

      try {
        const raw = await this.app.vault.cachedRead(file);
        const parsed = parseTask(raw);
        if (!parsed) {
          this.diagnostics.record({
            kind: "parse",
            path: file.path,
            message: "schema validation failed",
          });
          continue;
        }
        const task: Task = {
          ...parsed.task,
          knownMtime: file.stat.mtime,
          path: file.path,
        };
        tasks.push(task);
        this.pathById.set(task.id, file.path);
        const short = this.shortIdOfPath(file.path);
        if (short) this.shortIds.add(short);
      } catch (err) {
        this.diagnostics.record({
          kind: "parse",
          path: file.path,
          message: "parse error",
          cause: stringifyError(err),
        });
      }
    }
    return tasks;
  }

  async readBody(taskId: TaskId): Promise<string> {
    const file = this.fileOf(taskId);
    const raw = await this.app.vault.cachedRead(file);
    const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
    return match ? (match[1] ?? "") : raw;
  }

  // ---------- Create (T-203) ----------

  async create(task: Task, body: string): Promise<Task> {
    await this.ensureFolderExists(this.tasksFolder);
    const path = await this.allocatePath(task);
    const persistedDraft: Task = { ...task, path, knownMtime: 0 };
    const content = serializeTask(persistedDraft, body);
    await this.app.vault.create(path, content);

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`create failed: ${path}`);
    }

    const persisted: Task = { ...task, path, knownMtime: file.stat.mtime };
    this.pathById.set(task.id, path);
    const short = this.shortIdOfPath(path);
    if (short) this.shortIds.add(short);
    return persisted;
  }

  // ---------- Write (T-204) ----------

  /**
   * 의미 데이터 변경. 즉시 디스크 반영. ADR-0004.
   */
  async saveImmediate(task: Task): Promise<void> {
    this.pendingSaves.set(task.id, task);
    await this.flush();
  }

  /**
   * Phase 1에서 거의 사용 안 함 (Phase 2 inline body 편집 등에 대비).
   */
  queueSave(task: Task): void {
    this.pendingSaves.set(task.id, task);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  /** 동시 호출 안전. 진행 중이면 같은 promise 공유. */
  async flush(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    if (this.pendingSaves.size === 0) return;

    const batch = Array.from(this.pendingSaves.values());
    this.pendingSaves.clear();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    this.flushInFlight = this.runBatch(batch).finally(() => {
      this.flushInFlight = null;
      if (this.pendingSaves.size > 0) this.scheduleFlush();
    });
    return this.flushInFlight;
  }

  private async runBatch(batch: Task[]): Promise<void> {
    const failures: Task[] = [];
    for (const task of batch) {
      try {
        await this.persistWithRetry(task);
      } catch (err) {
        failures.push(task);
        this.diagnostics.record({
          kind: "flush",
          entityId: task.id,
          path: task.path,
          message: "persist failed after retries",
          cause: stringifyError(err),
        });
      }
    }
    // 실패는 다음 사이클 retry queue로 환원.
    for (const t of failures) this.pendingSaves.set(t.id, t);
  }

  private async persistWithRetry(task: Task): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
      try {
        await this.persist(task);
        return;
      } catch (err) {
        lastErr = err;
        await sleep(RETRY_BASE_MS * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  // ---------- Persist + conflict (T-205) ----------

  private async persist(task: Task): Promise<void> {
    const file = this.fileOf(task.id);

    // ADR-0005: conflict-sensitive read는 vault.read()로 disk 직접.
    const currentRaw = await this.app.vault.read(file);
    const currentMtime = file.stat.mtime;

    if (currentMtime > task.knownMtime) {
      await this.handleConflict(task, file, currentRaw, currentMtime);
      return;
    }

    const body = stripFrontmatter(currentRaw);
    const next = serializeTask(task, body);
    await this.app.vault.modify(file, next);
  }

  private async handleConflict(
    task: Task,
    file: TFile,
    currentRaw: string,
    _currentMtime: number,
  ): Promise<void> {
    const external = parseTask(currentRaw);
    if (!external) {
      await this.writeConflictedCopy(task);
      this.diagnostics.record({
        kind: "conflict",
        entityId: task.id,
        path: file.path,
        message: "external change is unparseable; wrote conflicted copy",
      });
      return;
    }

    // 단순 merge: 우리 의도가 우선이지만 외부 passthrough/fieldOrder는 보존.
    const mergedTags = task.tags?.length ? task.tags : external.task.tags;
    const merged: Task = {
      ...task,
      // 아직 태그를 갖지 않은 stale card에는 외부 Markdown에서 새로 추가한 태그를 보존한다.
      ...(mergedTags ? { tags: mergedTags } : {}),
      passthrough: external.task.passthrough,
      fieldOrder: external.task.fieldOrder,
      updatedAt: laterOf(task.updatedAt, external.task.updatedAt),
    };
    const body = stripFrontmatter(currentRaw);
    await this.app.vault.modify(file, serializeTask(merged, body));

    this.diagnostics.record({
      kind: "conflict",
      entityId: task.id,
      path: file.path,
      message: "external change merged with passthrough preserved",
    });
  }

  private async writeConflictedCopy(task: Task): Promise<void> {
    const stamp = nowIso().replace(/[-:.]/g, "").slice(0, 15);
    const newPath = task.path.replace(/\.md$/, ` - conflict ${stamp}.md`);
    const body = stripFrontmatter(
      await this.app.vault.read(this.fileOf(task.id)),
    );
    const newTask: Task = { ...task, path: newPath };
    await this.app.vault.create(newPath, serializeTask(newTask, body));
  }

  // ---------- Lifecycle (T-206) ----------

  /** Vault 시스템 휴지통으로 이동. */
  async delete(taskId: TaskId): Promise<void> {
    const file = this.fileOf(taskId);
    await this.app.vault.trash(file, true);
    this.pathById.delete(taskId);
    const short = this.shortIdOfPath(file.path);
    if (short) this.shortIds.delete(short);
  }

  /** Archive 폴더로 이동 + archivedAt 추가. */
  async archive(task: Task): Promise<Task> {
    await this.ensureFolderExists(this.archiveFolder);
    const file = this.fileOf(task.id);
    const newPath = joinPath(this.archiveFolder, file.name);
    await this.app.fileManager.renameFile(file, newPath);

    const archived: Task = {
      ...task,
      path: newPath,
      archivedAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.pathById.set(task.id, newPath);
    await this.saveImmediate(archived);
    // saveImmediate는 mtime 체크를 위해 file을 다시 읽으므로 path 갱신 후 호출.
    return archived;
  }

  /** Archive 폴더에서 활성 Tasks 폴더로 복원한다. */
  async restore(task: Task): Promise<Task> {
    await this.ensureFolderExists(this.tasksFolder);
    const file = this.fileOf(task.id);
    const newPath = joinPath(this.tasksFolder, file.name);
    await this.app.fileManager.renameFile(file, newPath);

    const restored: Task = {
      ...task,
      path: newPath,
      archivedAt: null,
      updatedAt: nowIso(),
    };
    this.pathById.set(task.id, newPath);
    await this.saveImmediate(restored);
    return restored;
  }

  // ---------- Helpers ----------

  /** Test/IndexService에서 외부 modify event를 처리할 때 path 갱신. */
  updatePath(taskId: TaskId, newPath: string): void {
    const oldPath = this.pathById.get(taskId);
    if (oldPath) {
      const oldShort = this.shortIdOfPath(oldPath);
      if (oldShort) this.shortIds.delete(oldShort);
    }
    this.pathById.set(taskId, newPath);
    const short = this.shortIdOfPath(newPath);
    if (short) this.shortIds.add(short);
  }

  /** Test helper: 현재 추적 중인 path 인덱스 (read-only). */
  getKnownPath(taskId: TaskId): string | undefined {
    return this.pathById.get(taskId);
  }

  private fileOf(taskId: TaskId): TFile {
    const path = this.pathById.get(taskId);
    if (!path) throw new Error(`Unknown task id: ${taskId}`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Missing file: ${path}`);
    return file;
  }

  private async allocatePath(task: Task): Promise<string> {
    const safe = safeTitle(task.title || "untitled");
    const ulidPart = ulidOf(task.id);

    for (let len = 8; len <= 26; len++) {
      const short = `task_${ulidPart.slice(0, len)}`;
      if (this.shortIds.has(short)) continue;
      const path = normalizePath(joinPath(this.tasksFolder, `${safe} - ${short}.md`));
      if (!this.app.vault.getAbstractFileByPath(path)) {
        return path;
      }
    }
    // fallback: makeShortId가 throw할 거리.
    void makeShortId(task.id, this.shortIds);
    throw new Error(`path allocation exhausted for ${task.id}`);
  }

  private shortIdOfPath(path: string): string {
    const m = path.match(SHORT_ID_RE);
    return m && m[1] ? m[1] : "";
  }

  private async ensureFolderExists(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;
    if (existing) return; // 다른 파일이 path를 점유한 비정상 상태는 호출자가 다룸.
    try {
      await this.app.vault.createFolder(path);
    } catch (err) {
      // vault 인덱스가 늦게 차는 부팅 직후, 디스크에 실존하는 폴더에 대해
      // createFolder 가 "already exists"를 던질 수 있다 — 정상으로 취급.
      // 이 경로는 Jira 동기화의 태스크 생성에서도 지나가므로(2026-08-08 실사고:
      // "Jira sync failed: Folder already exists") 삼키지 않으면 동기화가 죽는다.
      const message = err instanceof Error ? err.message : String(err);
      if (!/already exists/iu.test(message)) throw err;
    }
  }
}

// ---------- Pure helpers ----------

function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return m ? (m[1] ?? "") : raw;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
