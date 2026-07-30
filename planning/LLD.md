# TaskMaster Obsidian Plugin — Low-Level Design

- **Version**: 1.0
- **Date**: 2026-05-10
- **Companion docs**: [PRD](PRD.md), [PLAN](PLAN-obsidian-task-manager.md), [HLD](HLD.md), [ADR Index](adr/README.md)

## 1. 문서 목적과 범위

LLD는 HLD의 component-level 구조를 implementation contract 수준으로 구체화한다. 각 모듈에 대해 다음을 정의한다.

- TypeScript type signature (정확한 입출력)
- 핵심 알고리즘의 의사코드
- 호출 측이 의지할 수 있는 동작 보장 (contract)
- 실패 모드와 edge case
- 테스트해야 할 시나리오 목록

이 문서를 읽고 코딩을 시작했을 때 정책 결정을 다시 내리지 않아도 되는 것이 목표다. 정책이 결정되어 있지 않은 항목은 §15 Open implementation questions에 모은다.

읽는 순서: **§2 Type definitions → §3-4 (utilities, parser) → §5 Repositories → §6 Services → §7 Store → §8 Plugin/View → §9 UI → §10 Cross-cutting**.

## 2. Type Definitions

`src/core/types.ts`에 위치. 모든 모듈이 import한다.

### 2.1 Domain Types

```ts
// Branded ID 타입으로 다른 ID와 혼동 방지
export type TaskId = string & { readonly __brand: "TaskId" };
export type MeetingId = string & { readonly __brand: "MeetingId" };
export type ProjectId = string & { readonly __brand: "ProjectId" };

export type ColumnId = "todo" | "doing" | "done";
export type TaskStatus = ColumnId;
export type Priority = "low" | "medium" | "high";

export type IsoDateTime = string & { readonly __brand: "IsoDateTime" };
export type IsoDate = string & { readonly __brand: "IsoDate" };

export const SCHEMA_VERSION = 1 as const;

export interface Task {
  schemaVersion: typeof SCHEMA_VERSION;
  id: TaskId;
  type: "task";
  status: TaskStatus;
  title: string;            // Markdown heading에서 derive
  project: ProjectId | null;
  priority: Priority | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  archivedAt: IsoDateTime | null;
  /** ADR-0008: 우리 schema 외 frontmatter field passthrough */
  passthrough: Record<string, unknown>;
  /** frontmatter field 순서 (write 시 보존) */
  fieldOrder: string[];
  /** 마지막으로 알려진 file mtime (conflict detection) */
  knownMtime: number;
  /** Vault 안 절대 경로. rename에 따라 갱신 */
  path: string;
}

export interface Meeting {
  schemaVersion: typeof SCHEMA_VERSION;
  id: MeetingId;
  type: "meeting";
  title: string;
  project: ProjectId | null;
  date: IsoDate;
  participants: string[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  passthrough: Record<string, unknown>;
  fieldOrder: string[];
  knownMtime: number;
  path: string;
}

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION;
  id: ProjectId;
  type: "project";
  title: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  passthrough: Record<string, unknown>;
  fieldOrder: string[];
  knownMtime: number;
  path: string;
}

export interface BoardColumn {
  id: ColumnId;
  title: string;
  taskIds: TaskId[];
}

export interface BoardState {
  version: 1;
  columns: BoardColumn[];   // 항상 ["todo", "doing", "done"] 순서
  updatedAt: IsoDateTime;
}
```

### 2.2 Frontmatter Wire Types

```ts
/** Markdown 파일에서 읽은 raw frontmatter 한 단계 추상 */
export interface ParsedFrontmatter {
  managed: Record<string, unknown>;       // 우리가 인식한 field만
  passthrough: Record<string, unknown>;   // unknown field
  fieldOrder: string[];                   // 원본 순서
}

/** 직렬화 직전의 task 표현 */
export interface TaskFrontmatterDoc {
  schemaVersion: number;
  id: string;
  type: "task";
  status: TaskStatus;
  project: string | null;
  priority: Priority | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;     // null이면 frontmatter에서 제거
}
```

### 2.3 Service Input Types

```ts
export interface CreateTaskInput {
  title: string;
  status?: TaskStatus;
  project?: ProjectId | null;
  priority?: Priority | null;
  body?: string;
}

export interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
  project?: ProjectId | null;
  priority?: Priority | null;
}

export interface CreateProjectInput {
  title: string;
}

export interface CreateMeetingInput {
  title: string;
  date: IsoDate;
  project?: ProjectId | null;
  participants?: string[];
  body?: string;
}
```

### 2.4 Event Bus Types

```ts
export type TaskMasterEvent =
  | { type: "tasks:indexed"; tasks: Task[] }
  | { type: "task:created"; task: Task }
  | { type: "task:updated"; task: Task; previous: Task }
  | { type: "task:deleted"; taskId: TaskId }
  | { type: "task:archived"; taskId: TaskId }
  | { type: "board:updated"; board: BoardState }
  | { type: "vault:conflict"; entityId: string; path: string; reason: ConflictReason }
  | { type: "parser:error"; path: string; reason: string };

export type ConflictReason = "external_modify" | "merge_failed" | "sync_collision";
```

### 2.5 Diagnostics Types

```ts
export type DiagnosticKind = "parse" | "flush" | "conflict" | "boot";

export interface DiagnosticEntry {
  ts: IsoDateTime;
  kind: DiagnosticKind;
  path?: string;
  entityId?: string;
  message: string;
  cause?: string;
}
```

### 2.6 Settings

```ts
export interface PluginSettings {
  version: 1;
  dataRootPath: string;        // 기본 "TaskMaster"
  saveDebounceMs: number;      // 기본 500
  confirmOnDelete: boolean;    // 기본 true
  locale: "auto" | "ko" | "en"; // 기본 "auto"
}

export const DEFAULT_SETTINGS: PluginSettings = {
  version: 1,
  dataRootPath: "TaskMaster",
  saveDebounceMs: 500,
  confirmOnDelete: true,
  locale: "auto",
};
```

## 3. Core Utilities

### 3.1 `core/ids.ts` — ULID와 short ID

```ts
import { ulid } from "ulid";

const SHORT_ID_MIN = 8;
const SHORT_ID_MAX = 26; // ULID 길이

/**
 * 새 ULID를 entity prefix와 함께 생성한다.
 * @example newId("task") → "task_01HX7SM2J6K4XQ7EV6C8T92PPW"
 */
export function newId<T extends string>(prefix: T): `${T}_${string}` {
  return `${prefix}_${ulid()}` as `${T}_${string}`;
}

/**
 * Full ID에서 ULID 부분만 추출.
 * `task_01HX7SM2...` → `01HX7SM2...`
 */
export function ulidOf(fullId: string): string {
  const idx = fullId.indexOf("_");
  if (idx < 0) throw new Error(`Invalid ID: ${fullId}`);
  return fullId.slice(idx + 1);
}

/**
 * Short ID 생성. 충돌 시 길이 확장.
 *
 * @param fullId          full prefixed ID (예: "task_01HX7SM2J6K...")
 * @param existingShorts  기존에 사용 중인 short ID set (다른 entity의 short ID)
 * @returns short ID with prefix (예: "task_01HX7SM2")
 */
export function makeShortId(
  fullId: string,
  existingShorts: ReadonlySet<string>,
): string {
  const prefix = fullId.slice(0, fullId.indexOf("_") + 1);
  const ulidPart = ulidOf(fullId);
  for (let len = SHORT_ID_MIN; len <= SHORT_ID_MAX; len++) {
    const candidate = prefix + ulidPart.slice(0, len);
    if (!existingShorts.has(candidate)) return candidate;
  }
  // 26자(풀 ULID)도 충돌하면 같은 entity. 호출자 책임.
  throw new Error(`short ID exhausted for ${fullId}`);
}

/**
 * Type guard: full prefixed ID 형식 검증.
 */
export function isValidId(prefix: string, value: string): boolean {
  if (!value.startsWith(prefix + "_")) return false;
  const rest = value.slice(prefix.length + 1);
  return rest.length === 26 && /^[0-9A-HJKMNP-TV-Z]+$/.test(rest);
}
```

**Test cases**:
- `newId("task")`는 `task_` prefix와 26자 ULID를 가진다.
- 같은 prefix로 1만 번 호출해도 중복이 없다.
- `makeShortId`는 충돌이 없으면 항상 8자를 반환한다.
- `makeShortId`는 8자 충돌 시 9자를 반환한다.
- `isValidId`는 잘못된 prefix, 길이, 알파벳을 모두 거부한다.

### 3.2 `core/time.ts` — 시각

```ts
import type { IsoDateTime, IsoDate } from "./types";

export function nowIso(): IsoDateTime {
  return new Date().toISOString() as IsoDateTime;
}

export function isoDate(d: Date = new Date()): IsoDate {
  return d.toISOString().slice(0, 10) as IsoDate;
}

/** 두 ISO datetime 중 더 최근을 반환 */
export function laterOf(a: IsoDateTime, b: IsoDateTime): IsoDateTime {
  return a >= b ? a : b;
}
```

### 3.3 `core/paths.ts` — 경로 헬퍼

```ts
const ILLEGAL = /[\/\\:*?"<>|\n\r]/g;
const SAFE_TITLE_MAX = 60;

/**
 * Title을 OS-safe 파일명으로 변환.
 * - illegal 문자 → "-"
 * - 양끝 공백 trim
 * - 최대 60자
 * - 빈 결과면 "untitled"
 */
export function safeTitle(title: string): string {
  const trimmed = title.replace(ILLEGAL, "-").trim();
  const truncated = trimmed.slice(0, SAFE_TITLE_MAX).trim();
  return truncated.length > 0 ? truncated : "untitled";
}

export function joinPath(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/^\/|\/$/g, ""))
    .filter((p) => p.length > 0)
    .join("/");
}

export function isUnderFolder(path: string, folder: string): boolean {
  const normalized = folder.replace(/\/$/, "") + "/";
  return path.startsWith(normalized);
}
```

**Test cases**:
- `safeTitle("a/b\\c:d")` → `"a-b-c-d"`.
- `safeTitle("   ")` → `"untitled"`.
- `safeTitle("a".repeat(100))` → 60자.
- `safeTitle("긴 한글 제목")` → 한글 그대로 보존.

## 4. Parser

### 4.1 `parser/frontmatter.ts` — Passthrough 직렬화

ADR-0008 구현의 중심. gray-matter는 field 순서 보존이 부족하므로 직접 구현한다.

```ts
import type { ParsedFrontmatter } from "../core/types";

const KNOWN_TASK_FIELDS = new Set([
  "schemaVersion", "id", "type", "status", "project",
  "priority", "createdAt", "updatedAt", "archivedAt",
]);

const KNOWN_MEETING_FIELDS = new Set([
  "schemaVersion", "id", "type", "project", "date",
  "participants", "createdAt", "updatedAt",
]);

export type EntityKind = "task" | "meeting" | "project";

export interface FrontmatterParseResult {
  fm: ParsedFrontmatter;
  body: string;
}

/**
 * Markdown 전체 텍스트를 frontmatter와 body로 분리.
 * frontmatter가 없으면 fm.managed = {}, body = 전체.
 */
export function parseFile(
  raw: string,
  kind: EntityKind,
): FrontmatterParseResult {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return {
      fm: { managed: {}, passthrough: {}, fieldOrder: [] },
      body: raw,
    };
  }
  const [, yamlBlock, body] = match;
  const { managed, passthrough, fieldOrder } = splitFrontmatter(yamlBlock, kind);
  return { fm: { managed, passthrough, fieldOrder }, body };
}

/**
 * YAML block을 managed/passthrough로 분리하고 field 순서를 보존.
 *
 * 구현 노트:
 * - top-level scalar/mapping/sequence만 지원 (Phase 1).
 * - Obsidian의 metadataCache가 받는 형식과 같은 subset.
 * - YAML 라이브러리는 `js-yaml`을 사용 (이미 Obsidian 환경에 있음).
 */
function splitFrontmatter(yaml: string, kind: EntityKind): {
  managed: Record<string, unknown>;
  passthrough: Record<string, unknown>;
  fieldOrder: string[];
}

/**
 * frontmatter + body를 다시 Markdown 텍스트로 직렬화.
 * - fieldOrder를 따라 alphabetic sort 대신 원본 순서 사용.
 * - managed에 새로 추가된 field는 fieldOrder 끝에 append.
 * - passthrough field는 원래 자리에 유지.
 *
 * @param fm.managed   직렬화 직전 managed field (TaskFrontmatterDoc 등)
 * @param fm.passthrough 보존할 unknown field
 * @param fm.fieldOrder 원본 순서. 새 field는 끝에 추가.
 */
export function serializeFile(
  fm: ParsedFrontmatter,
  body: string,
): string {
  const allFields = mergeFieldOrder(fm.fieldOrder, fm.managed, fm.passthrough);
  const lines = ["---"];
  for (const field of allFields) {
    const value = field in fm.managed ? fm.managed[field] : fm.passthrough[field];
    if (value === undefined) continue;     // null이 아닌 undefined만 skip
    lines.push(emitYamlLine(field, value));
  }
  lines.push("---", "");
  return lines.join("\n") + body;
}
```

**Contract**:
- Round-trip 보장: `parseFile(serializeFile(fm, body), kind).body === body` (단, 마지막 newline은 normalize됨).
- Round-trip 보장: passthrough field와 그 값, 순서가 보존됨.
- 알 수 없는 YAML 구조(anchors, tags 등)를 만나면 `passthrough`에 string으로 저장하고 diagnostics에 기록.

**Edge cases**:
- 빈 frontmatter (`---\n---\n`) → managed/passthrough 모두 빈 객체.
- frontmatter 없는 파일 → managed 빈, body 전체.
- 잘못된 YAML → `parseFile`이 throw, 호출자가 diagnostics 기록 후 파일 skip.
- Body 안에 `---` line이 있는 경우 → `^---\n...\n---\n?` 정규식이 첫 번째 fence만 매칭하므로 안전.
- 사용자가 우리 reserved field에 잘못된 값 입력 (예: `status: invalid`) → managed에 그대로 들어가지만, 후속 toTask()에서 검증 실패하여 task 생성 안 됨, diagnostics 기록.

**Test cases**:
- 빈 frontmatter round-trip.
- 사용자 정의 field (`tags: [a, b]`) round-trip.
- 알려진 field와 unknown field가 섞인 경우 순서 보존.
- 잘못된 YAML 처리.
- Body 안의 `---` 라인 보존.
- 새 field 추가 시 끝에 append.
- managed의 archivedAt이 null이면 frontmatter에서 제거.

### 4.2 `parser/taskMarkdown.ts` — Task 직렬화

```ts
import type {
  Task, TaskFrontmatterDoc, ParsedFrontmatter, TaskStatus, Priority,
} from "../core/types";
import { SCHEMA_VERSION } from "../core/types";
import { isValidId } from "../core/ids";
import { parseFile, serializeFile } from "./frontmatter";

export interface ParsedTask {
  task: Omit<Task, "knownMtime" | "path">;
  body: string;
}

/**
 * Markdown 파일 내용을 Task로 변환.
 * 검증 실패 시 null 반환 (호출자가 diagnostics 기록).
 */
export function parseTask(raw: string): ParsedTask | null {
  const { fm, body } = parseFile(raw, "task");
  const m = fm.managed;

  if (m.type !== "task") return null;
  if (typeof m.id !== "string" || !isValidId("task", m.id)) return null;
  if (!isValidStatus(m.status)) return null;

  const title = extractTitle(body);

  return {
    task: {
      schemaVersion: SCHEMA_VERSION,
      id: m.id as Task["id"],
      type: "task",
      status: m.status,
      title,
      project: typeof m.project === "string" && isValidId("project", m.project)
        ? (m.project as Task["project"])
        : null,
      priority: isValidPriority(m.priority) ? m.priority : null,
      createdAt: typeof m.createdAt === "string" ? (m.createdAt as Task["createdAt"]) : nowIso(),
      updatedAt: typeof m.updatedAt === "string" ? (m.updatedAt as Task["updatedAt"]) : nowIso(),
      archivedAt: typeof m.archivedAt === "string" ? (m.archivedAt as Task["archivedAt"]) : null,
      passthrough: fm.passthrough,
      fieldOrder: fm.fieldOrder,
    },
    body,
  };
}

export function serializeTask(task: Task, body: string): string {
  const doc: TaskFrontmatterDoc = {
    schemaVersion: task.schemaVersion,
    id: task.id,
    type: "task",
    status: task.status,
    project: task.project,
    priority: task.priority,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
  if (task.archivedAt) doc.archivedAt = task.archivedAt;

  return serializeFile(
    {
      managed: doc as unknown as Record<string, unknown>,
      passthrough: task.passthrough,
      fieldOrder: task.fieldOrder,
    },
    ensureHeading(body, task.title),
  );
}

/**
 * Body의 첫 H1을 title로 사용.
 * 없으면 빈 문자열 반환 (호출자가 fallback).
 */
function extractTitle(body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}

/**
 * Title이 바뀌었으면 첫 H1을 갱신. 없으면 맨 앞에 추가.
 */
function ensureHeading(body: string, title: string): string {
  if (/^#\s+.+$/m.test(body)) {
    return body.replace(/^#\s+.+$/m, `# ${title}`);
  }
  return `# ${title}\n\n${body}`;
}

function isValidStatus(v: unknown): v is TaskStatus {
  return v === "todo" || v === "doing" || v === "done";
}

function isValidPriority(v: unknown): v is Priority | null {
  return v === "low" || v === "medium" || v === "high" || v === null;
}
```

**Contract**:
- `parseTask`는 검증 실패 시 throw 대신 null을 반환하여 호출자가 single-file failure를 격리할 수 있게 한다.
- `serializeTask`는 ADR-0008 passthrough를 보존한다.
- title은 항상 Markdown H1과 동기화된다.

**Edge cases**:
- Body에 H1이 없으면 `extractTitle`이 빈 문자열, title은 "untitled" 같은 fallback (TaskService에서 처리).
- archivedAt이 null이면 직렬화에서 frontmatter field 자체를 제거.
- project/priority가 잘못된 값이면 null로 강등 (검증 실패가 아닌 graceful degradation).

`parser/meetingMarkdown.ts`와 `parser/projectMarkdown.ts`도 동일한 패턴.

## 5. Repositories

모든 Repository는 다음 공통 패턴을 따른다.

- Constructor에서 `App`(Obsidian)과 `DiagnosticsLog`를 주입받는다.
- 내부에 `pendingSaves: Map`과 `flushInFlight: Promise | null`로 동시성 처리.
- `pathById: Map<id, path>`로 ID → 경로 인덱스 유지.
- 모든 mutation은 mtime conflict 검사 후 진행.

### 5.1 `repositories/SettingsRepository.ts`

```ts
import type { Plugin } from "obsidian";
import type { PluginSettings } from "../core/types";
import { DEFAULT_SETTINGS } from "../core/types";

export class SettingsRepository {
  constructor(private readonly plugin: Plugin) {}

  async load(): Promise<PluginSettings> {
    const raw = await this.plugin.loadData();
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
    return this.migrate(raw);
  }

  async save(settings: PluginSettings): Promise<void> {
    await this.plugin.saveData(settings);
  }

  /**
   * version 1 미만은 기본값 병합.
   * version 2 이후는 Phase별 별도 migration.
   */
  private migrate(raw: unknown): PluginSettings {
    const obj = raw as Partial<PluginSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...obj,
      version: 1,
    };
  }
}
```

**Contract**:
- 손상된 settings 파일은 `DEFAULT_SETTINGS`로 복구하고 다음 save 시 정상 형식으로 덮어쓴다.
- save는 atomic (Obsidian의 `Plugin.saveData()`가 atomic write를 보장).

### 5.2 `repositories/TaskRepository.ts`

ADR-0004(immediate vs debounced), 0005(metadataCache), 0008(passthrough)을 모두 구현하는 핵심 모듈.

```ts
import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { Task, TaskId } from "../core/types";
import { parseTask, serializeTask } from "../parser/taskMarkdown";
import { safeTitle, joinPath } from "../core/paths";
import { makeShortId, ulidOf } from "../core/ids";
import { laterOf, nowIso } from "../core/time";
import type { DiagnosticsLog } from "../core/diagnostics";

const RETRY_MAX = 3;
const RETRY_BASE_MS = 100;

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
    private readonly tasksFolder: string,   // "TaskMaster/Tasks"
    private readonly archiveFolder: string, // "TaskMaster/Archive"
  ) {}

  // ---------- Read ----------

  /**
   * metadataCache 우선 스캔. 본문은 로드하지 않음.
   * 검증 실패 파일은 diagnostics에 기록 후 skip.
   */
  async findAll(): Promise<Task[]> {
    const files = this.collectMarkdownFiles(this.tasksFolder, this.archiveFolder);
    const tasks: Task[] = [];
    this.shortIds.clear();
    this.pathById.clear();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm || fm.type !== "task") continue;

      try {
        const raw = await this.app.vault.cachedRead(file);
        const parsed = parseTask(raw);
        if (!parsed) {
          this.diagnostics.record({
            kind: "parse", path: file.path, message: "schema validation failed",
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
        this.shortIds.add(this.shortIdOfPath(file.path));
      } catch (err) {
        this.diagnostics.record({
          kind: "parse", path: file.path,
          message: "parse error", cause: String(err),
        });
      }
    }
    return tasks;
  }

  async readBody(taskId: TaskId): Promise<string> {
    const file = this.fileOf(taskId);
    const raw = await this.app.vault.cachedRead(file);
    const match = raw.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
    return match ? match[1] : raw;
  }

  // ---------- Write ----------

  /**
   * 새 task 파일을 생성.
   * Path가 이미 존재하면 short ID 길이를 늘려 재시도.
   */
  async create(task: Task, body: string): Promise<Task> {
    await this.ensureFolderExists(this.tasksFolder);
    const path = await this.allocatePath(task);
    const content = serializeTask({ ...task, path }, body);
    await this.app.vault.create(path, content);

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`create failed: ${path}`);

    const persisted: Task = { ...task, path, knownMtime: file.stat.mtime };
    this.pathById.set(task.id, path);
    this.shortIds.add(this.shortIdOfPath(path));
    return persisted;
  }

  /**
   * 의미 데이터 변경. ADR-0004 정책으로 즉시 디스크 반영.
   */
  async saveImmediate(task: Task): Promise<void> {
    this.pendingSaves.set(task.id, task);
    await this.flush();
  }

  /**
   * 향후 high-frequency 의미 변경(Phase 2 inline body 편집 등)을 위해 유지.
   * Phase 1에서는 거의 사용하지 않는다.
   */
  queueSave(task: Task): void {
    this.pendingSaves.set(task.id, task);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /**
   * 동시 호출 안전: 진행 중 flush가 있으면 그 promise를 공유.
   * flush 도중 들어온 새 변경은 다음 사이클에서 처리.
   */
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
          kind: "flush", entityId: task.id, path: task.path,
          message: "persist failed after retries", cause: String(err),
        });
      }
    }
    if (failures.length > 0) {
      // 다음 사이클에서 재시도
      for (const t of failures) this.pendingSaves.set(t.id, t);
      this.notifyPersistentFailures(failures);
    }
  }

  private async persistWithRetry(task: Task): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
      try {
        await this.persist(task);
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
      }
    }
    throw lastErr;
  }

  /**
   * 실제 파일에 쓰기. mtime conflict 확인.
   * passthrough 보존을 위해 read-modify-write.
   */
  private async persist(task: Task): Promise<void> {
    const file = this.fileOf(task.id);

    // ADR-0005: conflict-sensitive 시점에는 vault.read() 사용
    const currentRaw = await this.app.vault.read(file);
    const currentMtime = file.stat.mtime;

    if (currentMtime > task.knownMtime) {
      await this.handleConflict(task, file, currentRaw, currentMtime);
      return;
    }

    // 본문은 기존 파일에서 가져와 보존
    const bodyMatch = currentRaw.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1] : "";
    const next = serializeTask(task, body);
    await this.app.vault.modify(file, next);
  }

  private async handleConflict(
    task: Task, file: TFile, currentRaw: string, currentMtime: number,
  ): Promise<void> {
    // 외부에서 변경된 frontmatter를 다시 파싱
    const external = parseTask(currentRaw);
    if (!external) {
      // 외부 변경이 invalid → 더 이상 자동 merge 불가 → conflicted copy
      await this.writeConflictedCopy(task);
      this.diagnostics.record({
        kind: "conflict", entityId: task.id, path: file.path,
        message: "external change invalid, wrote conflicted copy",
      });
      return;
    }

    // 단순 merge: 우리 의도가 우선이지만 외부의 passthrough는 보존
    const merged: Task = {
      ...task,
      passthrough: external.task.passthrough,
      fieldOrder: external.task.fieldOrder,
      updatedAt: laterOf(task.updatedAt, external.task.updatedAt),
    };
    const body = await this.app.vault.read(file).then((r) => {
      const m = r.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
      return m ? m[1] : "";
    });
    await this.app.vault.modify(file, serializeTask(merged, body));
  }

  private async writeConflictedCopy(task: Task): Promise<void> {
    const stamp = nowIso().replace(/[-:]/g, "").slice(0, 15);
    const newPath = task.path.replace(/\.md$/, ` - conflict ${stamp}.md`);
    const body = await this.readBody(task.id);
    await this.app.vault.create(newPath, serializeTask({ ...task, path: newPath }, body));
  }

  // ---------- Lifecycle ----------

  /**
   * Vault 휴지통으로 이동.
   */
  async delete(taskId: TaskId): Promise<void> {
    const file = this.fileOf(taskId);
    await this.app.vault.trash(file, true);
    this.pathById.delete(taskId);
    this.shortIds.delete(this.shortIdOfPath(file.path));
  }

  /**
   * Archive 폴더로 이동 후 archivedAt frontmatter 추가.
   */
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
    return archived;
  }

  // ---------- Helpers ----------

  private fileOf(taskId: TaskId): TFile {
    const path = this.pathById.get(taskId);
    if (!path) throw new Error(`Unknown task id: ${taskId}`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Missing file: ${path}`);
    return file;
  }

  private async allocatePath(task: Task): Promise<string> {
    const safe = safeTitle(task.title || "untitled");
    let len = 8;
    while (len <= 26) {
      const short = `task_${ulidOf(task.id).slice(0, len)}`;
      const path = normalizePath(joinPath(this.tasksFolder, `${safe} - ${short}.md`));
      if (!this.app.vault.getAbstractFileByPath(path) && !this.shortIds.has(short)) {
        return path;
      }
      len++;
    }
    throw new Error(`path allocation exhausted for ${task.id}`);
  }

  private shortIdOfPath(path: string): string {
    const m = path.match(/(task_[0-9A-HJKMNP-TV-Z]+)\.md$/);
    return m ? m[1] : "";
  }

  private async ensureFolderExists(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;
    await this.app.vault.createFolder(path);
  }

  private collectMarkdownFiles(...folders: string[]): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => folders.some((folder) => f.path.startsWith(folder + "/")));
  }

  private notifyPersistentFailures(failures: Task[]): void {
    // Notice는 호출 빈도 제한 (DiagnosticsLog가 throttle 담당)
    // 여기서는 fire-and-forget; UI는 store.diagnostics를 구독해 표시
  }
}
```

**Contract**:
- `findAll`은 schema 검증 실패 파일 1개로 인해 throw하지 않는다.
- `saveImmediate`는 호출이 끝났을 때 디스크 write가 완료되어 있음을 보장한다 (단, conflict 발생 시 conflicted copy로 분기).
- `flush`는 동시 호출이 와도 race가 없다.
- `archive`는 두 번의 write를 발생시킨다 (rename + archivedAt 추가). rename은 거의 instant하므로 사용자 인지 lag 없음.

**Edge cases**:
- 같은 task가 짧은 시간에 여러 번 saveImmediate되면 마지막 호출만 디스크에 반영 (Map 병합).
- 외부 modify와 동시 호출이 races: persist 안에서 vault.read()로 다시 확인.
- delete된 파일에 saveImmediate 호출 → `fileOf`가 throw → diagnostics 기록 후 무시.
- short ID 26자도 충돌 → 중복 ID 사용 의심 → throw, 호출자가 새 ULID 생성 후 재시도.

**Test cases**:
- `findAll`이 잘못된 frontmatter 1개를 만나도 나머지 task를 모두 반환.
- `saveImmediate` 동시 호출 시 race 없음.
- mtime conflict 시 conflicted copy 생성.
- `archive` 후 file이 Archive 폴더에 있고 archivedAt이 frontmatter에 있음.
- `delete` 후 fileOf 조회 실패.
- 1만 개 ULID로 short ID 생성 시 충돌 처리.

### 5.3 `repositories/BoardRepository.ts`

```ts
import type { App } from "obsidian";
import { TFile, normalizePath } from "obsidian";
import type { BoardState, BoardColumn, ColumnId, Task, TaskId } from "../core/types";
import { nowIso } from "../core/time";
import { joinPath } from "../core/paths";
import type { DiagnosticsLog } from "../core/diagnostics";

const COLUMN_DEFS: Array<{ id: ColumnId; title: string }> = [
  { id: "todo", title: "Todo" },
  { id: "doing", title: "Doing" },
  { id: "done", title: "Done" },
];

export class BoardRepository {
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: BoardState | null = null;
  private writeInFlight: Promise<void> | null = null;

  constructor(
    private readonly app: App,
    private readonly diagnostics: DiagnosticsLog,
    private readonly boardPath: string,   // "TaskMaster/.board.json"
    private readonly debounceMs: number,
  ) {}

  async loadOrRebuild(tasks: Task[]): Promise<BoardState> {
    const loaded = await this.tryLoad();
    if (!loaded) return this.rebuildFromTasks(tasks);
    return this.reconcile(loaded, tasks);
  }

  /**
   * 파일이 있으면 파싱. 없거나 손상이면 null.
   */
  private async tryLoad(): Promise<BoardState | null> {
    const file = this.app.vault.getAbstractFileByPath(this.boardPath);
    if (!(file instanceof TFile)) return null;
    try {
      const raw = await this.app.vault.read(file);
      const parsed = JSON.parse(raw) as BoardState;
      if (parsed.version !== 1) return null;
      if (!Array.isArray(parsed.columns)) return null;
      return parsed;
    } catch (err) {
      this.diagnostics.record({
        kind: "boot", path: this.boardPath,
        message: "board.json corrupted, rebuilding", cause: String(err),
      });
      return null;
    }
  }

  /**
   * PRD §9.4 결정적 알고리즘.
   */
  rebuildFromTasks(tasks: Task[]): BoardState {
    const grouped: Record<ColumnId, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of tasks) {
      if (t.archivedAt) continue;
      grouped[t.status].push(t);
    }
    for (const id of Object.keys(grouped) as ColumnId[]) {
      grouped[id].sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return a.path.localeCompare(b.path);
      });
    }
    return {
      version: 1,
      columns: COLUMN_DEFS.map(({ id, title }) => ({
        id, title, taskIds: grouped[id].map((t) => t.id),
      })),
      updatedAt: nowIso(),
    };
  }

  /**
   * loaded와 tasks 사이의 drift를 보정.
   * - tasks에 있지만 board에 없는 task → 해당 column 끝에 append
   * - board에 있지만 tasks에 없는 taskId → 제거
   * - task.status와 board column이 다르면 task.status를 신뢰 (Markdown SoT)
   */
  reconcile(loaded: BoardState, tasks: Task[]): BoardState {
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const seenIds = new Set<TaskId>();

    const columns: BoardColumn[] = COLUMN_DEFS.map(({ id, title }) => {
      const sourceColumn = loaded.columns.find((c) => c.id === id);
      const orderedIds: TaskId[] = [];
      for (const taskId of sourceColumn?.taskIds ?? []) {
        const task = taskById.get(taskId);
        if (!task || task.archivedAt) continue;       // 삭제/archive 반영
        if (task.status !== id) continue;             // status 이동 반영 (다른 column에서 추가됨)
        orderedIds.push(taskId);
        seenIds.add(taskId);
      }
      return { id, title, taskIds: orderedIds };
    });

    // Board에 없는 새 task를 status에 따라 append
    for (const t of tasks) {
      if (t.archivedAt || seenIds.has(t.id)) continue;
      const column = columns.find((c) => c.id === t.status);
      column?.taskIds.push(t.id);
    }

    return { version: 1, columns, updatedAt: nowIso() };
  }

  /**
   * Sync conflict 해소. ADR-0002 정책.
   */
  resolveSyncConflict(local: BoardState, remote: BoardState): BoardState {
    const winner = local.updatedAt >= remote.updatedAt ? local : remote;
    const loser = winner === local ? remote : local;

    const mergedColumns = winner.columns.map((wc) => {
      const lc = loser.columns.find((c) => c.id === wc.id);
      const winnerIds = new Set(wc.taskIds);
      const missingFromWinner = (lc?.taskIds ?? []).filter((id) => !winnerIds.has(id));
      return { ...wc, taskIds: [...wc.taskIds, ...missingFromWinner] };
    });
    return { version: 1, columns: mergedColumns, updatedAt: nowIso() };
  }

  // ---------- Write ----------

  queueWrite(board: BoardState): void {
    this.pending = board;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.writeInFlight) return this.writeInFlight;
    if (!this.pending) return;
    const board = this.pending;
    this.pending = null;
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.writeInFlight = this.persist(board).finally(() => {
      this.writeInFlight = null;
      if (this.pending) {
        this.writeTimer = setTimeout(() => void this.flush(), this.debounceMs);
      }
    });
    return this.writeInFlight;
  }

  private async persist(board: BoardState): Promise<void> {
    const json = JSON.stringify(board, null, 2);
    const path = normalizePath(this.boardPath);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, json);
    } else {
      await this.app.vault.create(path, json);
    }
  }
}
```

**Contract**:
- `loadOrRebuild`는 항상 valid `BoardState`를 반환한다 (load 실패해도 rebuild fallback).
- `reconcile`은 Markdown frontmatter의 `status`를 신뢰한다 (SoT 원칙).
- `queueWrite` 호출 후 `debounceMs` 이내에 추가 호출이 없으면 디스크에 flush.

**Edge cases**:
- `.board.json`이 손상되어 JSON parse 실패 → diagnostics 기록 후 rebuild.
- task.status가 알 수 없는 값 → `reconcile`에서 어느 column에도 들어가지 않음. parser 단계에서 이미 거부되어야 정상.
- 두 device의 `.board.json`이 정확히 같은 `updatedAt` → tie-breaker는 첫 번째 인자(local)를 winner로.

**Test cases**:
- 빈 task 배열 → 빈 columns 반환.
- 손상된 JSON → rebuildFromTasks fallback.
- task 추가/삭제 후 reconcile.
- status 이동: task.status가 doing인데 board는 todo column에 있을 때 doing으로 이동.
- archive된 task는 어디에도 없음.
- resolveSyncConflict: winner column이 보존되고 loser의 새 taskId가 append.

### 5.4 `repositories/MeetingRepository.ts`와 `ProjectRepository.ts`

TaskRepository와 동일 패턴이므로 LLD에서 반복하지 않는다. 차이점만:

- **MeetingRepository**: archive 없음, status 없음, `participants` 배열 직렬화.
- **ProjectRepository**: archive 없음, body가 거의 비어 있음 (placeholder만), Phase 1에서는 create/findAll/delete만 사용.

## 6. Services

### 6.1 `services/IndexService.ts`

플러그인 부팅의 entrypoint. Vault event 라우팅도 담당.

```ts
import type { App, Plugin, TFile, TAbstractFile } from "obsidian";
import type { TaskMasterStore } from "../store/taskMasterStore";
import type { TaskRepository } from "../repositories/TaskRepository";
import type { BoardRepository } from "../repositories/BoardRepository";
import type { MeetingRepository } from "../repositories/MeetingRepository";
import type { ProjectRepository } from "../repositories/ProjectRepository";
import type { DiagnosticsLog } from "../core/diagnostics";
import { isUnderFolder } from "../core/paths";
import { parseTask } from "../parser/taskMarkdown";

export class IndexService {
  constructor(
    private readonly app: App,
    private readonly plugin: Plugin,
    private readonly store: TaskMasterStore,
    private readonly tasks: TaskRepository,
    private readonly board: BoardRepository,
    private readonly meetings: MeetingRepository,
    private readonly projects: ProjectRepository,
    private readonly diagnostics: DiagnosticsLog,
    private readonly dataRoot: string,    // "TaskMaster"
  ) {}

  async bootstrap(): Promise<void> {
    await this.ensureFolders();

    const [taskList, meetingList, projectList] = await Promise.all([
      this.tasks.findAll(),
      this.meetings.findAll(),
      this.projects.findAll(),
    ]);

    this.store.setTasks(taskList);
    this.store.setMeetings(meetingList);
    this.store.setProjects(projectList);

    const board = await this.board.loadOrRebuild(taskList);
    this.store.setBoard(board);
    // 첫 reconcile 결과를 곧바로 저장
    this.board.queueWrite(board);

    this.registerVaultListeners();
  }

  private async ensureFolders(): Promise<void> {
    const folders = [
      this.dataRoot,
      `${this.dataRoot}/Tasks`,
      `${this.dataRoot}/Meetings`,
      `${this.dataRoot}/Projects`,
      `${this.dataRoot}/Archive`,
    ];
    for (const path of folders) {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (!existing) await this.app.vault.createFolder(path);
    }
  }

  private registerVaultListeners(): void {
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file) => this.handleMetaChanged(file)),
    );
    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => this.handleDelete(file)),
    );
    this.plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => this.handleRename(file, oldPath)),
    );
  }

  /**
   * metadataCache.changed가 modify와 create를 모두 커버한다.
   * 우리는 frontmatter만 보면 되므로 vault.modify를 직접 구독하지 않는다.
   */
  private async handleMetaChanged(file: TFile): Promise<void> {
    if (!isUnderFolder(file.path, this.dataRoot)) return;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return;

    if (fm.type === "task") {
      const raw = await this.app.vault.cachedRead(file);
      const parsed = parseTask(raw);
      if (!parsed) {
        this.diagnostics.record({
          kind: "parse", path: file.path, message: "validation failed on modify",
        });
        return;
      }
      const previous = this.store.getState().tasks.get(parsed.task.id);
      const next = { ...parsed.task, knownMtime: file.stat.mtime, path: file.path };
      this.store.upsertTask(next);

      // status 변경 또는 신규 → board reconcile
      if (!previous || previous.status !== next.status || previous.archivedAt !== next.archivedAt) {
        const board = this.board.reconcile(this.store.getState().board, [...this.store.getState().tasks.values()]);
        this.store.setBoard(board);
        this.board.queueWrite(board);
      }
    }
    // meeting, project도 동일 패턴
  }

  private handleDelete(file: TAbstractFile): void {
    if (!("path" in file)) return;
    if (!isUnderFolder(file.path, this.dataRoot)) return;
    // store에서 path로 entity 찾아 제거
    const tasks = this.store.getState().tasks;
    for (const t of tasks.values()) {
      if (t.path === file.path) {
        this.store.removeTask(t.id);
        const board = this.board.reconcile(this.store.getState().board, [...this.store.getState().tasks.values()]);
        this.store.setBoard(board);
        this.board.queueWrite(board);
        return;
      }
    }
  }

  private handleRename(file: TAbstractFile, oldPath: string): void {
    if (!isUnderFolder(file.path, this.dataRoot) && !isUnderFolder(oldPath, this.dataRoot)) return;
    // path만 갱신, ID 매칭은 frontmatter id로 metadataCache.changed에서 처리됨
    const tasks = this.store.getState().tasks;
    for (const t of tasks.values()) {
      if (t.path === oldPath) {
        this.store.upsertTask({ ...t, path: file.path });
        return;
      }
    }
  }
}
```

**Contract**:
- `bootstrap`은 한 번만 호출 (Plugin.onload).
- Vault listener는 `Plugin.registerEvent`로 등록되어 unload 시 자동 dispose.
- Vault event 처리 중 throw해도 plugin 전체가 죽지 않음 (각 handler가 try-catch).

**Edge cases**:
- `metadataCache.changed`가 frontmatter 파싱 전에 발생할 수 있음 → cache?.frontmatter가 undefined면 skip하고 다음 changed event를 기다림.
- rename으로 TaskMaster/ 안 → 밖으로 이동하면 entity를 삭제 처리.
- rename으로 밖 → 안으로 이동하면 신규 task로 인덱싱 (다음 metadataCache.changed에서).

### 6.2 `services/TaskService.ts`

```ts
import type { TaskRepository } from "../repositories/TaskRepository";
import type { BoardService } from "./BoardService";
import type { TaskMasterStore } from "../store/taskMasterStore";
import type { EventBus } from "../core/eventBus";
import type { Task, TaskId, TaskStatus, Priority, ProjectId, CreateTaskInput } from "../core/types";
import { newId } from "../core/ids";
import { nowIso } from "../core/time";
import { SCHEMA_VERSION } from "../core/types";

export class TaskService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly board: BoardService,
    private readonly store: TaskMasterStore,
    private readonly events: EventBus,
  ) {}

  async createTask(input: CreateTaskInput): Promise<Task> {
    const status = input.status ?? "todo";
    const draft: Task = {
      schemaVersion: SCHEMA_VERSION,
      id: newId("task") as TaskId,
      type: "task",
      status,
      title: input.title.trim() || "Untitled",
      project: input.project ?? null,
      priority: input.priority ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archivedAt: null,
      passthrough: {},
      fieldOrder: [
        "schemaVersion", "id", "type", "status", "project",
        "priority", "createdAt", "updatedAt",
      ],
      knownMtime: 0,
      path: "",
    };

    const persisted = await this.tasks.create(draft, input.body ?? "");
    this.store.upsertTask(persisted);
    this.board.appendToColumn(status, persisted.id);
    this.events.emit({ type: "task:created", task: persisted });
    return persisted;
  }

  async moveTask(taskId: TaskId, nextStatus: TaskStatus): Promise<Task> {
    const previous = this.requireTask(taskId);
    if (previous.status === nextStatus) return previous;

    const updated: Task = { ...previous, status: nextStatus, updatedAt: nowIso() };
    await this.tasks.saveImmediate(updated);
    this.store.upsertTask(updated);
    this.board.move(taskId, previous.status, nextStatus);
    this.events.emit({ type: "task:updated", task: updated, previous });
    return updated;
  }

  async updateTitle(taskId: TaskId, title: string): Promise<Task> {
    const previous = this.requireTask(taskId);
    const trimmed = title.trim() || "Untitled";
    if (previous.title === trimmed) return previous;
    const updated: Task = { ...previous, title: trimmed, updatedAt: nowIso() };
    await this.tasks.saveImmediate(updated);
    this.store.upsertTask(updated);
    this.events.emit({ type: "task:updated", task: updated, previous });
    return updated;
  }

  async updatePriority(taskId: TaskId, priority: Priority | null): Promise<Task> {
    const previous = this.requireTask(taskId);
    if (previous.priority === priority) return previous;
    const updated: Task = { ...previous, priority, updatedAt: nowIso() };
    await this.tasks.saveImmediate(updated);
    this.store.upsertTask(updated);
    this.events.emit({ type: "task:updated", task: updated, previous });
    return updated;
  }

  async setProject(taskId: TaskId, projectId: ProjectId | null): Promise<Task> {
    const previous = this.requireTask(taskId);
    if (previous.project === projectId) return previous;
    const updated: Task = { ...previous, project: projectId, updatedAt: nowIso() };
    await this.tasks.saveImmediate(updated);
    this.store.upsertTask(updated);
    this.events.emit({ type: "task:updated", task: updated, previous });
    return updated;
  }

  async archiveTask(taskId: TaskId): Promise<void> {
    const task = this.requireTask(taskId);
    const archived = await this.tasks.archive(task);
    this.store.upsertTask(archived);
    this.board.remove(taskId);
    this.events.emit({ type: "task:archived", taskId });
  }

  async deleteTask(taskId: TaskId): Promise<void> {
    await this.tasks.delete(taskId);
    this.store.removeTask(taskId);
    this.board.remove(taskId);
    this.events.emit({ type: "task:deleted", taskId });
  }

  async openInEditor(taskId: TaskId, app: App): Promise<void> {
    const task = this.requireTask(taskId);
    const file = app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) return;
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }

  private requireTask(id: TaskId): Task {
    const t = this.store.getState().tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    return t;
  }
}
```

**Contract**:
- 모든 mutation 메서드는 store 갱신과 EventBus emit을 함께 수행.
- 의미 데이터 변경은 saveImmediate, 시각 변경(reorder)은 BoardService에 위임.
- title은 항상 trimmed, 빈 값은 "Untitled"로 보정.

**Edge cases**:
- 같은 status로 move → no-op (디스크 write도 발생 안 함).
- 존재하지 않는 taskId → throw (UI는 stale state).
- delete 후 같은 id 호출 → throw (호출자가 삭제 결과 반영 안 함).

### 6.3 `services/BoardService.ts`

```ts
import type { BoardRepository } from "../repositories/BoardRepository";
import type { TaskMasterStore } from "../store/taskMasterStore";
import type { EventBus } from "../core/eventBus";
import type { BoardState, ColumnId, TaskId } from "../core/types";
import { nowIso } from "../core/time";

export class BoardService {
  constructor(
    private readonly board: BoardRepository,
    private readonly store: TaskMasterStore,
    private readonly events: EventBus,
  ) {}

  appendToColumn(columnId: ColumnId, taskId: TaskId): void {
    this.update((b) => {
      const col = b.columns.find((c) => c.id === columnId);
      if (!col || col.taskIds.includes(taskId)) return b;
      return this.setColumn(b, columnId, [...col.taskIds, taskId]);
    });
  }

  move(taskId: TaskId, from: ColumnId, to: ColumnId): void {
    this.update((b) => {
      const fromCol = b.columns.find((c) => c.id === from)!;
      const toCol = b.columns.find((c) => c.id === to)!;
      const removed = fromCol.taskIds.filter((id) => id !== taskId);
      const added = toCol.taskIds.includes(taskId) ? toCol.taskIds : [...toCol.taskIds, taskId];
      return {
        ...b,
        columns: b.columns.map((c) => {
          if (c.id === from) return { ...c, taskIds: removed };
          if (c.id === to) return { ...c, taskIds: added };
          return c;
        }),
        updatedAt: nowIso(),
      };
    });
  }

  reorderInColumn(columnId: ColumnId, nextOrder: TaskId[]): void {
    this.update((b) => this.setColumn(b, columnId, nextOrder));
  }

  remove(taskId: TaskId): void {
    this.update((b) => ({
      ...b,
      columns: b.columns.map((c) => ({
        ...c, taskIds: c.taskIds.filter((id) => id !== taskId),
      })),
      updatedAt: nowIso(),
    }));
  }

  /**
   * Service 외부에서 board를 통째로 교체할 때 사용 (reconcile 결과 반영 등).
   */
  replace(board: BoardState): void {
    this.store.setBoard(board);
    this.board.queueWrite(board);
    this.events.emit({ type: "board:updated", board });
  }

  private update(fn: (b: BoardState) => BoardState): void {
    const prev = this.store.getState().board;
    const next = fn(prev);
    if (next === prev) return;
    this.replace(next);
  }

  private setColumn(b: BoardState, id: ColumnId, taskIds: TaskId[]): BoardState {
    return {
      ...b,
      columns: b.columns.map((c) => (c.id === id ? { ...c, taskIds } : c)),
      updatedAt: nowIso(),
    };
  }
}
```

**Contract**:
- 모든 변경은 즉시 store에 반영, 디스크는 debounced.
- `move`는 source column에서 제거하고 target column 끝에 추가.
- 같은 column 안에서 정확한 위치 이동은 `reorderInColumn`을 사용.

### 6.4 `services/ProjectService.ts`

Phase 1 최소 UI 지원 (HLD §8.3).

```ts
export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly store: TaskMasterStore,
    private readonly events: EventBus,
  ) {}

  async createProject(input: CreateProjectInput): Promise<Project> {
    const draft: Project = { ... newId, schema, title 등 ... };
    const persisted = await this.projects.create(draft);
    this.store.upsertProject(persisted);
    return persisted;
  }

  list(): Project[] {
    return [...this.store.getState().projects.values()].sort((a, b) =>
      a.title.localeCompare(b.title)
    );
  }
}
```

Phase 1은 update/delete UI 없음.

## 7. Store

### 7.1 `store/taskMasterStore.ts`

```ts
import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { Task, Meeting, Project, TaskId, MeetingId, ProjectId, BoardState, DiagnosticEntry } from "../core/types";

interface State {
  tasks: Map<TaskId, Task>;
  meetings: Map<MeetingId, Meeting>;
  projects: Map<ProjectId, Project>;
  board: BoardState;
  diagnostics: readonly DiagnosticEntry[];
  selectedProjectId: ProjectId | "all" | "none";
  hideCompleted: boolean;
}

interface Actions {
  setTasks: (tasks: Task[]) => void;
  upsertTask: (task: Task) => void;
  removeTask: (id: TaskId) => void;

  setMeetings: (meetings: Meeting[]) => void;
  upsertMeeting: (m: Meeting) => void;

  setProjects: (projects: Project[]) => void;
  upsertProject: (p: Project) => void;

  setBoard: (board: BoardState) => void;
  recordDiagnostic: (e: DiagnosticEntry) => void;
  setProjectFilter: (id: ProjectId | "all" | "none") => void;
  setHideCompleted: (hide: boolean) => void;
}

export type TaskMasterStore = UseBoundStore<StoreApi<State & Actions>>;

const emptyBoard: BoardState = {
  version: 1,
  columns: [
    { id: "todo", title: "Todo", taskIds: [] },
    { id: "doing", title: "Doing", taskIds: [] },
    { id: "done", title: "Done", taskIds: [] },
  ],
  updatedAt: new Date(0).toISOString(),
};

const MAX_DIAGNOSTICS = 50;

export const createTaskMasterStore = (): TaskMasterStore =>
  create<State & Actions>((set) => ({
    tasks: new Map(),
    meetings: new Map(),
    projects: new Map(),
    board: emptyBoard,
    diagnostics: [],
    selectedProjectId: "all",
    hideCompleted: false,

    setTasks: (tasks) =>
      set({ tasks: new Map(tasks.map((t) => [t.id, t])) }),
    upsertTask: (task) =>
      set((s) => {
        const next = new Map(s.tasks); next.set(task.id, task);
        return { tasks: next };
      }),
    removeTask: (id) =>
      set((s) => {
        const next = new Map(s.tasks); next.delete(id);
        return { tasks: next };
      }),
    setMeetings: (meetings) => set({ meetings: new Map(meetings.map((m) => [m.id, m])) }),
    upsertMeeting: (m) => set((s) => {
      const next = new Map(s.meetings); next.set(m.id, m); return { meetings: next };
    }),
    setProjects: (projects) => set({ projects: new Map(projects.map((p) => [p.id, p])) }),
    upsertProject: (p) => set((s) => {
      const next = new Map(s.projects); next.set(p.id, p); return { projects: next };
    }),
    setBoard: (board) => set({ board }),
    recordDiagnostic: (e) =>
      set((s) => {
        const next = [e, ...s.diagnostics].slice(0, MAX_DIAGNOSTICS);
        return { diagnostics: next };
      }),
    setProjectFilter: (id) => set({ selectedProjectId: id }),
    setHideCompleted: (hide) => set({ hideCompleted: hide }),
  }));
```

### 7.2 Selector hooks

`store/selectors.ts`:

```ts
import { useMemo } from "react";
import type { TaskMasterStore } from "./taskMasterStore";
import type { BoardState, BoardColumn, Task } from "../core/types";

export function useFilteredBoard(useStore: TaskMasterStore): BoardState {
  const board = useStore((s) => s.board);
  const tasks = useStore((s) => s.tasks);
  const projectFilter = useStore((s) => s.selectedProjectId);
  const hideCompleted = useStore((s) => s.hideCompleted);

  return useMemo(() => {
    return {
      ...board,
      columns: board.columns.map((c) => filterColumn(c, tasks, projectFilter, hideCompleted)),
    };
  }, [board, tasks, projectFilter, hideCompleted]);
}

function filterColumn(
  c: BoardColumn,
  tasks: Map<string, Task>,
  projectFilter: string,
  hideCompleted: boolean,
): BoardColumn {
  let ids = c.taskIds;
  if (hideCompleted && c.id === "done") ids = [];
  if (projectFilter !== "all") {
    ids = ids.filter((id) => {
      const t = tasks.get(id);
      if (!t) return false;
      if (projectFilter === "none") return t.project === null;
      return t.project === projectFilter;
    });
  }
  return { ...c, taskIds: ids };
}
```

**Contract**:
- selector는 board의 deep structure가 동일하면 동일 reference를 반환 (useMemo).
- filter는 의미 데이터를 변경하지 않는다 (PRD §16.4).

## 8. Plugin과 View

### 8.1 `main.ts`

```ts
import { Plugin, WorkspaceLeaf } from "obsidian";
import { TaskMasterView, VIEW_TYPE_TASKMASTER } from "./view/TaskMasterView";
import { SettingsRepository } from "./repositories/SettingsRepository";
import { TaskRepository } from "./repositories/TaskRepository";
import { BoardRepository } from "./repositories/BoardRepository";
import { MeetingRepository } from "./repositories/MeetingRepository";
import { ProjectRepository } from "./repositories/ProjectRepository";
import { IndexService } from "./services/IndexService";
import { TaskService } from "./services/TaskService";
import { BoardService } from "./services/BoardService";
import { ProjectService } from "./services/ProjectService";
import { MeetingService } from "./services/MeetingService";
import { EventBus } from "./core/eventBus";
import { DiagnosticsLog } from "./core/diagnostics";
import { createTaskMasterStore } from "./store/taskMasterStore";
import type { PluginSettings } from "./core/types";

export interface ServiceContainer {
  store: ReturnType<typeof createTaskMasterStore>;
  taskService: TaskService;
  boardService: BoardService;
  projectService: ProjectService;
  meetingService: MeetingService;
  events: EventBus;
  diagnostics: DiagnosticsLog;
  settings: PluginSettings;
  saveSettings: (s: PluginSettings) => Promise<void>;
}

export default class TaskMasterPlugin extends Plugin {
  private container: ServiceContainer | null = null;
  private indexService: IndexService | null = null;
  private taskRepo: TaskRepository | null = null;
  private boardRepo: BoardRepository | null = null;

  async onload() {
    const settingsRepo = new SettingsRepository(this);
    const settings = await settingsRepo.load();

    const dataRoot = settings.dataRootPath;
    const events = new EventBus();
    const diagnostics = new DiagnosticsLog();
    const store = createTaskMasterStore();

    const taskRepo = new TaskRepository(
      this.app, diagnostics, settings.saveDebounceMs,
      `${dataRoot}/Tasks`, `${dataRoot}/Archive`,
    );
    const boardRepo = new BoardRepository(
      this.app, diagnostics, `${dataRoot}/.board.json`, settings.saveDebounceMs,
    );
    const meetingRepo = new MeetingRepository(this.app, diagnostics, `${dataRoot}/Meetings`);
    const projectRepo = new ProjectRepository(this.app, diagnostics, `${dataRoot}/Projects`);

    const boardService = new BoardService(boardRepo, store, events);
    const taskService = new TaskService(taskRepo, boardService, store, events);
    const projectService = new ProjectService(projectRepo, store, events);
    const meetingService = new MeetingService(meetingRepo, store, events);

    this.indexService = new IndexService(
      this.app, this, store,
      taskRepo, boardRepo, meetingRepo, projectRepo,
      diagnostics, dataRoot,
    );

    this.taskRepo = taskRepo;
    this.boardRepo = boardRepo;

    this.container = {
      store, taskService, boardService, projectService, meetingService,
      events, diagnostics, settings,
      saveSettings: (s) => settingsRepo.save(s),
    };

    await this.indexService.bootstrap();

    this.registerView(
      VIEW_TYPE_TASKMASTER,
      (leaf) => new TaskMasterView(leaf, this.container!),
    );

    this.addRibbonIcon("layout-dashboard", "Open TaskMaster", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-taskmaster",
      name: "Open TaskMaster",
      callback: () => void this.activateView(),
    });
  }

  /**
   * ADR-0004: onunload는 sync. promise를 기다리지 않음.
   * 의미 데이터는 평소 즉시 flush되므로 손실 risk 없음.
   */
  onunload() {
    void this.taskRepo?.flush();
    void this.boardRepo?.flush();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASKMASTER);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TASKMASTER)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return;
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_TASKMASTER, active: true });
    }
    workspace.revealLeaf(leaf);
  }
}
```

### 8.2 `view/TaskMasterView.ts`

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import { App } from "../app/App";
import type { ServiceContainer } from "../main";

export const VIEW_TYPE_TASKMASTER = "taskmaster-view";

export class TaskMasterView extends ItemView {
  private root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly container: ServiceContainer) {
    super(leaf);
  }

  getViewType() { return VIEW_TYPE_TASKMASTER; }
  getDisplayText() { return "TaskMaster"; }
  getIcon() { return "layout-dashboard"; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("taskmaster-root");
    this.root = createRoot(root);
    this.root.render(
      React.createElement(App, { container: this.container, app: this.app }),
    );
  }

  async onClose() {
    this.root?.unmount();
    this.root = null;
  }
}
```

### 8.3 `app/providers/TaskMasterProvider.tsx`

```tsx
import * as React from "react";
import type { App as ObsidianApp } from "obsidian";
import type { ServiceContainer } from "../../main";

interface ContextValue extends ServiceContainer {
  app: ObsidianApp;
}

const Ctx = React.createContext<ContextValue | null>(null);

export const TaskMasterProvider: React.FC<{
  container: ServiceContainer;
  app: ObsidianApp;
  children: React.ReactNode;
}> = ({ container, app, children }) => {
  const value = React.useMemo(() => ({ ...container, app }), [container, app]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useServices(): ContextValue {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("TaskMasterProvider missing");
  return v;
}

export function useStore<T>(selector: (s: any) => T): T {
  const { store } = useServices();
  return store(selector);
}
```

## 9. UI Components

UI는 stateless하게 유지하고, store와 services에서만 데이터/액션을 가져온다.

### 9.1 `app/App.tsx`

```tsx
export const App: React.FC<{ container: ServiceContainer; app: ObsidianApp }> = ({ container, app }) => {
  return (
    <TaskMasterProvider container={container} app={app}>
      <BoardHeader />
      <KanbanBoard />
    </TaskMasterProvider>
  );
};
```

### 9.2 `ui/kanban/KanbanBoard.tsx`

```tsx
import { DndContext, DragEndEvent } from "@dnd-kit/core";
import { useFilteredBoard } from "../../store/selectors";
import { useServices } from "../../app/providers/TaskMasterProvider";
import { KanbanColumn } from "./KanbanColumn";
import { useIsMobile } from "../hooks/useIsMobile";

export const KanbanBoard: React.FC = () => {
  const { taskService, boardService } = useServices();
  const board = useFilteredBoard();
  const isMobile = useIsMobile();    // < 768px

  const handleDragEnd = (e: DragEndEvent) => {
    const taskId = e.active.id as TaskId;
    const targetColumnId = e.over?.id as ColumnId | undefined;
    if (!targetColumnId) return;
    void taskService.moveTask(taskId, targetColumnId);
  };

  if (isMobile) {
    return <MobileBoard board={board} />;   // dnd 없음 (ADR-0009)
  }

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <ul role="list" className="tm-flex tm-gap-4 tm-h-full">
        {board.columns.map((col) => (
          <KanbanColumn key={col.id} column={col} />
        ))}
      </ul>
    </DndContext>
  );
};
```

### 9.3 `ui/kanban/KanbanCard.tsx`

```tsx
import { useDraggable } from "@dnd-kit/core";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";

const STATUS_ORDER: ColumnId[] = ["todo", "doing", "done"];

export const KanbanCard: React.FC<{ taskId: TaskId }> = ({ taskId }) => {
  const { taskService, app } = useServices();
  const task = useStore((s) => s.tasks.get(taskId));
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: taskId });

  if (!task) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const idx = STATUS_ORDER.indexOf(task.status);
      const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
      if (nextIdx >= 0 && nextIdx < STATUS_ORDER.length) {
        void taskService.moveTask(taskId, STATUS_ORDER[nextIdx]);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      void taskService.openInEditor(taskId, app);
    } else if (e.key === "e" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void taskService.archiveTask(taskId);
    } else if (e.key === "Delete" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void confirmAndDelete(task, taskService);
    }
  };

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      tabIndex={0}
      role="listitem"
      aria-label={`${task.title}, status ${task.status}, priority ${task.priority ?? "none"}`}
      onKeyDown={handleKeyDown}
      onClick={() => void taskService.openInEditor(taskId, app)}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className="tm-rounded-md tm-p-3 tm-bg-tm-bg tm-text-tm-text"
    >
      <div className="tm-font-medium">{task.title}</div>
      <PriorityBadge priority={task.priority} />
    </li>
  );
};
```

**Contract**:
- 카드 click과 Enter는 동일하게 Obsidian editor 열기 (ADR-0010).
- Cmd/Ctrl+Enter는 다음 status, +Shift는 이전 status.
- aria-label은 screen reader가 카드 정보를 읽을 수 있도록 풀 정보 제공.

### 9.4 `ui/kanban/MobileBoard.tsx`

```tsx
export const MobileBoard: React.FC<{ board: BoardState }> = ({ board }) => {
  const [active, setActive] = React.useState<ColumnId>("todo");
  const column = board.columns.find((c) => c.id === active)!;

  return (
    <div className="tm-flex tm-flex-col tm-h-full">
      <SegmentedControl
        options={board.columns.map((c) => ({ id: c.id, label: c.title }))}
        value={active}
        onChange={setActive}
      />
      <ul role="list">
        {column.taskIds.map((id) => <MobileCard key={id} taskId={id} />)}
      </ul>
    </div>
  );
};

const MobileCard: React.FC<{ taskId: TaskId }> = ({ taskId }) => {
  const { taskService, app } = useServices();
  const task = useStore((s) => s.tasks.get(taskId));
  if (!task) return null;
  const idx = STATUS_ORDER.indexOf(task.status);
  const next = STATUS_ORDER[idx + 1];

  return (
    <li className="tm-flex tm-items-center tm-justify-between tm-p-3">
      <button onClick={() => void taskService.openInEditor(taskId, app)}>
        {task.title}
      </button>
      {next && (
        <button
          aria-label={`Move to ${next}`}
          onClick={() => void taskService.moveTask(taskId, next)}
        >
          →
        </button>
      )}
    </li>
  );
};
```

### 9.5 `ui/settings/SettingsPane.tsx`

Obsidian의 `PluginSettingTab` 안에 React를 mount. Phase 1 기본 항목만 노출.

```ts
import { PluginSettingTab, Setting } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";

export class TaskMasterSettingTab extends PluginSettingTab {
  private root: Root | null = null;

  display() {
    this.containerEl.empty();
    this.containerEl.addClass("taskmaster-root");
    this.root = createRoot(this.containerEl);
    this.root.render(<SettingsPane />);
  }

  hide() {
    this.root?.unmount();
    this.root = null;
  }
}

const SettingsPane: React.FC = () => {
  const { settings, saveSettings, diagnostics } = useServices();
  return (
    <div>
      <h2>{t("settings.dataRoot.title")}</h2>
      <input type="text" value={settings.dataRootPath} disabled />
      <h2>{t("settings.debounce.title")}</h2>
      <input
        type="number" min={100} max={2000}
        value={settings.saveDebounceMs}
        onChange={(e) => void saveSettings({ ...settings, saveDebounceMs: Number(e.target.value) })}
      />
      <DiagnosticsPane diagnostics={diagnostics} />
    </div>
  );
};
```

## 10. Cross-cutting

### 10.1 `core/eventBus.ts`

```ts
import type { TaskMasterEvent } from "./types";

type Handler = (e: TaskMasterEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Handler>();

  subscribe(handler: Handler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  emit(event: TaskMasterEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); }
      catch (err) { console.error("[TaskMaster] event handler failed", err); }
    }
  }
}
```

### 10.2 `core/diagnostics.ts`

```ts
import type { DiagnosticEntry } from "./types";
import { Notice } from "obsidian";

const NOTICE_THROTTLE_MS = 5000;

export class DiagnosticsLog {
  private entries: DiagnosticEntry[] = [];
  private static readonly MAX = 50;
  private lastNoticeAt = new Map<string, number>();

  record(input: Omit<DiagnosticEntry, "ts">): void {
    const entry = { ts: new Date().toISOString() as any, ...input };
    this.entries = [entry, ...this.entries].slice(0, DiagnosticsLog.MAX);
    console.warn("[TaskMaster]", entry);
    this.maybeNotify(entry);
  }

  list(): readonly DiagnosticEntry[] {
    return this.entries;
  }

  private maybeNotify(entry: DiagnosticEntry): void {
    if (entry.kind === "boot") return;
    const key = entry.kind;
    const last = this.lastNoticeAt.get(key) ?? 0;
    const now = Date.now();
    if (now - last < NOTICE_THROTTLE_MS) return;
    this.lastNoticeAt.set(key, now);
    new Notice(this.userMessage(entry));
  }

  private userMessage(entry: DiagnosticEntry): string {
    switch (entry.kind) {
      case "parse": return `TaskMaster: failed to parse ${entry.path}`;
      case "flush": return `TaskMaster: failed to save changes`;
      case "conflict": return `TaskMaster: conflict detected for ${entry.entityId}`;
      default: return `TaskMaster: ${entry.message}`;
    }
  }
}
```

**Contract**:
- 같은 kind의 Notice는 5초당 1회만 표시.
- entries는 최신 50개만 메모리 보관.
- console.warn은 throttle 없음 (개발자 디버깅용).

### 10.3 `i18n/index.ts`

```ts
import { moment } from "obsidian";
import ko from "./ko";
import en from "./en";

const locales = { ko, en } as const;
type LocaleKey = keyof typeof locales;
export type StringKey = keyof typeof ko;

let current: typeof ko = en;

export function initI18n(localePref: "auto" | "ko" | "en"): void {
  const resolved: LocaleKey = localePref === "auto"
    ? (moment.locale().startsWith("ko") ? "ko" : "en")
    : localePref;
  current = locales[resolved];
}

export function t(key: StringKey): string {
  return current[key] ?? en[key] ?? key;
}
```

`i18n/ko.ts`와 `i18n/en.ts`는 동일 key 집합을 가져야 한다 (ts type으로 강제).

```ts
// i18n/ko.ts
export default {
  "kanban.column.todo": "할 일",
  "kanban.column.doing": "진행 중",
  "kanban.column.done": "완료",
  "kanban.card.openNote": "노트 열기",
  "kanban.card.archive": "보관",
  "kanban.card.delete": "삭제",
  "kanban.card.confirmDelete": "이 task를 삭제하시겠습니까?",
  "settings.dataRoot.title": "데이터 루트 경로",
  "settings.debounce.title": "저장 debounce 시간 (ms)",
  "settings.diagnostics.title": "Diagnostics",
  "project.selector.all": "모든 프로젝트",
  "project.selector.none": "프로젝트 없음",
  "project.selector.new": "+ 새 프로젝트",
  // ...
};
```

### 10.4 Error handling 정책

| Layer | 방침 |
| --- | --- |
| Parser | 검증 실패는 `null` 반환. throw는 라이브러리 오류만. |
| Repository | I/O 실패는 retry, 최종 실패는 `DiagnosticsLog.record` + retry queue. |
| Service | 도메인 위반(불가능 상태)은 throw. 호출 측이 catch해서 처리. |
| UI | Service 호출은 try-catch로 감싸고 실패 시 Notice로 알림. |

각 layer는 자기 위 layer로 implementation detail을 leak하지 않는다.

## 11. Sequence Diagrams

### 11.1 카드 drag로 Todo → Doing

```
User              KanbanCard         TaskService        TaskRepository      Vault
 │ drag end         │                    │                    │                  │
 ├─────────────────►│                    │                    │                  │
 │                  │ moveTask(id,doing) │                    │                  │
 │                  ├───────────────────►│                    │                  │
 │                  │                    │ store.tasks.get    │                  │
 │                  │                    │ (sync)             │                  │
 │                  │                    │ saveImmediate(t)   │                  │
 │                  │                    ├───────────────────►│                  │
 │                  │                    │                    │ vault.read (mtime)│
 │                  │                    │                    ├─────────────────►│
 │                  │                    │                    │◄─────────────────┤
 │                  │                    │                    │ vault.modify     │
 │                  │                    │                    ├─────────────────►│
 │                  │                    │                    │◄─────────────────┤
 │                  │                    │ store.upsertTask   │                  │
 │                  │                    │ board.move (sync)  │                  │
 │                  │                    │ board.queueWrite   │                  │
 │                  │                    │ events.emit        │                  │
 │                  │                    │◄───────────────────┤                  │
 │                  │ (re-render via store)                   │                  │
 │                  │                                         │ (debounce 500ms) │
 │                  │                                         │ vault.modify     │
 │                  │                                         │   (.board.json)  │
 │                  │                                         ├─────────────────►│
```

### 11.2 외부 modify 반영

```
External tool      Obsidian            metadataCache       IndexService        Store
 │ vault.modify     │                    │                    │                  │
 ├─────────────────►│                    │                    │                  │
 │                  │ parse frontmatter  │                    │                  │
 │                  ├───────────────────►│                    │                  │
 │                  │                    │ emit "changed"     │                  │
 │                  │                    ├───────────────────►│                  │
 │                  │                    │                    │ cachedRead       │
 │                  │                    │                    │ parseTask        │
 │                  │                    │                    │ store.upsertTask │
 │                  │                    │                    ├─────────────────►│
 │                  │                    │                    │ board.reconcile  │
 │                  │                    │                    │ store.setBoard   │
 │                  │                    │                    │ board.queueWrite │
```

### 11.3 Conflict 발생

```
TaskService        TaskRepository       Vault                Diagnostics
 │ saveImmediate(t) │                    │                    │
 ├─────────────────►│                    │                    │
 │                  │ vault.read         │                    │
 │                  ├───────────────────►│                    │
 │                  │◄───────────────────┤                    │
 │                  │ mtime > knownMtime?│                    │
 │                  │ → handleConflict   │                    │
 │                  │ parseTask(remote)  │                    │
 │                  │ merge              │                    │
 │                  │ vault.modify       │                    │
 │                  ├───────────────────►│                    │
 │                  │ (or writeConflictedCopy if merge fails) │
 │                  │ record conflict ───►│                   │
 │                  │                    │     (Notice throttle)
```

## 12. Edge Cases 통합 표

| 시나리오 | 처리 |
| --- | --- |
| Markdown 파싱 실패 | parser null → diagnostics 기록 → 보드에 표시 안 함. 사용자 수정 시 metadataCache.changed로 복구. |
| 사용자가 직접 frontmatter id 변경 | 기존 entity가 store에서 사라지고 새 entity로 인덱싱. 이전 board entry는 reconcile에서 제거. |
| 사용자가 파일 직접 삭제 | vault.delete event → store에서 제거 + board reconcile. |
| 사용자가 파일 외부에서 rename | vault.rename event → store entity의 path만 갱신. |
| 두 device에서 같은 task 동시 수정 | mtime conflict → 단순 merge → 실패 시 conflicted copy. |
| 두 device에서 .board.json 동시 변경 | sync tool이 conflict marker 생성 → load 실패 → rebuild + queueWrite로 정상화. |
| onunload 직전 status 변경 | saveImmediate가 디스크에 이미 commit (debounce 없음). |
| onunload 직전 reorder | 가능 시 flush, 못해도 다음 boot 시 reconcile로 의미 손실 없음. |
| short ID 8자 충돌 | makeShortId가 9자, 10자로 자동 확장. |
| 폴더가 사용자에 의해 삭제 | bootstrap 다음 호출에서 ensureFolders로 재생성. |
| Vault가 read-only (드물지만 가능) | persist가 throw → retry → 최종 실패 → diagnostics + retry queue. |
| Obsidian sync가 .board.json을 일시적으로 lock | persist가 throw → retry로 복구. |
| metadataCache가 frontmatter를 아직 못 읽음 | handleMetaChanged에서 fm undefined → skip, 다음 changed event를 기다림. |
| 너무 많은 task (10000+) | findAll이 metadataCache로도 1초 이상 걸림. Phase 1은 명시적 unsupported, Phase 4 가상화. |

## 13. Test Plan

| 모듈 | 테스트 종류 | 핵심 케이스 |
| --- | --- | --- |
| `core/ids` | 단위 | newId 충돌, makeShortId 길이 확장, isValidId |
| `core/paths` | 단위 | safeTitle 변환, 한글, 빈 입력, 60자 cap |
| `parser/frontmatter` | 단위 | round-trip, passthrough 보존, 순서 보존, 빈 frontmatter |
| `parser/taskMarkdown` | 단위 | parseTask null 반환, archivedAt 처리, title 갱신 |
| `repositories/SettingsRepository` | 단위 | 손상 settings → 기본값 |
| `repositories/TaskRepository` | 단위+integ | findAll, saveImmediate 동시성, persist conflict, archive, delete |
| `repositories/BoardRepository` | 단위 | rebuildFromTasks, reconcile, resolveSyncConflict, queueWrite debounce |
| `services/IndexService` | integ | bootstrap, vault event 라우팅, polluted file 처리 |
| `services/TaskService` | 단위 | createTask, moveTask no-op, archive, delete |
| `services/BoardService` | 단위 | move, reorderInColumn, remove |
| `store/taskMasterStore` | 단위 | actions, selector 동등성 |
| `core/eventBus` | 단위 | subscribe/unsubscribe, handler 예외 격리 |
| `core/diagnostics` | 단위 | throttle, MAX 유지 |
| UI components | RTL | KanbanCard 키보드 단축키, MobileBoard 액션 버튼, 접근성 ARIA |

수동 QA checklist (PRD §10.7, §12.2):

- View open/close 50회 → 메모리 stable.
- 두 leaf에 동시 view → 동기화.
- `.board.json` 삭제 → reload → 결정적 재구성.
- iOS/Android Obsidian → 액션 버튼 동작.
- 키보드만으로 카드 생성/이동/순서 변경.
- 1000개 task fixture → 초기 렌더링 1초 이내.

## 14. Build Configuration

### 14.1 esbuild

```js
// esbuild.config.mjs
import esbuild from "esbuild";
import process from "process";
import fs from "fs/promises";

const isProd = process.argv.includes("--prod");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  platform: "browser",
  target: "es2020",
  outfile: "dist/main.js",
  sourcemap: !isProd,
  minify: isProd,
  treeShaking: true,
  jsx: "automatic",
});

if (isProd) {
  await ctx.rebuild();
  await fs.copyFile("manifest.json", "dist/manifest.json");
  await fs.copyFile("src/styles/built.css", "dist/styles.css");
  await ctx.dispose();
} else {
  await ctx.watch();
}
```

### 14.2 tsconfig

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "jsx": "react-jsx",
    "lib": ["ES2020", "DOM"],
    "types": ["obsidian"],
    "skipLibCheck": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

### 14.3 Tailwind

```js
// tailwind.config.js
module.exports = {
  prefix: "tm-",
  content: ["./src/**/*.{ts,tsx}"],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        "tm-bg": "var(--background-primary)",
        "tm-bg-alt": "var(--background-secondary)",
        "tm-text": "var(--text-normal)",
        "tm-muted": "var(--text-muted)",
        "tm-accent": "var(--interactive-accent)",
        "tm-border": "var(--background-modifier-border)",
      },
    },
  },
};
```

CSS는 `src/styles/tailwind.css`에 작성, postcss로 `dist/styles.css` 산출.

```css
/* src/styles/tailwind.css */
@tailwind utilities;

.taskmaster-root {
  height: 100%;
  overflow: hidden;
}
```

`@tailwind base`는 사용하지 않음 (preflight 비활성화).

### 14.4 ESLint dependency 강제

```js
// .eslintrc.cjs
module.exports = {
  rules: {
    "import/no-restricted-paths": ["error", {
      zones: [
        { target: "./src/ui",         from: "./src/repositories", message: "UI must not import repositories" },
        { target: "./src/ui",         from: "obsidian",           message: "UI must not import obsidian" },
        { target: "./src/services",   from: "obsidian",           message: "services must not import obsidian" },
        { target: "./src/services",   from: "react",              message: "services must not import react" },
        { target: "./src/parser",     from: "obsidian",           message: "parser must not import obsidian" },
        { target: "./src/repositories/!(_)*",
          from: "./src/services",     message: "repositories must not import services" },
      ],
    }],
  },
};
```

## 15. Open Implementation Questions

다음은 명세에서 결정하지 않고 구현 단계에서 결정해도 충분한 항목.

| 항목 | 결정 시점 | 영향 |
| --- | --- | --- |
| YAML 파서: js-yaml vs 자체 minimal | parser 구현 시 | passthrough 정확도, 번들 크기 |
| `useIsMobile` 기준: viewport vs Platform.isMobile | KanbanBoard 구현 시 | 모바일 분기 정확도 |
| Confirm dialog: native confirm vs Obsidian Modal | TaskService.deleteTask UI 호출부 | UX 일관성 |
| 키보드 단축키 충돌 (Obsidian default와) | KanbanCard 구현 시 | 사용자가 expected 단축키를 못 쓸 가능성 |
| `.board.json` indent: 2 vs 0 | BoardRepository.persist 구현 시 | sync diff 가독성 |
| Settings tab 위치: Plugin SettingsTab만 vs View 안에도 | SettingsPane 통합 시 | 발견성 |

각 항목은 결정되면 그 시점에 PR 본문 또는 ADR-0011, 0012, ...로 기록한다.
