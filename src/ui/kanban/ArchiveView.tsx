import * as React from "react";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import type { ProjectFilter } from "../../store/taskMasterStore";
import type { ProjectId, Task } from "../../core/types";

export const ArchiveView: React.FC = () => {
  const services = useServices();
  const tasks = useStore((s) => s.tasks);
  const selectedProjectId = useStore((s) => s.selectedProjectId);

  const archived = React.useMemo(
    () => [...tasks.values()]
      .filter((task) => Boolean(task.archivedAt))
      .filter((task) => matchesProject(task, selectedProjectId))
      .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "")),
    [tasks, selectedProjectId],
  );

  return (
    <section className="tm-h-full tm-overflow-y-auto tm-p-4" aria-label={t("archive.title")}>
      <div className="tm-mb-3 tm-flex tm-items-center tm-justify-between tm-gap-2">
        <h2 className="tm-text-base tm-font-semibold tm-text-tm-text">{t("archive.title")}</h2>
        <span className="tm-text-xs tm-text-tm-text-muted">{archived.length}</span>
      </div>
      {archived.length === 0 ? (
        <p className="tm-text-sm tm-text-tm-text-muted">{t("archive.empty")}</p>
      ) : (
        <ul role="list" className="tm-space-y-2">
          {archived.map((task) => (
            <li
              key={task.id}
              className="tm-flex tm-flex-wrap tm-items-center tm-gap-2 tm-rounded tm-border tm-border-tm-border tm-bg-tm-bg-alt tm-p-3"
            >
              <div className="tm-min-w-40 tm-flex-1">
                <div className="tm-font-medium tm-text-tm-text">{task.title}</div>
                <div className="tm-text-xs tm-text-tm-text-muted">
                  {t("archive.archivedAt")} {formatArchiveTime(task.archivedAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void services.taskService.restoreTask(task.id)}
                className="tm-rounded tm-border tm-border-tm-border tm-px-3 tm-py-1.5 tm-text-sm hover:tm-bg-tm-bg-hover"
              >
                {t("archive.restore")}
              </button>
              <button
                type="button"
                onClick={() => void services.taskService.deleteTask(task.id)}
                className="tm-rounded tm-border tm-border-tm-border tm-px-3 tm-py-1.5 tm-text-sm tm-text-tm-error hover:tm-bg-tm-bg-hover"
              >
                {t("kanban.card.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

function matchesProject(task: Task, selected: ProjectFilter): boolean {
  if (selected === "all") return true;
  if (selected === "none") return task.project === null;
  return task.project === (selected as ProjectId);
}

function formatArchiveTime(value: string | null): string {
  return value ? value.slice(0, 16).replace("T", " ") : "";
}
