import type { ProjectRepository } from "../repositories/ProjectRepository";
import type { TaskMasterStore } from "../store/taskMasterStore";
import { nowIso } from "../core/time";
import type { ProjectId } from "../core/types";
import { ulid } from "ulid";
import { basenameWithoutExt, wikiLinkToPath } from "../core/wikiLink";

const QUICK_NOTES_HEADING = "## Quick Notes";
const MEMO_BLOCK_ID_PREFIX = "tm-memo";
const MEMO_BLOCK_ID_RE = /\^tm-memo-[0-9A-HJKMNP-TV-Z]{26}/gu;

export type ProjectMemoBlockId = string & { readonly __brand: "ProjectMemoBlockId" };

export interface ProjectMemoBlock {
  id: ProjectMemoBlockId;
  date: string;
  time: string;
  text: string;
}

export class ProjectMemoService {
  private readonly appendQueues = new Map<ProjectId, Promise<ProjectMemoBlock | null>>();

  constructor(
    private readonly projects: ProjectRepository,
    private readonly store: TaskMasterStore,
  ) {}

  async appendMemo(projectId: ProjectId, text: string): Promise<ProjectMemoBlock | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const previous = this.appendQueues.get(projectId) ?? Promise.resolve(null);
    const next = previous
      .catch(() => null)
      .then(() => this.appendMemoNow(projectId, trimmed));
    this.appendQueues.set(projectId, next);
    try {
      return await next;
    } finally {
      if (this.appendQueues.get(projectId) === next) {
        this.appendQueues.delete(projectId);
      }
    }
  }

  private async appendMemoNow(projectId: ProjectId, trimmed: string): Promise<ProjectMemoBlock> {
    const { project, body } = await this.projects.readWithBody(projectId);
    const blockId = newMemoBlockId(body);
    const now = new Date();
    const nextBody = appendQuickMemo(body, trimmed, now, blockId);
    const updated = { ...project, updatedAt: nowIso() };
    const persisted = await this.projects.saveImmediate(updated, nextBody);
    this.store.getState().upsertProject(persisted);
    return {
      id: blockId,
      date: formatLocalDate(now),
      time: formatLocalTime(now),
      text: trimmed,
    };
  }

  async findMemo(projectId: ProjectId, blockId: ProjectMemoBlockId): Promise<ProjectMemoBlock | null> {
    const { body } = await this.projects.readWithBody(projectId);
    return findQuickMemo(body, blockId);
  }

  async listRecentMemos(projectId: ProjectId, limit = 3): Promise<ProjectMemoBlock[]> {
    const { body } = await this.projects.readWithBody(projectId);
    return listQuickMemos(body, limit);
  }

  async promoteMemoToNote(
    projectId: ProjectId,
    blockId: ProjectMemoBlockId,
  ): Promise<{ path: string }> {
    const { project, body } = await this.projects.readWithBody(projectId);
    const memo = findQuickMemo(body, blockId);
    if (!memo) throw new Error(`Project memo not found: ${blockId}`);

    const title = taskTitleFromMemo(memo.text);
    const projectName = basenameWithoutExt(project.path);
    const sourceLink = wikiLinkToPath(project.path, memo.id);
    const noteBody = [
      `# ${title}`,
      "",
      `Project: [[${projectName}]]`,
      `Source memo: ${sourceLink}`,
      "",
      memo.text,
      "",
    ].join("\n");
    const path = await this.projects.createStandaloneMemoNote(title, noteBody, memo.id);
    const promotedBody = markMemoPromoted(body, blockId, wikiLinkToPath(path));
    const persisted = await this.projects.saveImmediate(
      { ...project, updatedAt: nowIso() },
      promotedBody,
    );
    this.store.getState().upsertProject(persisted);
    return { path };
  }

  async linkMemoToTask(
    projectId: ProjectId,
    blockId: ProjectMemoBlockId,
    taskPath: string,
  ): Promise<void> {
    const { project, body } = await this.projects.readWithBody(projectId);
    const linkedBody = markMemoTaskLinked(body, blockId, wikiLinkToPath(taskPath));
    if (linkedBody === normalizeTrailingNewline(body)) return;

    const persisted = await this.projects.saveImmediate(
      { ...project, updatedAt: nowIso() },
      linkedBody,
    );
    this.store.getState().upsertProject(persisted);
  }
}

function appendQuickMemo(
  body: string,
  text: string,
  date: Date,
  blockId = newMemoBlockId(body),
): string {
  const withSection = ensureQuickNotesSection(body);
  const lines = withSection.split("\n");
  const dateHeading = `### ${formatLocalDate(date)}`;
  const memoLines = formatMemoBullet(text, date, blockId).split("\n");
  const quickIndex = lines.findIndex((line) => line.trim() === QUICK_NOTES_HEADING);
  const sectionEnd = findNextH2(lines, quickIndex + 1);
  const dateIndex = lines.findIndex((line, idx) =>
    idx > quickIndex && idx < sectionEnd && line.trim() === dateHeading,
  );

  if (dateIndex < 0) {
    const insert = [dateHeading, "", ...memoLines];
    const needsBlankBefore = sectionEnd > 0 && lines[sectionEnd - 1]?.trim() !== "";
    lines.splice(sectionEnd, 0, ...(needsBlankBefore ? [""] : []), ...insert);
    return normalizeTrailingNewline(lines.join("\n"));
  }

  const insertAt = findNextHeading(lines, dateIndex + 1, sectionEnd);
  const needsBlankBefore = insertAt > 0 && lines[insertAt - 1]?.trim() !== "";
  lines.splice(insertAt, 0, ...(needsBlankBefore ? [""] : []), ...memoLines);
  return normalizeTrailingNewline(lines.join("\n"));
}

function findQuickMemo(body: string, blockId: ProjectMemoBlockId): ProjectMemoBlock | null {
  const lines = body.split("\n");
  const marker = `^${blockId}`;
  const lineIndex = lines.findIndex((line) => line.includes(marker));
  if (lineIndex < 0) return null;

  const line = lines[lineIndex] ?? "";
  const match = line.match(/^\s*-\s+(\d{2}:\d{2})\s+([\s\S]*?)\s+\^tm-memo-[0-9A-HJKMNP-TV-Z]{26}\s*$/u);
  if (!match || !match[1] || match[2] === undefined) return null;

  const continuation: string[] = [];
  for (let idx = lineIndex + 1; idx < lines.length; idx++) {
    const next = lines[idx] ?? "";
    if (!next.startsWith("  ")) break;
    const content = next.slice(2);
    if (isMemoAnnotation(content)) continue;
    continuation.push(content);
  }

  return {
    id: blockId,
    date: findNearestDateHeading(lines, lineIndex),
    time: match[1],
    text: [match[2], ...continuation].join("\n"),
  };
}

function markMemoPromoted(body: string, blockId: ProjectMemoBlockId, noteLink: string): string {
  return addMemoAnnotation(body, blockId, `Promoted: ${noteLink}`);
}

function markMemoTaskLinked(body: string, blockId: ProjectMemoBlockId, taskLink: string): string {
  return addMemoAnnotation(body, blockId, `Task: ${taskLink}`);
}

function addMemoAnnotation(body: string, blockId: ProjectMemoBlockId, annotation: string): string {
  const lines = body.split("\n");
  const marker = `^${blockId}`;
  const lineIndex = lines.findIndex((line) => line.includes(marker));
  if (lineIndex < 0) throw new Error(`Project memo not found: ${blockId}`);

  const existing = lines.findIndex((line, idx) =>
    idx > lineIndex &&
    line.startsWith("  ") &&
    line.includes(annotation),
  );
  if (existing >= 0) return normalizeTrailingNewline(lines.join("\n"));

  let insertAt = lineIndex + 1;
  while (insertAt < lines.length && (lines[insertAt]?.startsWith("  ") ?? false)) {
    insertAt++;
  }
  lines.splice(insertAt, 0, `  ${annotation}`);
  return normalizeTrailingNewline(lines.join("\n"));
}

function isMemoAnnotation(line: string): boolean {
  return /^(Promoted|Task):\s+\[\[[\s\S]+\]\]$/u.test(line.trim());
}

function listQuickMemos(body: string, limit: number): ProjectMemoBlock[] {
  const lines = body.split("\n");
  const quickIndex = lines.findIndex((line) => line.trim() === QUICK_NOTES_HEADING);
  if (quickIndex < 0) return [];

  const sectionEnd = findNextH2(lines, quickIndex + 1);
  const memos: ProjectMemoBlock[] = [];
  for (let idx = quickIndex + 1; idx < sectionEnd; idx++) {
    const marker = lines[idx]?.match(MEMO_BLOCK_ID_RE)?.[0];
    if (!marker) continue;
    const memo = findQuickMemo(body, marker.slice(1) as ProjectMemoBlockId);
    if (memo) memos.push(memo);
  }

  return memos.slice(-Math.max(0, limit)).reverse();
}

function ensureQuickNotesSection(body: string): string {
  const hasQuickNotes = body
    .split("\n")
    .some((line) => line.trim() === QUICK_NOTES_HEADING);
  if (hasQuickNotes) return body;
  const trimmed = body.replace(/\s+$/u, "");
  return `${trimmed}\n\n${QUICK_NOTES_HEADING}\n`;
}

function formatMemoBullet(text: string, date: Date, blockId: ProjectMemoBlockId): string {
  const [first = "", ...rest] = text.split(/\r?\n/u);
  return [
    `- ${formatLocalTime(date)} ${first} ^${blockId}`,
    ...rest.map((line) => `  ${line}`),
  ].join("\n");
}

function taskTitleFromMemo(text: string): string {
  const firstLine = text.split(/\r?\n/u)[0]?.trim() ?? "";
  return firstLine.slice(0, 80) || "Untitled";
}

function newMemoBlockId(body: string): ProjectMemoBlockId {
  const existing = new Set(
    Array.from(body.matchAll(MEMO_BLOCK_ID_RE), (match) => match[0]!.slice(1)),
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${MEMO_BLOCK_ID_PREFIX}-${ulid()}` as ProjectMemoBlockId;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("Could not allocate project memo block id");
}

function findNearestDateHeading(lines: readonly string[], lineIndex: number): string {
  for (let idx = lineIndex; idx >= 0; idx--) {
    const line = lines[idx]?.trim() ?? "";
    const match = line.match(/^###\s+(\d{4}-\d{2}-\d{2})$/u);
    if (match?.[1]) return match[1];
  }
  return "";
}

function findNextH2(lines: readonly string[], start: number): number {
  const idx = lines.findIndex((line, lineIndex) =>
    lineIndex >= start && /^##\s+/u.test(line),
  );
  return idx < 0 ? lines.length : idx;
}

function findNextHeading(lines: readonly string[], start: number, end: number): number {
  const idx = lines.findIndex((line, lineIndex) =>
    lineIndex >= start && lineIndex < end && /^#{2,3}\s+/u.test(line),
  );
  return idx < 0 ? end : idx;
}

function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
}

function formatLocalTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeTrailingNewline(text: string): string {
  return text.replace(/\s*$/u, "\n");
}

export const __test_appendQuickMemo = appendQuickMemo;
export const __test_findQuickMemo = findQuickMemo;
export const __test_listQuickMemos = listQuickMemos;
export const __test_markMemoPromoted = markMemoPromoted;
export const __test_markMemoTaskLinked = markMemoTaskLinked;
