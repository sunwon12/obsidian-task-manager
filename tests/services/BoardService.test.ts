import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "obsidian";
import { BoardService } from "../../src/services/BoardService";
import { BoardRepository } from "../../src/repositories/BoardRepository";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { EventBus } from "../../src/core/eventBus";
import { createTaskMasterStore } from "../../src/store/taskMasterStore";
import { newId } from "../../src/core/ids";
import type { BoardState, ColumnId, TaskId } from "../../src/core/types";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function build() {
  const app = new App();
  const diag = new DiagnosticsLog();
  const events = new EventBus();
  const store = createTaskMasterStore();
  const boardRepo = new BoardRepository(app, diag, "TaskMaster/.board.json", 500);
  const board = new BoardService(boardRepo, store, events);
  return { board, store, events };
}

function taskIds(board: BoardState, id: ColumnId): TaskId[] {
  return board.columns.find((c) => c.id === id)?.taskIds ?? [];
}

describe("BoardService", () => {
  it("appendToColumn adds id when missing, no-op when present", () => {
    const { board, store } = build();
    const id = newId("task") as TaskId;
    board.appendToColumn("todo", id);
    expect(taskIds(store.getState().board, "todo")).toEqual([id]);
    const before = store.getState().board;
    board.appendToColumn("todo", id);
    expect(store.getState().board).toBe(before); // referential no-op
  });

  it("move transfers task from source to destination", () => {
    const { board, store } = build();
    const id = newId("task") as TaskId;
    board.appendToColumn("todo", id);
    board.move(id, "todo", "doing");
    expect(taskIds(store.getState().board, "todo")).not.toContain(id);
    expect(taskIds(store.getState().board, "doing")).toContain(id);
  });

  it("move is no-op when from === to", () => {
    const { board, store } = build();
    const id = newId("task") as TaskId;
    board.appendToColumn("todo", id);
    const before = store.getState().board;
    board.move(id, "todo", "todo");
    expect(store.getState().board).toBe(before);
  });

  it("reorderInColumn replaces taskIds for that column only", () => {
    const { board, store } = build();
    const a = newId("task") as TaskId;
    const b = newId("task") as TaskId;
    board.appendToColumn("doing", a);
    board.appendToColumn("doing", b);
    board.reorderInColumn("doing", [b, a]);
    expect(taskIds(store.getState().board, "doing")).toEqual([b, a]);
    expect(taskIds(store.getState().board, "todo")).toEqual([]);
  });

  it("reorderVisibleInColumn preserves hidden ids while reordering visible ids", () => {
    const { board, store } = build();
    const a = newId("task") as TaskId;
    const b = newId("task") as TaskId;
    const c = newId("task") as TaskId;
    const d = newId("task") as TaskId;
    const e = newId("task") as TaskId;
    board.reorderInColumn("todo", [a, b, c, d, e]);
    board.reorderVisibleInColumn("todo", [d, b]);
    expect(taskIds(store.getState().board, "todo")).toEqual([a, d, c, b, e]);
  });

  it("reorderVisibleInColumn ignores ids that are not in the current column", () => {
    const { board, store } = build();
    const a = newId("task") as TaskId;
    const b = newId("task") as TaskId;
    const outside = newId("task") as TaskId;
    board.reorderInColumn("todo", [a, b]);
    const before = store.getState().board;
    board.reorderVisibleInColumn("todo", [b, outside]);
    expect(store.getState().board).toBe(before);
  });

  it("remove drops the task from any column it belongs to", () => {
    const { board, store } = build();
    const id = newId("task") as TaskId;
    board.appendToColumn("doing", id);
    board.remove(id);
    expect(store.getState().board.columns.flatMap((c) => c.taskIds)).not.toContain(id);
  });

  it("emits board:updated for non-noop changes", () => {
    const { board, events } = build();
    const handler = vi.fn();
    events.subscribe(handler);
    board.appendToColumn("todo", newId("task") as TaskId);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: "board:updated" }));
  });
});
