// LLD §6.2: TaskService.
// 모든 의미 변경은 saveImmediate (ADR-0004). open-in-editor는 UI 레이어에서 직접 처리.

import type { TaskRepository } from "../repositories/TaskRepository";
import type { EventBus } from "../core/eventBus";
import type { TaskMasterStore } from "../store/taskMasterStore";
import { newId } from "../core/ids";
import { nowIso } from "../core/time";
import { SCHEMA_VERSION } from "../core/types";
import type {
  CreateTaskInput, Priority, ProjectId, Task, TaskId, TaskStatus, UpdateTaskInput,
} from "../core/types";
import type { BoardService } from "./BoardService";
import type { JiraIssue } from "../repositories/JiraRepository";
import { appendMemoToBody } from "../core/taskMemo";

/**
 * Jira 이슈 1건 반영 결과.
 * blocked = 디스크엔 같은 jiraKey 파일이 있는데 인덱스에 없어 생성을 막은 경우.
 */
export type JiraUpsertOutcome =
  | { outcome: "created" | "updated" | "skipped" }
  | { outcome: "blocked"; jiraKey: string; path: string };

export class TaskService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly board: BoardService,
    private readonly store: TaskMasterStore,
    private readonly events: EventBus,
  ) {}

  async createTask(input: CreateTaskInput): Promise<Task> {
    const status: TaskStatus = input.status ?? "todo";
    const id = newId("task") as TaskId;
    const jiraKey = (input.jiraKey ?? "").trim() || null;
    const remarks = (input.remarks ?? "").trim() || null;
    const estimateMd = input.estimateMd ?? null;
    const actualMd = input.actualMd ?? null;
    const due = (input.due ?? "").trim() || null;
    const tags = normalizeTags(input.tags ?? []);
    const steps = normalizeSteps(input.steps ?? []);
    const currentStep = normalizeCurrentStep(input.currentStep, steps, true);
    const stepSeconds = normalizeStepSeconds(input.stepSeconds, steps.length);
    const draft: Task = {
      schemaVersion: SCHEMA_VERSION,
      id,
      type: "task",
      status,
      title: input.title.trim() || "Untitled",
      project: input.project ?? null,
      priority: input.priority ?? null,
      jiraKey,
      remarks,
      estimateMd,
      actualMd,
      due,
      tags,
      steps,
      currentStep,
      stepSeconds,
      bodySummary: summarizeBody(input.body ?? ""),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archivedAt: null,
      passthrough: {},
      fieldOrder: [
        "schemaVersion", "id", "type", "status", "project",
        "priority", ...(jiraKey ? ["jiraKey"] : []), ...(remarks ? ["remarks"] : []),
        ...(estimateMd != null ? ["estimateMd"] : []), ...(actualMd != null ? ["actualMd"] : []),
        ...(due ? ["due"] : []), ...(tags.length ? ["tags"] : []),
        ...steps.flatMap((_, index) => [
          `step${index + 1}`,
          ...(stepSeconds[index] ? [`step${index + 1}Seconds`] : []),
        ]),
        ...(currentStep != null ? ["currentStep"] : []),
        "createdAt", "updatedAt",
      ],
      knownMtime: 0,
      path: "",
    };

    const persisted = await this.tasks.create(draft, input.body ?? "");
    this.store.getState().upsertTask(persisted);
    this.board.appendToColumn(status, persisted.id);
    this.events.emit({ type: "task:created", task: persisted });
    return persisted;
  }

  async moveTask(taskId: TaskId, nextStatus: TaskStatus): Promise<Task> {
    const previous = this.requireTask(taskId);
    if (previous.status === nextStatus) return previous;

    const updated: Task = { ...previous, status: nextStatus, updatedAt: nowIso() };
    await this.tasks.saveImmediate(updated);
    this.store.getState().upsertTask(updated);
    this.board.move(taskId, previous.status, nextStatus);
    this.events.emit({ type: "task:updated", task: updated, previous });
    return updated;
  }

  async updateTitle(taskId: TaskId, title: string): Promise<Task> {
    return this.updateTask(taskId, { title });
  }

  async updatePriority(taskId: TaskId, priority: Priority | null): Promise<Task> {
    return this.updateTask(taskId, { priority });
  }

  async setJiraKey(taskId: TaskId, jiraKey: string | null): Promise<Task> {
    return this.updateTask(taskId, { jiraKey });
  }

  async setRemarks(taskId: TaskId, remarks: string | null): Promise<Task> {
    return this.updateTask(taskId, { remarks });
  }

  async setProject(taskId: TaskId, projectId: ProjectId | null): Promise<Task> {
    return this.updateTask(taskId, { project: projectId });
  }

  async updateTask(taskId: TaskId, input: UpdateTaskInput): Promise<Task> {
    const previous = this.requireTask(taskId);
    let next: Task = previous;

    if (hasOwn(input, "title")) {
      const title = input.title?.trim() || "Untitled";
      if (title !== next.title) next = { ...next, title };
    }

    if (hasOwn(input, "status") && input.status && input.status !== next.status) {
      next = { ...next, status: input.status };
    }

    if (hasOwn(input, "priority")) {
      const priority = input.priority ?? null;
      if (priority !== next.priority) next = { ...next, priority };
    }

    if (hasOwn(input, "project")) {
      const project = input.project ?? null;
      if (project !== next.project) next = { ...next, project };
    }

    if (hasOwn(input, "jiraKey")) {
      const jiraKey = (input.jiraKey ?? "").trim() || null;
      if (jiraKey !== next.jiraKey) next = { ...next, jiraKey };
    }

    if (hasOwn(input, "remarks")) {
      const remarks = (input.remarks ?? "").trim() || null;
      if (remarks !== next.remarks) next = { ...next, remarks };
    }

    if (hasOwn(input, "estimateMd")) {
      const estimateMd = input.estimateMd ?? null;
      if (estimateMd !== (next.estimateMd ?? null)) next = { ...next, estimateMd };
    }

    if (hasOwn(input, "actualMd")) {
      const actualMd = input.actualMd ?? null;
      if (actualMd !== (next.actualMd ?? null)) next = { ...next, actualMd };
    }

    if (hasOwn(input, "due")) {
      const due = (input.due ?? "").trim() || null;
      if (due !== (next.due ?? null)) next = { ...next, due };
    }

    if (hasOwn(input, "tags")) {
      const tags = normalizeTags(input.tags ?? []);
      if (tags.join("\u0000") !== (next.tags ?? []).join("\u0000")) next = { ...next, tags };
    }

    if (hasOwn(input, "steps")) {
      const steps = normalizeSteps(input.steps ?? []);
      if (steps.join("\u0000") !== (next.steps ?? []).join("\u0000")) {
        next = {
          ...next,
          steps,
          currentStep: normalizeCurrentStep(next.currentStep, steps, true),
          stepSeconds: normalizeStepSeconds(next.stepSeconds, steps.length),
        };
      }
    }

    if (hasOwn(input, "currentStep")) {
      const currentStep = normalizeCurrentStep(input.currentStep, next.steps ?? [], false);
      if (currentStep !== (next.currentStep ?? null)) next = { ...next, currentStep };
    }

    if (hasOwn(input, "stepSeconds")) {
      const stepSeconds = normalizeStepSeconds(input.stepSeconds, next.steps?.length ?? 0);
      if (stepSeconds.join("\u0000") !== (next.stepSeconds ?? []).join("\u0000")) {
        next = { ...next, stepSeconds };
      }
    }

    if (next === previous) return previous;

    const updated: Task = { ...next, updatedAt: nowIso() };
    await this.tasks.saveImmediate(updated);
    this.store.getState().upsertTask(updated);
    if (updated.status !== previous.status) {
      this.board.move(taskId, previous.status, updated.status);
    }
    this.events.emit({ type: "task:updated", task: updated, previous });
    return updated;
  }

  async archiveTask(taskId: TaskId): Promise<void> {
    const task = this.requireTask(taskId);
    const archived = await this.tasks.archive(task);
    this.store.getState().upsertTask(archived);
    this.board.remove(taskId);
    this.events.emit({ type: "task:archived", taskId });
  }

  async restoreTask(taskId: TaskId): Promise<Task> {
    const task = this.requireTask(taskId);
    const restored = await this.tasks.restore(task);
    this.store.getState().upsertTask(restored);
    this.board.appendToColumn(restored.status, restored.id);
    this.events.emit({ type: "task:updated", task: restored, previous: task });
    return restored;
  }

  async deleteTask(taskId: TaskId): Promise<void> {
    await this.tasks.delete(taskId);
    this.store.getState().removeTask(taskId);
    this.board.remove(taskId);
    this.events.emit({ type: "task:deleted", taskId });
  }

  /** Jira issue key를 identity로 하여 기존 카드 갱신 또는 새 카드 생성. archive된 카드는 되살리지 않는다. */
  /** 디스크의 jiraKey 목록. 생성 전 중복 확인용 (파싱 실패 파일 포함). */
  async jiraKeysOnDisk(): Promise<Map<string, string>> {
    return this.tasks.jiraKeysOnDisk();
  }

  async upsertJiraIssue(
    issue: JiraIssue,
    onDisk?: ReadonlyMap<string, string>,
  ): Promise<JiraUpsertOutcome> {
    const existing = [...this.store.getState().tasks.values()]
      .find((task) => task.jiraKey === issue.key);
    const fields = {
      title: issue.summary,
      status: jiraStatusToTaskStatus(issue.statusName, issue.statusCategoryKey),
      estimateMd: issue.estimateMd,
      due: issue.dueDate,
      // 타이머(T-901) 등 로컬에서 기록한 actualMd 보호: Jira에 값이 있을 때만 반영하고,
      // Jira 필드가 비어 있다는 이유로 로컬 기록을 지우지는 않는다.
      ...(issue.actualMd != null ? { actualMd: issue.actualMd } : {}),
    };
    if (!existing) {
      // store엔 없는데 디스크엔 있다 = 그 파일이 깨져서 인덱스에 못 올라왔다는 뜻.
      // 여기서 만들면 사용자가 손으로 넣은 step·태그가 든 원본이 중복에 묻힌다.
      // 파일을 고칠 때까지 아무것도 안 만드는 쪽이 항상 안전하다.
      const orphanPath = onDisk?.get(issue.key);
      if (orphanPath) return { outcome: "blocked", jiraKey: issue.key, path: orphanPath };
      await this.createTask({ ...fields, jiraKey: issue.key, body: issue.description });
      return { outcome: "created" };
    }
    if (existing.archivedAt) return { outcome: "skipped" };
    const updated = await this.updateTask(existing.id, fields);
    await this.backfillJiraBody(updated, issue.description);
    return { outcome: "updated" };
  }

  /**
   * Jira description 본문 백필. 사용자가 본문을 이미 썼을 수 있으므로
   * "제목 heading 외에 아무것도 없는" 태스크에만 1회 채운다 — 동기화가
   * 사용자의 메모를 덮어쓰는 일은 없어야 한다.
   */
  private async backfillJiraBody(task: Task, description: string): Promise<void> {
    if (!description.trim()) return;
    const body = await this.tasks.readBody(task.id);
    const withoutTitle = body.replace(/^#\s+.+$/mu, "").trim();
    if (withoutTitle.length > 0) return;
    const filled = await this.tasks.writeBody(task, description);
    this.store.getState().upsertTask(filled);
  }

  /**
   * 카드 본문에 메모 한 건을 덧붙인다. 랏코 패널에서 작업 중간에 상황을 적는 경로다.
   * 본문 전체를 다시 쓰지만 append 결과만 쓰므로 기존 내용은 보존된다.
   */
  async appendMemo(taskId: TaskId, text: string, now: Date = new Date()): Promise<void> {
    if (!text.trim()) return;
    const task = this.requireTask(taskId);
    const body = await this.tasks.readBody(taskId);
    const next = appendMemoToBody(body, text, now);
    if (next === body) return;
    const saved = await this.tasks.writeBody(task, next);
    this.store.getState().upsertTask({ ...saved, bodySummary: summarizeBody(next) });
  }

  /** UI에서 본문 보기 위해 path를 노출. open은 UI가 obsidian으로 직접. */
  getTaskPath(taskId: TaskId): string | null {
    return this.store.getState().tasks.get(taskId)?.path ?? null;
  }

  private requireTask(id: TaskId): Task {
    const t = this.store.getState().tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    return t;
  }
}

/**
 * Jira 상태 → 보드 컬럼.
 *
 * 표시명은 Jira UI 언어를 따라간다 — 한국어 계정은 "완료"라 영어 정규식에 걸리지
 * 않고 전부 todo로 떨어졌다(2026-08-18 실사고: 완료 티켓이 로컬에서 IN REVIEW로
 * 남거나 todo로 되돌아갔다). 그래서 완료 판정은 언어와 무관한
 * statusCategory.key를 먼저 본다. 표시명은 category가 구분하지 못하는
 * in-review / hold를 가려낼 때만 쓴다.
 */
export function jiraStatusToTaskStatus(
  statusName: string,
  statusCategoryKey = "",
): TaskStatus {
  if (statusCategoryKey.trim().toLowerCase() === "done") return "done";

  const normalized = statusName.trim().toLocaleLowerCase();
  if (/(done|closed|resolved|complete|완료|종료|해결)/u.test(normalized)) return "done";
  if (/(review|qa|test|리뷰|검토|테스트|검수)/u.test(normalized)) return "in-review";
  if (/(hold|block|보류|차단)/u.test(normalized)) return "hold";
  if (/(progress|develop|implement|working|진행|개발|작업)/u.test(normalized)) return "doing";

  // 표시명으로 못 가리면 category로 떨어뜨린다. 여기도 비면 todo.
  switch (statusCategoryKey.trim().toLowerCase()) {
    case "indeterminate": return "doing";
    case "new": return "todo";
    default: return "todo";
  }
}

function summarizeBody(body: string): string {
  return body
    .replace(/^#\s+.+$/mu, "")
    .trim()
    .split(/\n\s*\n/u)[0]
    ?.replace(/\s+/gu, " ")
    .slice(0, 180) ?? "";
}

function hasOwn<T extends object, K extends PropertyKey>(
  obj: T,
  key: K,
): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().replace(/^#/u, "")).filter(Boolean))];
}

function normalizeSteps(steps: readonly string[]): string[] {
  return steps.map((step) => step.trim()).filter(Boolean);
}

function normalizeCurrentStep(
  value: number | null | undefined,
  steps: readonly string[],
  defaultToFirst: boolean,
): number | null {
  if (steps.length === 0) return null;
  if (value == null || !Number.isInteger(value)) return defaultToFirst ? 1 : null;
  return Math.min(Math.max(value, 1), steps.length);
}

function normalizeStepSeconds(
  values: readonly number[] | null | undefined,
  stepCount: number,
): number[] {
  return Array.from({ length: stepCount }, (_, index) => {
    const seconds = values?.[index];
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
      ? Math.round(seconds)
      : 0;
  });
}
