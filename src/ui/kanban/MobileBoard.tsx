// LLD §9.4, ADR-0009: 모바일은 dnd 미사용. status tab + "다음 status" 액션 버튼.

import * as React from "react";
import { TFile } from "obsidian";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { useFilteredBoard } from "../../store/selectors";
import { PriorityBadge } from "../components/PriorityBadge";
import { TaskTags } from "../components/TaskTags";
import { confirmDialog } from "../components/confirmDialog";
import { useDismissiblePopover } from "../hooks/useDismissiblePopover";
import { t } from "../../i18n";
import { TASK_STATUS_ORDER } from "../../core/types";
import type { ColumnId, Priority, ProjectId, TaskId } from "../../core/types";
import type { ProjectFilter } from "../../store/taskMasterStore";
import { EditTaskModal } from "./EditTaskModal";
import { RemarksInlineEditor } from "./RemarksInlineEditor";
import { StatusVisibilityBar } from "./StatusVisibilityBar";
import {
  countTasksByStatus,
  getNextHiddenStatuses,
  getVisibleColumns,
  getVisibleStatusFallback,
} from "./statusVisibility";
import { getStatusColor } from "./statusColors";
import { statusLabel } from "./statusLabels";

const STATUS_ORDER = TASK_STATUS_ORDER;

export const MobileBoard: React.FC = () => {
  const services = useServices();
  const board = useFilteredBoard(services.store);
  const settingsRevision = useStore((s) => s.settingsRevision);
  const [active, setActive] = React.useState<ColumnId>("todo");
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

  const resolvedActive = getVisibleStatusFallback(active, visibleColumns);

  React.useEffect(() => {
    if (active !== resolvedActive) setActive(resolvedActive);
  }, [active, resolvedActive]);

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

  const column = visibleColumns.find((c) => c.id === resolvedActive);

  return (
    <div className="tm-flex tm-flex-col tm-h-full">
      <StatusVisibilityBar
        hiddenStatuses={hiddenStatuses}
        counts={counts}
        onToggleStatus={toggleStatusVisibility}
        className="tm-border-b tm-border-tm-border tm-p-2"
      />
      <div
        role="tablist"
        aria-label={t("mobile.tabs.label")}
        className="tm-flex tm-overflow-x-auto tm-border-b tm-border-tm-border"
      >
        {visibleColumns.map((c) => {
          const color = getStatusColor(c.id);
          const activeTab = resolvedActive === c.id;
          return (
            <button
              key={c.id}
              id={`tm-tab-${c.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab}
              onClick={() => setActive(c.id)}
              style={activeTab ? { borderBottomColor: color.solid, color: color.text } : undefined}
              className={
                "tm-flex tm-min-w-24 tm-shrink-0 tm-items-center tm-gap-2 tm-px-3 tm-py-2 tm-text-sm tm-font-medium " +
                (activeTab
                  ? "tm-border-b-2"
                  : "tm-text-tm-muted")
              }
            >
              <span
                aria-hidden="true"
                className="tm-h-2 tm-w-2 tm-shrink-0 tm-rounded-full"
                style={{ backgroundColor: color.solid, opacity: activeTab ? 1 : 0.55 }}
              />
              <span>
                {c.title} ({c.taskIds.length})
              </span>
            </button>
          );
        })}
      </div>

      <MobileQuickAdd status={resolvedActive} />

      <ul role="list" aria-labelledby={`tm-tab-${resolvedActive}`} className="tm-flex-1 tm-overflow-y-auto tm-p-2">
        {column?.taskIds.map((id) => <MobileCard key={id} taskId={id} />)}
        {column && column.taskIds.length === 0 && (
          <li className="tm-text-tm-faint tm-text-sm tm-text-center tm-py-6">
            {t("kanban.column.empty")}
          </li>
        )}
      </ul>
    </div>
  );
};

const MobileQuickAdd: React.FC<{ status: ColumnId }> = ({ status }) => {
  const services = useServices();
  const projectFilter = useStore((s) => s.selectedProjectId);
  const [title, setTitle] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const label = statusLabel(status);
  const defaultProject = isProjectId(projectFilter) ? projectFilter : null;

  async function create(): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await services.taskService.createTask({
        title: trimmed,
        status,
        project: defaultProject,
      });
      setTitle("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      aria-label={t("kanban.column.quickAdd").replace("{status}", label)}
      className="tm-flex tm-gap-2 tm-border-b tm-border-tm-border tm-p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setTitle("");
        }}
        placeholder={t("kanban.column.quickAddPlaceholder")}
        className="tm-min-w-0 tm-flex-1 tm-rounded tm-border tm-border-tm-border tm-bg-tm-bg-alt tm-px-2 tm-py-1.5 tm-text-sm tm-text-tm-text"
      />
      <button
        type="submit"
        disabled={!title.trim() || submitting}
        className="tm-rounded tm-bg-tm-accent tm-px-3 tm-py-1.5 tm-text-sm tm-text-white disabled:tm-opacity-50"
      >
        {t("kanban.column.quickAddSubmit")}
      </button>
    </form>
  );
};

const MobileCard: React.FC<{ taskId: TaskId }> = ({ taskId }) => {
  const services = useServices();
  const task = useStore((s) => s.tasks.get(taskId));
  const menu = useDismissiblePopover();
  const [editing, setEditing] = React.useState(false);
  const [remarksEditing, setRemarksEditing] = React.useState(false);
  if (!task) return null;

  const idx = STATUS_ORDER.indexOf(task.status);
  const next = idx >= 0 && idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : undefined;
  const prev = idx > 0 ? STATUS_ORDER[idx - 1] : undefined;

  async function handleOpen(): Promise<void> {
    if (!task) return;
    const file = services.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) return;
    const leaf = services.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }

  async function handleArchive(): Promise<void> {
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
    await services.taskService.updateTask(taskId, input);
  }

  function run(action: () => void): void {
    menu.close();
    action();
  }

  function runAsync(action: () => Promise<unknown>): void {
    menu.close();
    void action();
  }

  return (
    <li className="tm-mb-2 tm-rounded-md tm-border tm-border-tm-border tm-bg-tm-bg-alt tm-p-3">
      <div className="tm-flex tm-items-center tm-gap-2">
        <button
          type="button"
          onClick={() => void handleOpen()}
          className="tm-min-w-0 tm-flex-1 tm-text-left"
        >
          <div className="tm-font-medium tm-mb-1 tm-break-words">{task.title}</div>
          <div className="tm-flex tm-items-center tm-gap-2 tm-flex-wrap">
            <PriorityBadge priority={task.priority} />
            {task.jiraKey && (
              <span className="tm-text-xs tm-text-tm-muted tm-font-mono">{task.jiraKey}</span>
            )}
          </div>
          <TaskTags tags={task.tags} />
        </button>
        {prev && (
          <button
            type="button"
            aria-label={t("mobile.card.movePrev").replace("{status}", prev)}
            onClick={() => void services.taskService.moveTask(taskId, prev)}
            className="tm-px-2 tm-py-1 tm-text-tm-muted"
          >
            ←
          </button>
        )}
        {next && (
          <button
            type="button"
            aria-label={t("mobile.card.moveNext").replace("{status}", next)}
            onClick={() => void services.taskService.moveTask(taskId, next)}
            className="tm-px-2 tm-py-1 tm-text-tm-accent"
          >
            →
          </button>
        )}
        <div ref={menu.rootRef} className="tm-relative">
          <button
            ref={menu.triggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu.open}
            aria-label={t("mobile.card.menu")}
            onClick={() => menu.setOpen((open) => !open)}
            className="tm-rounded tm-px-2 tm-py-1 tm-text-tm-muted hover:tm-bg-tm-bg-hover"
          >
            ⋮
          </button>
          {menu.open && (
            <div
              role="menu"
              className="tm-absolute tm-right-0 tm-top-full tm-bg-tm-bg tm-border tm-border-tm-border tm-rounded tm-py-1 tm-z-10 tm-min-w-40"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => run(() => setEditing(true))}
                className="tm-block tm-w-full tm-text-left tm-px-3 tm-py-1.5 tm-text-sm hover:tm-bg-tm-bg-hover"
              >
                {t("kanban.card.edit")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => run(() => setRemarksEditing(true))}
                className="tm-block tm-w-full tm-text-left tm-px-3 tm-py-1.5 tm-text-sm hover:tm-bg-tm-bg-hover"
              >
                {task.remarks ? t("kanban.card.editRemarks") : t("kanban.card.addRemarks")}
              </button>
              <div className="tm-my-1 tm-border-t tm-border-tm-border" />
              <div className="tm-px-3 tm-py-1 tm-text-xs tm-font-medium tm-text-tm-muted">
                {t("kanban.card.statusMenu")}
              </div>
              {TASK_STATUS_ORDER.map((status) => {
                const label = statusLabel(status);
                const current = status === task.status;
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
                    onClick={() => runAsync(() => services.taskService.moveTask(taskId, status))}
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
                onClick={() => runAsync(handleArchive)}
                className="tm-block tm-w-full tm-text-left tm-px-3 tm-py-1.5 tm-text-sm hover:tm-bg-tm-bg-hover"
              >
                {t("kanban.card.archive")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => runAsync(handleDelete)}
                className="tm-block tm-w-full tm-text-left tm-px-3 tm-py-1.5 tm-text-sm tm-text-tm-error hover:tm-bg-tm-bg-hover"
              >
                {t("kanban.card.delete")}
              </button>
            </div>
          )}
        </div>
      </div>
      <RemarksInlineEditor
        taskId={taskId}
        value={task.remarks}
        editing={remarksEditing}
        onEditingChange={setRemarksEditing}
      />
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

function isProjectId(v: ProjectFilter): v is ProjectId {
  return v !== "all" && v !== "none";
}
