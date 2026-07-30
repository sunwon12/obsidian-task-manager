// LLD §9.2: column droppable + sortable context.

import * as React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { KanbanCard } from "./KanbanCard";
import { NewTaskModal } from "./NewTaskModal";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import { getStatusColor } from "./statusColors";
import { statusLabel } from "./statusLabels";
import type { BoardColumn, Priority, ProjectId, TaskStatus } from "../../core/types";
import type { ProjectFilter } from "../../store/taskMasterStore";

interface Props {
  column: BoardColumn;
}

export const KanbanColumn: React.FC<Props> = ({ column }) => {
  const droppable = useDroppable({ id: column.id });
  const label = statusLabel(column.id);
  const color = getStatusColor(column.id);
  const [quickAddOpen, setQuickAddOpen] = React.useState(false);

  return (
    <li
      className="tm-flex tm-flex-col tm-w-72 tm-shrink-0 tm-border-t-2 tm-pt-2"
      style={{ borderTopColor: color.border }}
    >
      <div className="tm-mb-2 tm-flex tm-items-center tm-justify-between tm-gap-2">
        <h3
          className="tm-flex tm-min-w-0 tm-items-center tm-gap-2 tm-text-sm tm-font-semibold tm-text-tm-muted tm-uppercase tm-tracking-wide"
          id={`tm-col-title-${column.id}`}
        >
          <span
            aria-hidden="true"
            className="tm-h-2 tm-w-2 tm-shrink-0 tm-rounded-full"
            style={{ backgroundColor: color.solid }}
          />
          <span className="tm-min-w-0 tm-truncate">{label}</span>
          <span className="tm-ml-2 tm-text-tm-faint tm-font-normal">
            {column.taskIds.length}
          </span>
        </h3>
        <ColumnQuickAddButton label={label} onOpen={() => setQuickAddOpen(true)} />
      </div>
      <ColumnQuickAddInline
        open={quickAddOpen}
        status={column.id}
        label={label}
        onClose={() => setQuickAddOpen(false)}
      />
      <ul
        ref={droppable.setNodeRef}
        role="list"
        aria-labelledby={`tm-col-title-${column.id}`}
        className={
          "tm-flex-1 tm-min-h-32 tm-rounded-md tm-p-2 " +
          (droppable.isOver
            ? "tm-bg-tm-bg-hover tm-border-2 tm-border-tm-accent"
            : "tm-bg-tm-bg-alt tm-border-2 tm-border-transparent")
        }
        data-column-id={column.id}
      >
        <SortableContext items={column.taskIds} strategy={verticalListSortingStrategy}>
          {column.taskIds.map((id) => (
            <KanbanCard key={id} taskId={id} />
          ))}
        </SortableContext>
        {column.taskIds.length === 0 && (
          <li className="tm-text-tm-faint tm-text-sm tm-text-center tm-py-4">
            {t("kanban.column.empty")}
          </li>
        )}
      </ul>
    </li>
  );
};

const ColumnQuickAddButton: React.FC<{ label: string; onOpen: () => void }> = ({ label, onOpen }) => (
  <button
    type="button"
    aria-label={t("kanban.column.quickAdd").replace("{status}", label)}
    onClick={onOpen}
    className="tm-rounded tm-px-2 tm-py-1 tm-text-sm tm-text-tm-accent hover:tm-bg-tm-bg-hover"
  >
    +
  </button>
);

const ColumnQuickAddInline: React.FC<{
  open: boolean;
  status: TaskStatus;
  label: string;
  onClose: () => void;
}> = ({ open, status, label, onClose }) => {
  const services = useServices();
  const projectFilter = useStore((s) => s.selectedProjectId);
  const [title, setTitle] = React.useState("");
  const [showDetails, setShowDetails] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const inputId = React.useId();
  const defaultProject = isProjectId(projectFilter) ? projectFilter : null;

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function create(inputTitle: string): Promise<void> {
    const trimmed = inputTitle.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await services.taskService.createTask({
        title: trimmed,
        status,
        project: defaultProject,
      });
      setTitle("");
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateDetailed(input: {
    title: string;
    status: TaskStatus;
    priority: Priority | null;
    jiraKey: string | null;
    remarks: string | null;
  }): Promise<void> {
    await services.taskService.createTask({
      ...input,
      project: defaultProject,
    });
    setTitle("");
    setShowDetails(false);
    onClose();
  }

  if (!open) return null;

  return (
    <>
      <form
        className="tm-mb-2 tm-rounded tm-border tm-border-tm-border tm-bg-tm-bg tm-p-2"
        aria-label={t("kanban.column.quickAdd").replace("{status}", label)}
        onSubmit={(e) => {
          e.preventDefault();
          void create(title).catch((err: unknown) => {
            console.error("TaskMaster column quick add failed", err);
          });
        }}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setTitle("");
              onClose();
            }
          }}
          placeholder={t("kanban.column.quickAddPlaceholder")}
          className="tm-w-full tm-rounded tm-border tm-border-tm-border tm-bg-tm-bg-alt tm-px-2 tm-py-1.5 tm-text-sm tm-text-tm-text"
        />
        <div className="tm-mt-2 tm-flex tm-justify-end tm-gap-1">
          <button
            type="button"
            onClick={() => {
              setTitle("");
              onClose();
            }}
            disabled={submitting}
            className="tm-rounded tm-px-2 tm-py-1 tm-text-xs tm-text-tm-muted disabled:tm-opacity-50"
          >
            {t("kanban.column.quickAddCancel")}
          </button>
          <button
            type="button"
            onClick={() => setShowDetails(true)}
            className="tm-rounded tm-px-2 tm-py-1 tm-text-xs tm-text-tm-muted hover:tm-bg-tm-bg-hover"
          >
            {t("kanban.column.quickAddDetails")}
          </button>
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            className="tm-rounded tm-bg-tm-accent tm-px-2 tm-py-1 tm-text-xs tm-text-white disabled:tm-opacity-50"
          >
            {t("kanban.column.quickAddSubmit")}
          </button>
        </div>
      </form>
      {showDetails && (
        <NewTaskModal
          initialStatus={status}
          initialTitle={title}
          onClose={() => setShowDetails(false)}
          onCreate={(input) =>
            handleCreateDetailed(input).catch((err: unknown) => {
              console.error("TaskMaster column detailed quick add failed", err);
            })
          }
        />
      )}
    </>
  );
};

function isProjectId(v: ProjectFilter): v is ProjectId {
  return v !== "all" && v !== "none";
}
