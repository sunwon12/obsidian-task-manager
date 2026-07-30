// LLD §9.2: DndContext + drag handler.
// Mobile은 ADR-0009에 따라 dnd 미사용 — useIsMobile 분기.

import * as React from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { useFilteredBoard } from "../../store/selectors";
import { useIsMobile } from "../hooks/useIsMobile";
import { KanbanColumn } from "./KanbanColumn";
import { MobileBoard } from "./MobileBoard";
import { StatusVisibilityBar } from "./StatusVisibilityBar";
import { countTasksByStatus, getNextHiddenStatuses, getVisibleColumns } from "./statusVisibility";
import { t } from "../../i18n";
import { TASK_STATUS_ORDER } from "../../core/types";
import type { ColumnId, TaskId } from "../../core/types";

const COLUMN_IDS: ReadonlySet<string> = new Set(TASK_STATUS_ORDER);

export const KanbanBoard: React.FC = () => {
  const services = useServices();
  const board = useFilteredBoard(services.store);
  const settingsRevision = useStore((s) => s.settingsRevision);
  const isMobile = useIsMobile();
  const [hiddenStatuses, setHiddenStatuses] = React.useState<Set<ColumnId>>(
    () => new Set(services.settings.hiddenStatuses),
  );

  React.useEffect(() => {
    setHiddenStatuses(new Set(services.settings.hiddenStatuses));
  }, [services.settings, settingsRevision]);

  const visibleColumns = React.useMemo(
    () => getVisibleColumns(board.columns, hiddenStatuses),
    [board.columns, hiddenStatuses],
  );

  const counts = React.useMemo(() => countTasksByStatus(board.columns), [board.columns]);

  // PointerSensor: 5px move 후 drag 시작 (click과 구분).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeId = active.id as TaskId;
      const overId = over.id as string;

      const sourceColumn = board.columns.find((c) =>
        c.taskIds.includes(activeId),
      );
      if (!sourceColumn) return;

      // overId가 column id면 column 끝으로 이동 (또는 status 변경).
      if (COLUMN_IDS.has(overId)) {
        const targetCol = overId as ColumnId;
        if (targetCol !== sourceColumn.id) {
          void services.taskService.moveTask(activeId, targetCol);
        }
        return;
      }

      // overId가 다른 task id → 같은 column이면 reorder, 다른 column이면 status change.
      const targetColumn = board.columns.find((c) =>
        c.taskIds.includes(overId as TaskId),
      );
      if (!targetColumn) return;

      if (sourceColumn.id === targetColumn.id) {
        const oldIndex = sourceColumn.taskIds.indexOf(activeId);
        const newIndex = sourceColumn.taskIds.indexOf(overId as TaskId);
        if (oldIndex !== newIndex && oldIndex >= 0 && newIndex >= 0) {
          const next = arrayMove(sourceColumn.taskIds, oldIndex, newIndex);
          services.boardService.reorderVisibleInColumn(sourceColumn.id, next);
        }
      } else {
        void services.taskService.moveTask(activeId, targetColumn.id);
      }
    },
    [board, services],
  );

  const toggleStatusVisibility = React.useCallback(
    (status: ColumnId) => {
      const next = getNextHiddenStatuses(hiddenStatuses, status);
      if (!next) return;
      setHiddenStatuses(next);
      void services.saveSettings({
        ...services.settings,
        hiddenStatuses: [...next],
      });
    },
    [hiddenStatuses, services],
  );

  if (isMobile) {
    return <MobileBoard />;
  }

  return (
    <div className="tm-flex tm-h-full tm-min-h-0 tm-flex-col">
      <StatusVisibilityBar
        hiddenStatuses={hiddenStatuses}
        counts={counts}
        onToggleStatus={toggleStatusVisibility}
        className="tm-shrink-0 tm-border-b tm-border-tm-border tm-px-4 tm-py-3"
      />
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <ul
          role="list"
          aria-label={t("kanban.board.label")}
          className="tm-flex tm-min-h-0 tm-flex-1 tm-gap-4 tm-overflow-x-auto tm-p-4"
        >
          {visibleColumns.map((c) => (
            <KanbanColumn key={c.id} column={c} />
          ))}
        </ul>
      </DndContext>
    </div>
  );
};
