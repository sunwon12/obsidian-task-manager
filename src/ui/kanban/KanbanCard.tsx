// LLD §9.3, PRD §7.9 §10.6, ADR-0010: 키보드 단축키 + ARIA + click → openInEditor.

import * as React from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TFile } from "obsidian";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { useFilteredBoard } from "../../store/selectors";
import { PriorityBadge } from "../components/PriorityBadge";
import { TaskTags } from "../components/TaskTags";
import { confirmDialog } from "../components/confirmDialog";
import { t } from "../../i18n";
import { TASK_STATUS_ORDER } from "../../core/types";
import type { Priority, ProjectId, TaskId, TaskStatus } from "../../core/types";
import { useDismissiblePopover } from "../hooks/useDismissiblePopover";
import { EditTaskModal } from "./EditTaskModal";
import { RemarksInlineEditor } from "./RemarksInlineEditor";
import { statusLabel } from "./statusLabels";

interface Props {
  taskId: TaskId;
}

export const KanbanCard: React.FC<Props> = ({ taskId }) => {
  const services = useServices();
  const task = useStore((s) => s.tasks.get(taskId));
  const board = useFilteredBoard(services.store);
  const sortable = useSortable({ id: taskId });
  const [editing, setEditing] = React.useState(false);
  const [remarksEditing, setRemarksEditing] = React.useState(false);

  if (!task) return null;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  };

  async function handleOpen(): Promise<void> {
    if (!task) return;
    const file = services.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) return;
    const leaf = services.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }

  async function handleArchive(): Promise<void> {
    if (!task) return;
    await services.taskService.archiveTask(taskId);
  }

  async function handleDelete(): Promise<void> {
    if (!task) return;
    const ok = services.settings.confirmOnDelete
      ? await confirmDialog(services.app, {
          title: t("kanban.card.confirmDeleteTitle"),
          message: t("kanban.card.confirmDeleteMessage").replace("{title}", task.title),
          confirmText: t("kanban.card.delete"),
          destructive: true,
        })
      : true;
    if (!ok) return;
    await services.taskService.deleteTask(taskId);
  }

  async function handleSaveEdit(input: {
    title: string;
    priority: Priority | null;
    project: ProjectId | null;
    jiraKey: string | null;
    remarks: string | null;
    tags: string[];
    steps: string[];
    currentStep: number | null;
  }): Promise<void> {
    if (!task) return;
    await services.taskService.updateTask(taskId, input);
  }

  async function handleMoveStatus(status: TaskStatus): Promise<void> {
    if (!task || status === task.status) return;
    await services.taskService.moveTask(taskId, status);
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (!task) return;
    const isCmd = e.metaKey || e.ctrlKey;

    // Cmd/Ctrl + Enter: 다음 status. +Shift: 이전 status.
    if (e.key === "Enter" && isCmd) {
      e.preventDefault();
      const idx = TASK_STATUS_ORDER.indexOf(task.status);
      const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
      if (nextIdx >= 0 && nextIdx < TASK_STATUS_ORDER.length) {
        const next = TASK_STATUS_ORDER[nextIdx];
        if (next !== undefined) void services.taskService.moveTask(taskId, next);
      }
      return;
    }
    // Enter: 노트 열기
    if (e.key === "Enter") {
      e.preventDefault();
      void handleOpen();
      return;
    }
    // Cmd/Ctrl + E: archive
    if (isCmd && (e.key === "e" || e.key === "E")) {
      e.preventDefault();
      void handleArchive();
      return;
    }
    // Cmd/Ctrl + ArrowUp/ArrowDown: same-column reorder.
    if (isCmd && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const column = board.columns.find((c) => c.taskIds.includes(taskId));
      if (!column) return;
      const oldIndex = column.taskIds.indexOf(taskId);
      const newIndex = e.key === "ArrowUp" ? oldIndex - 1 : oldIndex + 1;
      if (oldIndex < 0 || newIndex < 0 || newIndex >= column.taskIds.length) return;
      const next = arrayMove(column.taskIds, oldIndex, newIndex);
      services.boardService.reorderVisibleInColumn(column.id, next);
      return;
    }
    // Cmd/Ctrl + Backspace/Delete: delete with confirm
    if (isCmd && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      void handleDelete();
      return;
    }
  }

  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      tabIndex={0}
      role="listitem"
      aria-label={`${task.title}, status ${statusLabel(task.status)}, priority ${task.priority ?? "none"}`}
      data-task-id={taskId}
      // listeners를 먼저 spread해 onPointerDown 등을 받고, 우리 keyDown/click이 winner.
      {...sortable.listeners}
      onKeyDown={handleKeyDown}
      onClick={() => void handleOpen()}
      className={
        "tm-rounded-md tm-p-3 tm-mb-2 tm-bg-tm-bg tm-text-tm-text tm-border tm-border-tm-border " +
        "tm-cursor-grab active:tm-cursor-grabbing hover:tm-bg-tm-bg-hover tm-select-none"
      }
    >
      <div className="tm-flex tm-items-start tm-justify-between tm-gap-2">
        <div className="tm-min-w-0">
          <div className="tm-font-medium tm-mb-1 tm-break-words">{task.title}</div>
          <div className="tm-flex tm-items-center tm-gap-2 tm-flex-wrap">
            <PriorityBadge priority={task.priority} />
            {task.jiraKey && <JiraLink jiraKey={task.jiraKey} />}
          </div>
          <TaskTags tags={task.tags} />
          <RemarksInlineEditor
            taskId={taskId}
            value={task.remarks}
            editing={remarksEditing}
            onEditingChange={setRemarksEditing}
          />
        </div>
        <DesktopCardMenu
          currentStatus={task.status}
          hasRemarks={Boolean(task.remarks)}
          onOpen={handleOpen}
          onEdit={() => setEditing(true)}
          onEditRemarks={() => setRemarksEditing(true)}
          onMoveStatus={handleMoveStatus}
          onArchive={handleArchive}
          onDelete={handleDelete}
        />
      </div>
      {editing && (
        <EditTaskModal
          task={task}
          onClose={() => setEditing(false)}
          onSave={handleSaveEdit}
        />
      )}
    </li>
  );
};

const DesktopCardMenu: React.FC<{
  currentStatus: TaskStatus;
  hasRemarks: boolean;
  onOpen: () => Promise<void>;
  onEdit: () => void;
  onEditRemarks: () => void;
  onMoveStatus: (status: TaskStatus) => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}> = ({ currentStatus, hasRemarks, onOpen, onEdit, onEditRemarks, onMoveStatus, onArchive, onDelete }) => {
  const menu = useDismissiblePopover();

  function run(action: () => void): void {
    menu.close();
    action();
  }

  function runAsync(action: () => Promise<unknown>): void {
    menu.close();
    void action();
  }

  return (
    <div
      ref={menu.rootRef}
      className="tm-relative tm-shrink-0"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        ref={menu.triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-label={t("mobile.card.menu")}
        onClick={() => menu.setOpen((open) => !open)}
        className="tm-cursor-pointer tm-rounded tm-px-2 tm-py-1 tm-text-tm-muted hover:tm-bg-tm-bg-hover hover:tm-text-tm-text"
      >
        ⋮
      </button>
      {menu.open && (
        <div
          role="menu"
          className="tm-absolute tm-right-0 tm-top-full tm-z-10 tm-min-w-32 tm-rounded tm-border tm-border-tm-border tm-bg-tm-bg tm-py-1 tm-shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => runAsync(onOpen)}
            className="tm-block tm-w-full tm-text-left tm-px-3 tm-py-1.5 tm-text-sm hover:tm-bg-tm-bg-hover"
          >
            {t("kanban.card.openNote")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onEdit)}
            className="tm-block tm-w-full tm-text-left tm-px-3 tm-py-1.5 tm-text-sm hover:tm-bg-tm-bg-hover"
          >
            {t("kanban.card.edit")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onEditRemarks)}
            className="tm-block tm-w-full tm-text-left tm-px-3 tm-py-1.5 tm-text-sm hover:tm-bg-tm-bg-hover"
          >
            {hasRemarks ? t("kanban.card.editRemarks") : t("kanban.card.addRemarks")}
          </button>
          <div className="tm-my-1 tm-border-t tm-border-tm-border" />
          <div className="tm-px-3 tm-py-1 tm-text-xs tm-font-medium tm-text-tm-muted">
            {t("kanban.card.statusMenu")}
          </div>
          {TASK_STATUS_ORDER.map((status) => {
            const label = statusLabel(status);
            const current = status === currentStatus;
            return (
              <button
                key={status}
                type="button"
                role="menuitem"
                disabled={current}
                aria-label={
                  current
                    ? t("kanban.card.currentStatus").replace("{status}", label)
                    : t("kanban.card.moveToStatus").replace("{status}", label)
                }
                onClick={() => runAsync(() => onMoveStatus(status))}
                className={
                  "tm-block tm-w-full tm-text-left tm-px-3 tm-py-1.5 tm-text-sm hover:tm-bg-tm-bg-hover disabled:tm-opacity-60 " +
                  (current ? "tm-text-tm-muted" : "")
                }
              >
                {current ? "* " : ""}
                {label}
              </button>
            );
          })}
          <div className="tm-my-1 tm-border-t tm-border-tm-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => runAsync(onArchive)}
            className="tm-block tm-w-full tm-text-left tm-px-3 tm-py-1.5 tm-text-sm hover:tm-bg-tm-bg-hover"
          >
            {t("kanban.card.archive")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAsync(onDelete)}
            className="tm-block tm-w-full tm-text-left tm-px-3 tm-py-1.5 tm-text-sm tm-text-tm-error hover:tm-bg-tm-bg-hover"
          >
            {t("kanban.card.delete")}
          </button>
        </div>
      )}
    </div>
  );
};

const JiraLink: React.FC<{ jiraKey: string }> = ({ jiraKey }) => {
  const { settings } = useServices();
  useStore((s) => s.settingsRevision);
  const base = settings.jiraBaseUrl.trim();

  // base URL 미설정 시 link 없이 텍스트만 (사용자 인지 가능).
  if (!base) {
    return (
      <span
        className="tm-text-xs tm-text-tm-muted tm-font-mono"
        title="Jira base URL not configured"
      >
        {jiraKey}
      </span>
    );
  }

  const normalized = base.endsWith("/") ? base : base + "/";
  const href = normalized + encodeURIComponent(jiraKey);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="tm-text-xs tm-text-tm-accent hover:tm-underline tm-font-mono"
    >
      {jiraKey}
    </a>
  );
};
