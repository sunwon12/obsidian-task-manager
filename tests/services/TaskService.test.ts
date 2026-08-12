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

  it("creates, displays, and persists normalized tags", async () => {
    const { tasks, store, app } = build();
    const task = await tasks.createTask({ title: "x", tags: ["업무", " #학습 ", "업무", ""] });
    expect(store.getState().tasks.get(task.id)?.tags).toEqual(["업무", "학습"]);
    const raw = await app.vault.read(app.vault.getAbstractFileByPath(task.path) as never);
    expect(raw).toContain("tags:\n  - 업무\n  - 학습");
  });

  it("creates and updates work-plan progress as machine-readable frontmatter", async () => {
    const { tasks, store, app } = build();
    const task = await tasks.createTask({
      title: "계획 있는 작업",
      steps: [" 서버 프롬프트 ", "", "QA 환경 검증"],
    });
    expect(task.steps).toEqual(["서버 프롬프트", "QA 환경 검증"]);
    expect(task.currentStep).toBe(1);

    const updated = await tasks.updateTask(task.id, { currentStep: 2 });
    expect(updated.currentStep).toBe(2);
    expect(store.getState().tasks.get(task.id)?.currentStep).toBe(2);
    const raw = await app.vault.read(app.vault.getAbstractFileByPath(task.path) as never);
    expect(raw).toContain("step1: 서버 프롬프트");
    expect(raw).toContain("step2: QA 환경 검증");
    expect(raw).not.toContain("steps:");
    expect(raw).toContain("currentStep: 2");
  });

  it("단계별 측정 초를 stepNSeconds 숫자 속성으로 저장한다", async () => {
    const { tasks, app } = build();
    const task = await tasks.createTask({
      title: "단계 시간",
      steps: ["조사", "구현", "검증"],
      stepSeconds: [5, 61, 0],
    });
    expect(task.stepSeconds).toEqual([5, 61, 0]);
    const raw = await app.vault.read(app.vault.getAbstractFileByPath(task.path) as never);
    expect(raw).toContain("step1Seconds: 5");
    expect(raw).toContain("step2Seconds: 61");
    expect(raw).not.toContain("step3Seconds");
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
    const issue = {
      key: "PROJ-42", summary: "Initial summary", statusName: "In Progress",
      description: "", estimateMd: null, actualMd: null, dueDate: null,
    };
    await expect(tasks.upsertJiraIssue(issue)).resolves.toBe("created");
    const created = [...store.getState().tasks.values()][0];
    expect(created?.jiraKey).toBe("PROJ-42");
    expect(created?.status).toBe("doing");

    await expect(tasks.upsertJiraIssue({ ...issue, summary: "Updated summary", statusName: "Done" }))
      .resolves.toBe("updated");
    expect(store.getState().tasks.get(created!.id)?.title).toBe("Updated summary");
    expect(store.getState().tasks.get(created!.id)?.status).toBe("done");
  });

  it("upsertJiraIssue carries description/estimateMd/actualMd/due into the task file", async () => {
    // 목적(2026-08-08 사용자 요구): 예상 MD vs 실제 MD 가 로컬 파일에 쌓여야
    // "이전엔 얼마 걸렸는데 지금은 얼마"라는 견적 회고 자산이 된다.
    const { tasks, store, app } = build();
    await tasks.upsertJiraIssue({
      key: "BDCC-1", summary: "견적 자산", statusName: "In Progress",
      description: "## 배경\n\n갤러리 편성 재구성", estimateMd: 3, actualMd: null, dueDate: "2026-08-09",
    });
    const created = [...store.getState().tasks.values()].find((t) => t.jiraKey === "BDCC-1")!;
    expect(created.estimateMd).toBe(3);
    expect(created.actualMd).toBeNull();
    expect(created.due).toBe("2026-08-09");
    const raw = await app.vault.read(app.vault.getAbstractFileByPath(created.path) as never);
    expect(raw).toContain("estimateMd: 3");
    expect(raw).toContain("due: 2026-08-09");
    expect(raw).toContain("갤러리 편성 재구성");
  });

  it("upsertJiraIssue는 Jira actualMd가 비어 있어도 로컬 기록(타이머)을 지우지 않는다", async () => {
    const { tasks, store } = build();
    const issue = {
      key: "BDCC-2", summary: "보호", statusName: "In Progress",
      description: "", estimateMd: null, actualMd: null, dueDate: null,
    };
    await tasks.upsertJiraIssue(issue);
    const created = [...store.getState().tasks.values()].find((t) => t.jiraKey === "BDCC-2")!;
    // 타이머 스탑이 기록한 것처럼 로컬에서 actualMd를 채운다 (T-901)
    await tasks.updateTask(created.id, { actualMd: 0.5 });

    await expect(tasks.upsertJiraIssue(issue)).resolves.toBe("updated");
    expect(store.getState().tasks.get(created.id)?.actualMd).toBe(0.5);
  });

  it("upsertJiraIssue는 Jira에 actualMd 값이 있으면 여전히 Jira 값으로 갱신한다", async () => {
    const { tasks, store } = build();
    const issue = {
      key: "BDCC-3", summary: "Jira 우선", statusName: "In Progress",
      description: "", estimateMd: null, actualMd: null, dueDate: null,
    };
    await tasks.upsertJiraIssue(issue);
    const created = [...store.getState().tasks.values()].find((t) => t.jiraKey === "BDCC-3")!;
    await tasks.updateTask(created.id, { actualMd: 0.5 });

    await tasks.upsertJiraIssue({ ...issue, actualMd: 2 });
    expect(store.getState().tasks.get(created.id)?.actualMd).toBe(2);
  });

  it("upsertJiraIssue backfills an empty body but never overwrites user notes", async () => {
    const { tasks, store, app } = build();
    const issue = {
      key: "BDCC-2", summary: "본문 백필", statusName: "To Do",
      description: "", estimateMd: null, actualMd: null, dueDate: null,
    };
    await tasks.upsertJiraIssue(issue); // description 없이 생성 → 본문 비어 있음

    // 다음 동기화에서 description 이 생기면 빈 본문을 채운다
    await tasks.upsertJiraIssue({ ...issue, description: "지라에서 온 본문" });
    const task = [...store.getState().tasks.values()].find((t) => t.jiraKey === "BDCC-2")!;
    const raw1 = await app.vault.read(app.vault.getAbstractFileByPath(task.path) as never);
    expect(raw1).toContain("지라에서 온 본문");

    // 사용자가 본문을 쓴 뒤에는 어떤 동기화도 본문을 덮지 않는다
    const file = app.vault.getAbstractFileByPath(task.path) as never;
    const withUserNote = raw1.replace("지라에서 온 본문", "내가 직접 쓴 메모");
    await app.vault.modify(file, withUserNote);
    await tasks.upsertJiraIssue({ ...issue, description: "지라가 다시 보낸 본문" });
    const raw2 = await app.vault.read(file);
    expect(raw2).toContain("내가 직접 쓴 메모");
    expect(raw2).not.toContain("지라가 다시 보낸 본문");
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
