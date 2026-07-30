import { TASK_STATUS_ORDER } from "../../core/types";
import type { BoardColumn, ColumnId } from "../../core/types";

export function getVisibleColumns(
  columns: readonly BoardColumn[],
  hiddenStatuses: ReadonlySet<ColumnId>,
): BoardColumn[] {
  return columns.filter((column) => !hiddenStatuses.has(column.id));
}

export function countTasksByStatus(
  columns: readonly BoardColumn[],
): Partial<Record<ColumnId, number>> {
  const counts: Partial<Record<ColumnId, number>> = {};
  for (const column of columns) counts[column.id] = column.taskIds.length;
  return counts;
}

export function getNextHiddenStatuses(
  hiddenStatuses: ReadonlySet<ColumnId>,
  status: ColumnId,
): Set<ColumnId> | null {
  const next = new Set(hiddenStatuses);
  if (next.has(status)) {
    next.delete(status);
    return next;
  }
  if (TASK_STATUS_ORDER.length - next.size <= 1) return null;
  next.add(status);
  return next;
}

export function getVisibleStatusFallback(
  activeStatus: ColumnId,
  visibleColumns: readonly BoardColumn[],
): ColumnId {
  if (visibleColumns.some((column) => column.id === activeStatus)) return activeStatus;
  const activeIndex = TASK_STATUS_ORDER.indexOf(activeStatus);
  const nextColumn = visibleColumns.find(
    (column) => TASK_STATUS_ORDER.indexOf(column.id) > activeIndex,
  );
  return nextColumn?.id ?? visibleColumns[0]?.id ?? "todo";
}
