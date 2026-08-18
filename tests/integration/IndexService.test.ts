import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, Plugin } from "obsidian";
import { IndexService } from "../../src/integration/IndexService";
import { TaskRepository } from "../../src/repositories/TaskRepository";
import { BoardRepository } from "../../src/repositories/BoardRepository";
import { MeetingRepository } from "../../src/repositories/MeetingRepository";
import { ProjectRepository } from "../../src/repositories/ProjectRepository";
import { BoardService } from "../../src/services/BoardService";
import { TaskService } from "../../src/services/TaskService";
import { TaskTimerService } from "../../src/services/TaskTimerService";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { EventBus } from "../../src/core/eventBus";
import { createTaskMasterStore } from "../../src/store/taskMasterStore";
import type { BoardState, ColumnId, TaskId } from "../../src/core/types";

const ROOT = "TaskMaster";
const TASKS = "TaskMaster/Tasks";
const ARCHIVE = "TaskMaster/Archive";
const MEETINGS = "TaskMaster/Meetings";
const PROJECTS = "TaskMaster/Projects";
const BOARD = "TaskMaster/.board.json";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function build() {
  const app = new App();
  // obsidian @types의 Plugin은 abstract. mock의 Plugin은 concrete이므로 as never로 우회.
  const plugin = new (Plugin as never as new (a: App, m: unknown) => Plugin)(app, {});
  const diag = new DiagnosticsLog();
  const events = new EventBus();
  const store = createTaskMasterStore();
  const taskRepo = new TaskRepository(app, diag, 500, TASKS, ARCHIVE);
  const boardRepo = new BoardRepository(app, diag, BOARD, 500);
  const meetingRepo = new MeetingRepository(app, diag, MEETINGS);
  const projectRepo = new ProjectRepository(app, diag, PROJECTS);
  const board = new BoardService(boardRepo, store, events);
  const tasks = new TaskService(taskRepo, board, store, events);
  const idx = new IndexService(
    app, plugin, store,
    taskRepo, boardRepo, board,
    meetingRepo, projectRepo,
    events,
    diag, ROOT,
  );
  return { app, plugin, idx, tasks, board, store, diag, events };
}

function taskIds(board: BoardState, id: ColumnId): TaskId[] {
  return board.columns.find((c) => c.id === id)?.taskIds ?? [];
}

describe("IndexService.bootstrap", () => {
  it("creates required folders if missing", async () => {
    const { app, idx } = build();
    await idx.bootstrap();
    for (const path of [ROOT, TASKS, MEETINGS, PROJECTS, ARCHIVE]) {
      expect(app.vault.getAbstractFileByPath(path)).not.toBeNull();
    }
  });

  it("survives boot index race: createFolder throws 'Folder already exists' (2026-08-08)", async () => {
    // 부팅 직후엔 vault 인덱스가 디스크에 실존하는 폴더를 아직 몰라
    // getAbstractFileByPath=null → createFolder → "Folder already exists" throw.
    // 이 예외가 bootstrap 을 죽이면 보드 전체가 빈다(실사고).
    const { app, idx } = build();
    vi.spyOn(app.vault, "createFolder").mockRejectedValue(
      new Error("Folder already exists."),
    );
    await expect(idx.bootstrap()).resolves.not.toThrow();
  });

  it("indexes existing tasks into store after createTask + cache registration", async () => {
    const { app, tasks, store, idx } = build();
    await idx.bootstrap();
    const t = await tasks.createTask({ title: "first", status: "doing" });

    // mock 환경에서는 metadataCache가 자동 채워지지 않으므로 명시 주입.
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      t.path,
      {
        type: "task", id: t.id, status: "doing", schemaVersion: 1,
        project: null, priority: null,
        createdAt: t.createdAt, updatedAt: t.updatedAt,
      },
    );

    // store를 reset하고 다시 bootstrap → 디스크에서 다시 인덱싱
    store.getState().reset();
    await idx.bootstrap();
    expect(store.getState().tasks.get(t.id)).toBeDefined();
    expect(taskIds(store.getState().board, "doing")).toContain(t.id);
  });
});

describe("IndexService event handlers", () => {
  it("handleMetaChanged updates store on external modify", async () => {
    const { app, tasks, idx, store } = build();
    await idx.bootstrap();
    const t = await tasks.createTask({ title: "x", status: "todo" });

    // 외부에서 frontmatter status를 변경한 척
    const file = app.vault.getAbstractFileByPath(t.path);
    const raw = await app.vault.read(file as never);
    const newRaw = raw.replace("status: todo", "status: doing");
    await app.vault.modify(file as never, newRaw);
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      t.path,
      {
        type: "task", id: t.id, status: "doing", schemaVersion: 1,
        project: null, priority: null,
        createdAt: t.createdAt, updatedAt: t.updatedAt,
      },
    );

    await idx.handleMetaChangedForTest(file as never);

    expect(store.getState().tasks.get(t.id)?.status).toBe("doing");
    expect(taskIds(store.getState().board, "doing")).toContain(t.id);
    expect(taskIds(store.getState().board, "todo")).not.toContain(t.id);
  });

  it("external step/currentStep edits immediately refresh an active timer snapshot", async () => {
    const { app, tasks, idx, store, events } = build();
    await idx.bootstrap();
    const task = await tasks.createTask({
      title: "외부 수정 반영",
      status: "doing",
      steps: ["하나", "둘", "셋"],
    });
    const timers = new TaskTimerService(events, store, tasks, {
      load: async () => [],
      save: async () => {},
    });
    await timers.init();
    const listener = vi.fn();
    timers.subscribe(listener);

    const file = app.vault.getAbstractFileByPath(task.path);
    const raw = await app.vault.read(file as never);
    const changed = raw
      .replace("step2: 둘", "step2: 두 번째 단계 수정")
      .replace("currentStep: 1", "currentStep: 2");
    await app.vault.modify(file as never, changed);
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      task.path,
      { type: "task" },
    );

    await idx.handleMetaChangedForTest(file as never);

    expect(timers.getTimer(task.id)).toMatchObject({
      steps: ["하나", "두 번째 단계 수정", "셋"],
      currentStep: 2,
    });
    expect(listener).toHaveBeenCalled();
    timers.dispose();
  });

  it("handleDelete removes task from store and board", async () => {
    const { app, tasks, idx, store } = build();
    await idx.bootstrap();
    const t = await tasks.createTask({ title: "x", status: "doing" });
    const file = app.vault.getAbstractFileByPath(t.path);
    idx.handleDeleteForTest(file as never);
    expect(store.getState().tasks.has(t.id)).toBe(false);
    expect(taskIds(store.getState().board, "doing")).not.toContain(t.id);
  });

  it("handleRename updates path in store", async () => {
    const { app, tasks, idx, store } = build();
    await idx.bootstrap();
    const t = await tasks.createTask({ title: "x" });
    const oldPath = t.path;
    const newPath = `${TASKS}/renamed.md`;
    const file = app.vault.getAbstractFileByPath(oldPath);
    // 실제 vault rename 후 handleRename 호출
    await app.vault.rename(file as never, newPath);
    idx.handleRenameForTest(file as never, oldPath);
    expect(store.getState().tasks.get(t.id)?.path).toBe(newPath);
  });

  it("handleCreate indexes a task file written directly to disk without a reload", async () => {
    const { app, idx, store } = build();
    await idx.bootstrap();

    // 플러그인 API를 거치지 않고 디스크에 직접 파일을 쓴 상황을 흉내낸다
    // (예: 외부 스크립트나 git으로 생성된 task 파일). metadataCache는 아직
    // frontmatter를 파싱하지 않은 상태이므로 "create" 이벤트만 발생한다.
    const raw = [
      "---",
      "schemaVersion: 1",
      "id: task_01HX7SM2J6K4XQ7EV6C8T92PPW",
      "type: task",
      "status: todo",
      "project:",
      "priority:",
      "createdAt: 2026-08-08T00:00:00.000Z",
      "updatedAt: 2026-08-08T00:00:00.000Z",
      "---",
      "",
      "# 외부에서 만든 task",
      "",
    ].join("\n");
    const file = await app.vault.create(`${TASKS}/external.md`, raw);

    await idx.handleCreateForTest(file as never);

    expect(store.getState().tasks.get("task_01HX7SM2J6K4XQ7EV6C8T92PPW" as TaskId)?.title)
      .toBe("외부에서 만든 task");
    expect(taskIds(store.getState().board, "todo")).toContain("task_01HX7SM2J6K4XQ7EV6C8T92PPW");
  });

  it("외부에서 나타난 task도 저장 가능해야 한다 — path 인덱스 등록 (2026-08-18 실사고)", async () => {
    // store에만 넣고 repository의 path 인덱스에 등록하지 않으면, 이후 모든 저장이
    // `Unknown task id`로 실패하고 retry queue에 남아 Notice가 무한 반복됐다.
    const { app, idx, tasks, store } = build();
    await idx.bootstrap();
    const id = "task_01HX7SM2J6K4XQ7EV6C8T92PPX" as TaskId;
    const raw = [
      "---",
      "schemaVersion: 1",
      `id: ${id}`,
      "type: task",
      "status: todo",
      "createdAt: 2026-08-18T00:00:00.000Z",
      "updatedAt: 2026-08-18T00:00:00.000Z",
      "---",
      "",
      "# 밖에서 고친 task",
      "",
    ].join("\n");
    const file = await app.vault.create(`${TASKS}/repaired.md`, raw);

    await idx.handleCreateForTest(file as never);

    expect(store.getState().tasks.get(id)).toBeTruthy();
    // 저장이 실제로 성립한다 (예전엔 여기서 Unknown task id로 던졌다)
    await expect(tasks.updateTitle(id, "이름 변경")).resolves.toMatchObject({
      title: "이름 변경",
    });
  });

  it("handleCreate ignores non-markdown or non-managed files", async () => {
    const { app, idx, store } = build();
    await idx.bootstrap();
    const file = await app.vault.create(`${TASKS}/not-a-task.md`, "# 그냥 메모\n\n본문");
    await idx.handleCreateForTest(file as never);
    expect(store.getState().tasks.size).toBe(0);
  });

  it("ignores files outside dataRoot", async () => {
    const { app, idx, store } = build();
    await idx.bootstrap();
    await app.vault.create("OtherFolder/x.md", "content");
    const file = app.vault.getAbstractFileByPath("OtherFolder/x.md");
    idx.handleDeleteForTest(file as never);
    // store는 원래 비어있었음 — error 없이 통과하면 OK
    expect(store.getState().tasks.size).toBe(0);
  });
});
