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
    const tags = normalizeTags(input.tags ?? []);
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
      tags,
      bodySummary: summarizeBody(input.body ?? ""),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archivedAt: null,
      passthrough: {},
      fieldOrder: [
        "schemaVersion", "id", "type", "status", "project",
        "priority", ...(jiraKey ? ["jiraKey"] : []), ...(remarks ? ["remarks"] : []), ...(tags.length ? ["tags"] : []),
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

    if (hasOwn(input, "tags")) {
      const tags = normalizeTags(input.tags ?? []);
      if (tags.join("\u0000") !== (next.tags ?? []).join("\u0000")) next = { ...next, tags };
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
  async upsertJiraIssue(issue: JiraIssue): Promise<"created" | "updated" | "skipped"> {
    const existing = [...this.store.getState().tasks.values()]
      .find((task) => task.jiraKey === issue.key);
    if (!existing) {
      await this.createTask({ title: issue.summary, status: jiraStatusToTaskStatus(issue.statusName), jiraKey: issue.key });
      return "created";
    }
    if (existing.archivedAt) return "skipped";
    await this.updateTask(existing.id, { title: issue.summary, status: jiraStatusToTaskStatus(issue.statusName) });
    return "updated";
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

export function jiraStatusToTaskStatus(statusName: string): TaskStatus {
  const normalized = statusName.trim().toLocaleLowerCase();
  if (/(done|closed|resolved|complete)/u.test(normalized)) return "done";
  if (/(review|qa|test)/u.test(normalized)) return "in-review";
  if (/(progress|develop|implement|working)/u.test(normalized)) return "doing";
  if (/(hold|block)/u.test(normalized)) return "hold";
  return "todo";
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
