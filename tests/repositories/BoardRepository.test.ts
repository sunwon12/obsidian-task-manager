import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { BoardRepository } from "../../src/repositories/BoardRepository";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { newId } from "../../src/core/ids";
import { SCHEMA_VERSION, type Task, type TaskId, type IsoDateTime, type BoardState } from "../../src/core/types";

const BOARD_PATH = "TaskMaster/.board.json";
const DEBOUNCE = 500;

function makeRepo(app: App): { repo: BoardRepository; diag: DiagnosticsLog } {
  const diag = new DiagnosticsLog();
  const repo = new BoardRepository(app, diag, BOARD_PATH, DEBOUNCE);
  return { repo, diag };
}

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id as TaskId,
    type: "task",
    status: "todo",
    title: "샘플",
    project: null,
    priority: null,
    jiraKey: null,
    remarks: null,
    createdAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
    updatedAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
    archivedAt: null,
    passthrough: {},
    fieldOrder: [],
    knownMtime: 0,
    path: `TaskMaster/Tasks/x - ${id.slice(0, 13)}.md`,
    ...overrides,
  };
}

function taskIds(board: BoardState, id: BoardState["columns"][number]["id"]): TaskId[] {
  return board.columns.find((c) => c.id === id)?.taskIds ?? [];
}

// ---------- T-207 rebuild + reconcile ----------

describe("BoardRepository.rebuildFromTasks", () => {
  it("groups tasks by status", () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const tasks: Task[] = [
      makeTask(newId("task"), { status: "hold" }),
      makeTask(newId("task"), { status: "todo" }),
      makeTask(newId("task"), { status: "doing" }),
      makeTask(newId("task"), { status: "in-review" }),
      makeTask(newId("task"), { status: "done" }),
    ];
    const board = repo.rebuildFromTasks(tasks);
    expect(board.columns.map((c) => c.id)).toEqual(["hold", "todo", "doing", "in-review", "done"]);
    expect(taskIds(board, "hold")).toHaveLength(1);
    expect(taskIds(board, "todo")).toHaveLength(1);
    expect(taskIds(board, "doing")).toHaveLength(1);
    expect(taskIds(board, "in-review")).toHaveLength(1);
    expect(taskIds(board, "done")).toHaveLength(1);
  });

  it("excludes archived tasks", () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const tasks: Task[] = [
      makeTask(newId("task"), { status: "todo" }),
      makeTask(newId("task"), {
        status: "todo",
        archivedAt: "2026-05-09T00:00:00.000Z" as IsoDateTime,
      }),
    ];
    const board = repo.rebuildFromTasks(tasks);
    expect(taskIds(board, "todo")).toHaveLength(1);
  });

  it("sorts by updatedAt desc, then by path asc", () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id1 = newId("task");
    const id2 = newId("task");
    const id3 = newId("task");
    const tasks: Task[] = [
      makeTask(id1, {
        updatedAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
        path: "TaskMaster/Tasks/b.md",
      }),
      makeTask(id2, {
        updatedAt: "2026-05-08T11:00:00.000Z" as IsoDateTime, // newest
        path: "TaskMaster/Tasks/a.md",
      }),
      makeTask(id3, {
        updatedAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
        path: "TaskMaster/Tasks/a.md",
      }),
    ];
    const board = repo.rebuildFromTasks(tasks);
    expect(taskIds(board, "todo")).toEqual([id2, id3, id1]);
  });
});

describe("BoardRepository.reconcile", () => {
  it("appends new tasks not in loaded board", () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id1 = newId("task") as TaskId;
    const id2 = newId("task") as TaskId;
    const loaded: BoardState = {
      version: 1,
      columns: [
        { id: "todo", title: "Todo", taskIds: [id1] },
        { id: "doing", title: "Doing", taskIds: [] },
        { id: "done", title: "Done", taskIds: [] },
      ],
      updatedAt: "2026-05-08T00:00:00.000Z" as IsoDateTime,
    };
    const tasks = [makeTask(id1, { status: "todo" }), makeTask(id2, { status: "todo" })];
    const out = repo.reconcile(loaded, tasks);
    expect(taskIds(out, "todo")).toEqual([id1, id2]);
  });

  it("removes taskIds for tasks that no longer exist", () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id1 = newId("task") as TaskId;
    const ghost = newId("task") as TaskId;
    const loaded: BoardState = {
      version: 1,
      columns: [
        { id: "todo", title: "Todo", taskIds: [id1, ghost] },
        { id: "doing", title: "Doing", taskIds: [] },
        { id: "done", title: "Done", taskIds: [] },
      ],
      updatedAt: "2026-05-08T00:00:00.000Z" as IsoDateTime,
    };
    const out = repo.reconcile(loaded, [makeTask(id1, { status: "todo" })]);
    expect(taskIds(out, "todo")).toEqual([id1]);
  });

  it("trusts task.status over board column when they disagree", () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task") as TaskId;
    const loaded: BoardState = {
      version: 1,
      columns: [
        { id: "todo", title: "Todo", taskIds: [id] },
        { id: "doing", title: "Doing", taskIds: [] },
        { id: "done", title: "Done", taskIds: [] },
      ],
      updatedAt: "2026-05-08T00:00:00.000Z" as IsoDateTime,
    };
    const out = repo.reconcile(loaded, [makeTask(id, { status: "doing" })]);
    expect(taskIds(out, "todo")).toEqual([]);
    expect(taskIds(out, "doing")).toEqual([id]);
  });

  it("excludes archived tasks", () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task") as TaskId;
    const loaded: BoardState = {
      version: 1,
      columns: [
        { id: "todo", title: "Todo", taskIds: [id] },
        { id: "doing", title: "Doing", taskIds: [] },
        { id: "done", title: "Done", taskIds: [] },
      ],
      updatedAt: "2026-05-08T00:00:00.000Z" as IsoDateTime,
    };
    const out = repo.reconcile(loaded, [
      makeTask(id, {
        status: "todo",
        archivedAt: "2026-05-09T00:00:00.000Z" as IsoDateTime,
      }),
    ]);
    expect(taskIds(out, "todo")).toEqual([]);
  });
});

// ---------- T-208 sync conflict + flush ----------

describe("BoardRepository.resolveSyncConflict", () => {
  it("picks board with larger updatedAt as winner", () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id1 = newId("task") as TaskId;
    const id2 = newId("task") as TaskId;
    const local: BoardState = {
      version: 1,
      columns: [
        { id: "todo", title: "Todo", taskIds: [id1] },
        { id: "doing", title: "Doing", taskIds: [] },
        { id: "done", title: "Done", taskIds: [] },
      ],
      updatedAt: "2026-05-09T00:00:00.000Z" as IsoDateTime,
    };
    const remote: BoardState = {
      version: 1,
      columns: [
        { id: "todo", title: "Todo", taskIds: [id2] },
        { id: "doing", title: "Doing", taskIds: [] },
        { id: "done", title: "Done", taskIds: [] },
      ],
      updatedAt: "2026-05-08T00:00:00.000Z" as IsoDateTime,
    };
    const merged = repo.resolveSyncConflict(local, remote);
    // local이 winner. remote의 id2도 끝에 append되어 손실 없음.
    expect(taskIds(merged, "todo")).toEqual([id1, id2]);
  });

  it("preserves order of winner and avoids duplicates", () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id1 = newId("task") as TaskId;
    const id2 = newId("task") as TaskId;
    const local: BoardState = {
      version: 1,
      columns: [
        { id: "todo", title: "Todo", taskIds: [id1, id2] },
        { id: "doing", title: "Doing", taskIds: [] },
        { id: "done", title: "Done", taskIds: [] },
      ],
      updatedAt: "2026-05-09T00:00:00.000Z" as IsoDateTime,
    };
    const remote: BoardState = {
      ...local,
      columns: [
        { id: "todo", title: "Todo", taskIds: [id2, id1] }, // 다른 순서
        { id: "doing", title: "Doing", taskIds: [] },
        { id: "done", title: "Done", taskIds: [] },
      ],
      updatedAt: "2026-05-08T00:00:00.000Z" as IsoDateTime,
    };
    const merged = repo.resolveSyncConflict(local, remote);
    expect(taskIds(merged, "todo")).toEqual([id1, id2]); // winner 순서 유지
  });
});

describe("BoardRepository.queueWrite + flush", () => {
  it("debounces writes", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = new App();
    const { repo } = makeRepo(app);
    const board: BoardState = {
      version: 1,
      columns: [
        { id: "todo", title: "Todo", taskIds: [] },
        { id: "doing", title: "Doing", taskIds: [] },
        { id: "done", title: "Done", taskIds: [] },
      ],
      updatedAt: "2026-05-09T00:00:00.000Z" as IsoDateTime,
    };
    repo.queueWrite(board);
    // 아직 디스크에 없음
    expect(app.vault.getAbstractFileByPath(BOARD_PATH)).toBeNull();
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 50);
    expect(app.vault.getAbstractFileByPath(BOARD_PATH)).not.toBeNull();
    vi.useRealTimers();
  });

  it("creates file on first persist, modifies on subsequent", async () => {
    vi.useFakeTimers();
    const app = new App();
    const { repo } = makeRepo(app);
    const b1: BoardState = {
      version: 1,
      columns: [
        { id: "todo", title: "Todo", taskIds: [] },
        { id: "doing", title: "Doing", taskIds: [] },
        { id: "done", title: "Done", taskIds: [] },
      ],
      updatedAt: "t1" as IsoDateTime,
    };
    repo.queueWrite(b1);
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 50);

    const b2: BoardState = { ...b1, updatedAt: "t2" as IsoDateTime };
    repo.queueWrite(b2);
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 50);

    const file = app.vault.getAbstractFileByPath(BOARD_PATH);
    const content = await app.vault.read(file as never);
    expect(content).toContain('"updatedAt": "t2"');
    vi.useRealTimers();
  });
});

describe("BoardRepository.loadOrRebuild", () => {
  it("rebuilds from tasks when .board.json is missing", async () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task") as TaskId;
    const result = await repo.loadOrRebuild([makeTask(id)]);
    expect(taskIds(result, "todo")).toEqual([id]);
  });

  it("rebuilds when .board.json is corrupted", async () => {
    const app = new App();
    await app.vault.create(BOARD_PATH, "not valid json{{{");
    const { repo, diag } = makeRepo(app);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = newId("task") as TaskId;
    const result = await repo.loadOrRebuild([makeTask(id)]);
    expect(taskIds(result, "todo")).toEqual([id]);
    expect(diag.list().some((e) => e.kind === "boot")).toBe(true);
  });

  it("reconciles loaded board with current tasks", async () => {
    const app = new App();
    const id1 = newId("task") as TaskId;
    const id2 = newId("task") as TaskId;
    const board: BoardState = {
      version: 1,
      columns: [
        { id: "todo", title: "Todo", taskIds: [id1] },
        { id: "doing", title: "Doing", taskIds: [] },
        { id: "done", title: "Done", taskIds: [] },
      ],
      updatedAt: "t" as IsoDateTime,
    };
    await app.vault.create(BOARD_PATH, JSON.stringify(board, null, 2));
    const { repo } = makeRepo(app);
    const result = await repo.loadOrRebuild([
      makeTask(id1, { status: "todo" }),
      makeTask(id2, { status: "todo" }), // 새 task → append
    ]);
    expect(taskIds(result, "todo")).toEqual([id1, id2]);
  });
});
