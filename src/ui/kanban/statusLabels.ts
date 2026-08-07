import { t, type StringKey } from "../../i18n";
import type { ColumnId, TaskStatus } from "../../core/types";

export const COLUMN_LABEL_KEY: Record<ColumnId, StringKey> = {
  backlog: "kanban.column.backlog",
  hold: "kanban.column.hold",
  todo: "kanban.column.todo",
  doing: "kanban.column.doing",
  "in-review": "kanban.column.inReview",
  done: "kanban.column.done",
};

export function statusLabel(status: TaskStatus): string {
  return t(COLUMN_LABEL_KEY[status]);
}
