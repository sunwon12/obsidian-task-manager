// LLD §2: 모든 모듈이 import하는 핵심 타입 정의.
// branded type으로 ID 혼용 방지, exactOptionalPropertyTypes에 맞춘 형태.

// ---------- Branded IDs ----------

export type TaskId = string & { readonly __brand: "TaskId" };
export type MeetingId = string & { readonly __brand: "MeetingId" };
export type ProjectId = string & { readonly __brand: "ProjectId" };

export type IsoDateTime = string & { readonly __brand: "IsoDateTime" };
export type IsoDate = string & { readonly __brand: "IsoDate" };

// ---------- Enums ----------

export const TASK_STATUS_ORDER = [
  "backlog",
  "hold",
  "todo",
  "doing",
  "in-review",
  "done",
] as const;

export type ColumnId = (typeof TASK_STATUS_ORDER)[number];
export type TaskStatus = ColumnId;
export type Priority = "low" | "medium" | "high";

export const SCHEMA_VERSION = 1 as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

export const DEFAULT_BOARD_COLUMN_DEFS: ReadonlyArray<{
  readonly id: ColumnId;
  readonly title: string;
}> = [
  { id: "backlog", title: "BACKLOG" },
  { id: "hold", title: "HOLD" },
  { id: "todo", title: "TODO" },
  { id: "doing", title: "DOING" },
  { id: "in-review", title: "IN REVIEW" },
  { id: "done", title: "DONE" },
];

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && TASK_STATUS_ORDER.includes(v as TaskStatus);
}

export function normalizeHiddenStatuses(values: readonly unknown[]): ColumnId[] {
  const requested = new Set(values.filter(isTaskStatus));
  const hidden = TASK_STATUS_ORDER.filter((status) => requested.has(status));
  return hidden.length >= TASK_STATUS_ORDER.length ? hidden.slice(0, -1) : hidden;
}

// ---------- Domain entities ----------

export interface Task {
  schemaVersion: SchemaVersion;
  id: TaskId;
  type: "task";
  status: TaskStatus;
  /** Markdown H1에서 derive한 표시용 title */
  title: string;
  project: ProjectId | null;
  priority: Priority | null;
  /** 외부 issue tracker key (예: "M29CEF-3126"). null이면 frontmatter에서 제거. */
  jiraKey: string | null;
  /** 카드에 표시할 짧은 plain text 비고. null이면 frontmatter에서 제거. */
  remarks: string | null;
  /** 견적 공수(MD, 일 단위). Jira Estimate MD 등에서 동기화. null이면 frontmatter에서 제거. */
  estimateMd?: number | null;
  /** 실제 투입 공수(MD). 완료 후 기록/동기화. null이면 frontmatter에서 제거. */
  actualMd?: number | null;
  /** 마감일 YYYY-MM-DD. null이면 frontmatter에서 제거. */
  due?: string | null;
  /** 업무, 학습 등 카드 분류용 사용자 태그. */
  tags?: string[];
  /** 타이머 아래에 순서대로 보여줄 작업 계획. */
  steps?: string[];
  /** 1부터 시작하는 현재 작업 단계. 이전 단계는 완료로 표시한다. */
  currentStep?: number | null;
  /** 각 작업 단계에서 측정한 누적 시간(초). steps와 같은 index를 쓴다. */
  stepSeconds?: number[];
  /** 검색/카드 preview용 Markdown body 첫 요약. 디스크에는 저장하지 않고 parse/create에서 derive. */
  bodySummary?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** archive된 경우 시각, 그렇지 않으면 null */
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
  schemaVersion: SchemaVersion;
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
  schemaVersion: SchemaVersion;
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

// ---------- Board ----------

export interface BoardColumn {
  id: ColumnId;
  title: string;
  taskIds: TaskId[];
}

export interface BoardState {
  version: 1;
  /** 항상 TASK_STATUS_ORDER 순서 */
  columns: BoardColumn[];
  updatedAt: IsoDateTime;
}

// ---------- Frontmatter wire types ----------

/** Markdown 파일에서 읽은 frontmatter 한 단계 추상 */
export interface ParsedFrontmatter {
  /** 우리가 인식한 field만 */
  managed: Record<string, unknown>;
  /** unknown field — ADR-0008 passthrough */
  passthrough: Record<string, unknown>;
  /** 원본 순서 */
  fieldOrder: string[];
}

/** 직렬화 직전의 task frontmatter 표현 */
export interface TaskFrontmatterDoc {
  schemaVersion: SchemaVersion;
  id: string;
  type: "task";
  status: TaskStatus;
  project: string | null;
  priority: Priority | null;
  /** undefined면 frontmatter에서 제거 */
  jiraKey?: string;
  /** undefined면 frontmatter에서 제거 */
  remarks?: string;
  /** undefined면 frontmatter에서 제거 */
  estimateMd?: number;
  /** undefined면 frontmatter에서 제거 */
  actualMd?: number;
  /** undefined면 frontmatter에서 제거 */
  due?: string;
  /** undefined면 frontmatter에서 제거 */
  tags?: string[];
  /** undefined면 frontmatter에서 제거 */
  currentStep?: number;
  createdAt: string;
  updatedAt: string;
  /** undefined면 frontmatter에서 제거 */
  archivedAt?: string;
}

export interface MeetingFrontmatterDoc {
  schemaVersion: SchemaVersion;
  id: string;
  type: "meeting";
  project: string | null;
  date: string;
  participants: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFrontmatterDoc {
  schemaVersion: SchemaVersion;
  id: string;
  type: "project";
  createdAt: string;
  updatedAt: string;
}

// ---------- Service inputs ----------

export interface CreateTaskInput {
  title: string;
  status?: TaskStatus;
  project?: ProjectId | null;
  priority?: Priority | null;
  jiraKey?: string | null;
  remarks?: string | null;
  estimateMd?: number | null;
  actualMd?: number | null;
  due?: string | null;
  tags?: string[];
  steps?: string[];
  currentStep?: number | null;
  stepSeconds?: number[];
  body?: string;
}

export interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
  project?: ProjectId | null;
  priority?: Priority | null;
  jiraKey?: string | null;
  remarks?: string | null;
  estimateMd?: number | null;
  actualMd?: number | null;
  due?: string | null;
  tags?: string[];
  steps?: string[];
  currentStep?: number | null;
  stepSeconds?: number[];
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

// ---------- Event bus ----------

export type ConflictReason = "external_modify" | "merge_failed" | "sync_collision";

export type TaskMasterEvent =
  | { type: "tasks:indexed"; tasks: Task[] }
  | { type: "task:created"; task: Task }
  | { type: "task:updated"; task: Task; previous: Task }
  | { type: "task:deleted"; taskId: TaskId }
  | { type: "task:archived"; taskId: TaskId }
  | { type: "board:updated"; board: BoardState }
  | { type: "vault:conflict"; entityId: string; path: string; reason: ConflictReason }
  | { type: "parser:error"; path: string; reason: string };

// ---------- Diagnostics ----------

export type DiagnosticKind = "parse" | "flush" | "conflict" | "boot" | "sync";

export interface DiagnosticEntry {
  ts: IsoDateTime;
  kind: DiagnosticKind;
  path?: string;
  entityId?: string;
  message: string;
  cause?: string;
}

// ---------- Settings ----------

export interface PluginSettings {
  version: 1;
  /** 기본 "TaskMaster" */
  dataRootPath: string;
  /** 기본 500ms */
  saveDebounceMs: number;
  /** 기본 true */
  confirmOnDelete: boolean;
  /** 기본 "auto" */
  locale: "auto" | "ko" | "en";
  /** 외부 issue tracker base URL. 끝의 "/"는 자동 보정. 빈 문자열이면 link 비활성. */
  jiraBaseUrl: string;
  /** Jira REST API 서버의 origin. 예: https://jira.example.com */
  jiraApiUrl: string;
  /** Cloud는 email + API token(Basic), Data Center는 PAT(Bearer)을 선택한다. */
  jiraAuthType: "basic" | "bearer";
  jiraEmail: string;
  /** Obsidian plugin data에만 저장하며 task Markdown이나 Vault에는 쓰지 않는다. */
  jiraApiToken: string;
  /** 내 이슈 범위를 제한하는 Jira Query Language. */
  jiraJql: string;
  /** Jira REST API major version. Cloud는 3, Server/Data Center는 보통 2. */
  jiraApiVersion: "2" | "3";
  /** 견적 MD가 담긴 Jira 커스텀 필드 id (예: customfield_12766). 빈 값이면 미조회. */
  jiraEstimateMdFieldId: string;
  /** 실제 MD가 담긴 Jira 커스텀 필드 id (예: customfield_12767). 빈 값이면 미조회. */
  jiraActualMdFieldId: string;
  /** 0이면 자동 동기화하지 않고 버튼/명령으로만 동기화한다. */
  jiraSyncIntervalMinutes: number;
  /** YYYY-MM-DD. 비어 있으면 스프린트 자동 보관을 실행하지 않는다. */
  sprintStartDate: string;
  sprintLengthDays: number;
  autoArchiveDoneAtSprintEnd: boolean;
  /** 동일한 스프린트 경계에서 중복 보관하지 않기 위한 device-local marker. */
  lastArchivedSprintEnd: string;
  /** UI 전용: 숨긴 kanban status 목록. task/board semantic data와 분리한다. */
  hiddenStatuses: ColumnId[];
  /** 빠른 패널의 AI 리포트 섹션과 자동 실행을 켠다. */
  aiReportEnabled: boolean;
  /** claude 실행 파일. PATH에 있으면 이름만 둔다. */
  aiReportBinary: string;
  /** `claude -p` 에 넘길 프롬프트. 보통 슬래시 스킬 이름. */
  aiReportPrompt: string;
  /** 스킬이 리포트를 기록하는 vault 상대 경로. */
  aiReportPath: string;
  /** 자동 실행 시각 "HH:MM". 비우면 버튼으로만 실행한다. */
  aiReportScheduleAt: string;
  /** 한 번 실행에 허용하는 시간(분). */
  aiReportTimeoutMinutes: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  version: 1,
  dataRootPath: "TaskMaster",
  saveDebounceMs: 500,
  confirmOnDelete: true,
  locale: "auto",
  jiraBaseUrl: "",
  jiraApiUrl: "",
  jiraAuthType: "bearer",
  jiraEmail: "",
  jiraApiToken: "",
  jiraJql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
  jiraApiVersion: "2",
  jiraEstimateMdFieldId: "",
  jiraActualMdFieldId: "",
  jiraSyncIntervalMinutes: 15,
  sprintStartDate: "",
  sprintLengthDays: 14,
  autoArchiveDoneAtSprintEnd: true,
  lastArchivedSprintEnd: "",
  hiddenStatuses: [],
  aiReportEnabled: true,
  aiReportBinary: "claude",
  aiReportPrompt: "/daily-schedule-feedback",
  aiReportPath: "02_일상/03_성찰/일일-일정-피드백.md",
  aiReportScheduleAt: "08:40",
  aiReportTimeoutMinutes: 10,
};
