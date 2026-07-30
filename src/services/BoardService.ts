// LLD §6.3: BoardService.
// 시각 데이터 변경. 즉시 store 갱신, 디스크는 BoardRepository.queueWrite로 debounced.

import type { BoardRepository } from "../repositories/BoardRepository";
import type { EventBus } from "../core/eventBus";
import type { TaskMasterStore } from "../store/taskMasterStore";
import { nowIso } from "../core/time";
import type { BoardState, ColumnId, TaskId } from "../core/types";

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
      return setColumn(b, columnId, [...col.taskIds, taskId]);
    });
  }

  move(taskId: TaskId, from: ColumnId, to: ColumnId): void {
    if (from === to) return;
    this.update((b) => ({
      ...b,
      columns: b.columns.map((c) => {
        if (c.id === from) return { ...c, taskIds: c.taskIds.filter((id) => id !== taskId) };
        if (c.id === to) return { ...c, taskIds: c.taskIds.includes(taskId) ? c.taskIds : [...c.taskIds, taskId] };
        return c;
      }),
      updatedAt: nowIso(),
    }));
  }

  reorderInColumn(columnId: ColumnId, nextOrder: TaskId[]): void {
    this.update((b) => setColumn(b, columnId, nextOrder));
  }

  /**
   * Reorder only the visible subset of a column while preserving hidden task IDs.
   * Used when project/search filters narrow the UI, so filtered drag operations
   * cannot accidentally drop tasks that are currently out of view.
   */
  reorderVisibleInColumn(columnId: ColumnId, nextVisibleOrder: TaskId[]): void {
    this.update((b) => {
      const col = b.columns.find((c) => c.id === columnId);
      if (!col) return b;
      const merged = mergeVisibleOrder(col.taskIds, nextVisibleOrder);
      return arraysEqual(merged, col.taskIds) ? b : setColumn(b, columnId, merged);
    });
  }

  remove(taskId: TaskId): void {
    this.update((b) => ({
      ...b,
      columns: b.columns.map((c) => ({
        ...c,
        taskIds: c.taskIds.filter((id) => id !== taskId),
      })),
      updatedAt: nowIso(),
    }));
  }

  /** Board 통째로 교체. IndexService가 reconcile 결과를 적용할 때 사용. */
  replace(board: BoardState): void {
    this.store.getState().setBoard(board);
    this.board.queueWrite(board);
    this.events.emit({ type: "board:updated", board });
  }

  private update(fn: (b: BoardState) => BoardState): void {
    const prev = this.store.getState().board;
    const next = fn(prev);
    if (next === prev) return;
    this.replace(next);
  }
}

function setColumn(b: BoardState, id: ColumnId, taskIds: TaskId[]): BoardState {
  return {
    ...b,
    columns: b.columns.map((c) => (c.id === id ? { ...c, taskIds } : c)),
    updatedAt: nowIso() as BoardState["updatedAt"],
  };
}

function mergeVisibleOrder(fullOrder: TaskId[], nextVisibleOrder: TaskId[]): TaskId[] {
  if (nextVisibleOrder.length === 0) return fullOrder;
  const visibleSet = new Set(nextVisibleOrder);
  if (visibleSet.size !== nextVisibleOrder.length) return fullOrder;

  const currentVisible = fullOrder.filter((id) => visibleSet.has(id));
  if (currentVisible.length !== nextVisibleOrder.length) return fullOrder;

  let visibleIndex = 0;
  return fullOrder.map((id) => {
    if (!visibleSet.has(id)) return id;
    const next = nextVisibleOrder[visibleIndex];
    visibleIndex += 1;
    return next ?? id;
  });
}

function arraysEqual(a: readonly TaskId[], b: readonly TaskId[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, idx) => id === b[idx]);
}

export const __test_mergeVisibleOrder = mergeVisibleOrder;
