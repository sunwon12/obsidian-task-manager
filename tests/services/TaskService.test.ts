import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "obsidian";
import { TaskService } from "../../src/services/TaskService";
import { BoardService } from "../../src/services/BoardService";
import { TaskRepository } from "../../src/repositories/TaskRepository";
import { BoardRepository } from "../../src/repositories/BoardRepository";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { EventBus } from "../../src/core/eventBus";
import { createTaskMasterStore } from "../../src/store/taskMasterStore";
import type { BoardState, ColumnId, TaskId } from "../../src/core/types";

const TASKS = "TaskMaster/Tasks";
const ARCHIVE = "TaskMaster/Archive";
const BOARD = "TaskMaster/.board.json";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function build() {
  const app = new App();
  const diag = new DiagnosticsLog();
  const events = new EventBus();
  const store = createTaskMasterStore();
  const taskRepo = new TaskRepository(app, diag, 500, TASKS, ARCHIVE);
  const boardRepo = new BoardRepository(app, diag, BOARD, 500);
  const board = new BoardService(boardRepo, store, events);
  const tasks = new TaskService(taskRepo, board, store, events);
  return { app, store, events, tasks, board, boardRepo, taskRepo };
}

function taskIds(board: BoardState, id: ColumnId): TaskId[] {
  return board.columns.find((c) => c.id === id)?.taskIds ?? [];
}

describe("TaskService", () => {
  it("createTask persists a file, updates store, and appends to board column", async () => {
    const { tasks, store } = build();
    const task = await tasks.createTask({ title: "새 task", status: "doing" });
    expect(task.id).toMatch(/^task_/);
    expect(task.path).toContain(TASKS);
    expect(store.getState().tasks.get(task.id)).toBeDefined();
    expect(taskIds(store.getState().board, "doing")).toContain(task.id);
  });

  it("emits task:created event", async () => {
    const { tasks, events } = build();
    const handler = vi.fn();
    events.subscribe(handler);
    await tasks.createTask({ title: "x" });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: "task:created" }));
  });

  it("moveTask is a no-op when status unchanged", async () => {
    const { tasks, store } = build();
    const task = await tasks.createTask({ title: "x", status: "todo" });
    const before = store.getState().board;
    const after = await tasks.moveTask(task.id, "todo");
    expect(after.status).toBe("todo");
    expect(store.getState().board).toBe(before);
  });

  it("moveTask updates Markdown frontmatter status (saveImmediate)", async () => {
    const { tasks, app } = build();
    const task = await tasks.createTask({ title: "x", status: "todo" });
    await tasks.moveTask(task.id, "doing");
    const file = app.vault.getAbstractFileByPath(task.path);
    const raw = await app.vault.read(file as never);
    expect(raw).toContain("status: doing");
  });

  it("updateTitle syncs Markdown H1 and frontmatter updatedAt", async () => {
    const { tasks, app } = build();
    const task = await tasks.createTask({ title: "old" });
    const before = task.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const updated = await tasks.updateTitle(task.id, "new");
    expect(updated.title).toBe("new");
    expect(updated.updatedAt).not.toBe(before);
    const file = app.vault.getAbstractFileByPath(task.path);
    const raw = await app.vault.read(file as never);
    expect(raw).toContain("# new");
  });

  it("archiveTask moves to archive folder and removes from board", async () => {
    const { tasks, store } = build();
    const task = await tasks.createTask({ title: "x", status: "doing" });
    await tasks.archiveTask(task.id);
    const persisted = store.getState().tasks.get(task.id);
    expect(persisted?.archivedAt).not.toBeNull();
    expect(persisted?.path).toContain(ARCHIVE);
    expect(taskIds(store.getState().board, "doing")).not.toContain(task.id);
  });

  it("restoreTask moves archived task back to active board", async () => {
    const { tasks, store } = build();
    const task = await tasks.createTask({ title: "x", status: "doing" });
    await tasks.archiveTask(task.id);
    const restored = await tasks.restoreTask(task.id);
    expect(restored.archivedAt).toBeNull();
    expect(restored.path).toContain(TASKS);
    expect(taskIds(store.getState().board, "doing")).toContain(task.id);
  });

  it("deleteTask trashes file and removes from store + board", async () => {
    const { tasks, store, app } = build();
    const task = await tasks.createTask({ title: "x" });
    await tasks.deleteTask(task.id);
    expect(store.getState().tasks.has(task.id)).toBe(false);
    expect(app.vault.getAbstractFileByPath(task.path)).toBeNull();
  });

  it("createTask stores jiraKey when provided", async () => {
    const { tasks, store, app } = build();
    const task = await tasks.createTask({ title: "x", jiraKey: "M29CEF-3126" });
    expect(store.getState().tasks.get(task.id)?.jiraKey).toBe("M29CEF-3126");
    const file = app.vault.getAbstractFileByPath(task.path);
    const raw = await app.vault.read(file as never);
    expect(raw).toContain("jiraKey: M29CEF-3126");
  });

  it("setJiraKey updates existing task", async () => {
    const { tasks, store } = build();
    const task = await tasks.createTask({ title: "x" });
    await tasks.setJiraKey(task.id, "PROJ-42");
    expect(store.getState().tasks.get(task.id)?.jiraKey).toBe("PROJ-42");
    await tasks.setJiraKey(task.id, null);
    expect(store.getState().tasks.get(task.id)?.jiraKey).toBeNull();
  });

  it("upsertJiraIssue creates once and then updates the matching Jira card", async () => {
    const { tasks, store } = build();
    const issue = { key: "PROJ-42", summary: "Initial summary", statusName: "In Progress" };
    await expect(tasks.upsertJiraIssue(issue)).resolves.toBe("created");
    const created = [...store.getState().tasks.values()][0];
    expect(created?.jiraKey).toBe("PROJ-42");
    expect(created?.status).toBe("doing");

    await expect(tasks.upsertJiraIssue({ ...issue, summary: "Updated summary", statusName: "Done" }))
      .resolves.toBe("updated");
    expect(store.getState().tasks.get(created!.id)?.title).toBe("Updated summary");
    expect(store.getState().tasks.get(created!.id)?.status).toBe("done");
  });

  it("createTask stores remarks when provided", async () => {
    const { tasks, store, app } = build();
    const task = await tasks.createTask({ title: "x", remarks: "리뷰 대기" });
    expect(store.getState().tasks.get(task.id)?.remarks).toBe("리뷰 대기");
    const file = app.vault.getAbstractFileByPath(task.path);
    const raw = await app.vault.read(file as never);
    expect(raw).toContain("remarks: 리뷰 대기");
  });

  it("updateTask saves metadata in a single update", async () => {
    const { tasks, store, app } = build();
    const task = await tasks.createTask({ title: "x" });
    await tasks.updateTask(task.id, {
      title: "new title",
      priority: "medium",
      jiraKey: "PROJ-42",
      remarks: "확인 필요",
    });
    const updated = store.getState().tasks.get(task.id);
    expect(updated?.title).toBe("new title");
    expect(updated?.priority).toBe("medium");
    expect(updated?.jiraKey).toBe("PROJ-42");
    expect(updated?.remarks).toBe("확인 필요");
    const raw = await app.vault.read(app.vault.getAbstractFileByPath(task.path) as never);
    expect(raw).toContain("# new title");
    expect(raw).toContain("priority: medium");
    expect(raw).toContain("jiraKey: PROJ-42");
    expect(raw).toContain("remarks: 확인 필요");
  });

  it("requireTask throws on unknown id", async () => {
    const { tasks } = build();
    await expect(tasks.moveTask("task_unknown" as never, "doing")).rejects.toThrow();
  });
});
