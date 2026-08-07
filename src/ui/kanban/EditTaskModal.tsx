import * as React from "react";
import { useStore } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import type { Priority, ProjectId, Task } from "../../core/types";

interface Props {
  task: Task;
  onClose: () => void;
  onSave: (input: {
    title: string;
    priority: Priority | null;
    project: ProjectId | null;
    jiraKey: string | null;
    remarks: string | null;
    tags: string[];
  }) => Promise<void> | void;
}

export const EditTaskModal: React.FC<Props> = ({ task, onClose, onSave }) => {
  const projects = useStore((s) => s.projects);
  const [title, setTitle] = React.useState(task.title);
  const [priority, setPriority] = React.useState<Priority | "none">(task.priority ?? "none");
  const [project, setProject] = React.useState<ProjectId | "none">(task.project ?? "none");
  const [jiraKey, setJiraKey] = React.useState(task.jiraKey ?? "");
  const [remarks, setRemarks] = React.useState(task.remarks ?? "");
  const [tags, setTags] = React.useState((task.tags ?? []).join(", "));
  const [submitting, setSubmitting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const titleId = React.useId();
  const priorityId = React.useId();
  const projectId = React.useId();
  const jiraKeyId = React.useId();
  const remarksId = React.useId();
  const tagsId = React.useId();

  const sortedProjects = React.useMemo(
    () => [...projects.values()].sort((a, b) => a.title.localeCompare(b.title)),
    [projects],
  );

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSave({
        title: trimmed,
        priority: priority === "none" ? null : priority,
        project: project === "none" ? null : project,
        jiraKey: jiraKey.trim() || null,
        remarks: remarks.trim() || null,
        tags: parseTags(tags),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("modal.task.editHeader")}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="tm-fixed tm-inset-0 tm-bg-black/40 tm-flex tm-items-center tm-justify-center tm-z-50"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="tm-bg-tm-bg tm-rounded-md tm-p-4 tm-w-96 tm-max-w-full tm-max-h-[90vh] tm-overflow-y-auto tm-border tm-border-tm-border"
      >
        <h3 className="tm-text-lg tm-font-medium tm-mb-3">{t("modal.task.editHeader")}</h3>

        <label htmlFor={titleId} className="tm-block tm-text-sm tm-mb-1">{t("modal.task.title")}</label>
        <input
          id={titleId}
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="tm-w-full tm-px-3 tm-py-2 tm-mb-3 tm-bg-tm-bg-alt tm-border tm-border-tm-border tm-rounded tm-text-tm-text"
        />

        <div className="tm-grid tm-grid-cols-2 tm-gap-3">
          <div>
            <label htmlFor={priorityId} className="tm-block tm-text-sm tm-mb-1">{t("modal.task.priority")}</label>
            <select
              id={priorityId}
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority | "none")}
              className="tm-w-full tm-px-2 tm-py-1.5 tm-bg-tm-bg-alt tm-border tm-border-tm-border tm-rounded"
            >
              <option value="none">{t("modal.task.priorityNone")}</option>
              <option value="low">{t("modal.task.priorityLow")}</option>
              <option value="medium">{t("modal.task.priorityMedium")}</option>
              <option value="high">{t("modal.task.priorityHigh")}</option>
            </select>
          </div>
          <div>
            <label htmlFor={projectId} className="tm-block tm-text-sm tm-mb-1">{t("modal.task.project")}</label>
            <select
              id={projectId}
              value={project}
              onChange={(e) => setProject(e.target.value as ProjectId | "none")}
              className="tm-w-full tm-px-2 tm-py-1.5 tm-bg-tm-bg-alt tm-border tm-border-tm-border tm-rounded"
            >
              <option value="none">{t("header.noProject")}</option>
              {sortedProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
        </div>

        <label htmlFor={jiraKeyId} className="tm-block tm-text-sm tm-mt-3 tm-mb-1">
          {t("modal.task.jiraKey")}
        </label>
        <input
          id={jiraKeyId}
          type="text"
          value={jiraKey}
          onChange={(e) => setJiraKey(e.target.value)}
          placeholder={t("modal.task.jiraKeyPlaceholder")}
          className="tm-w-full tm-px-3 tm-py-2 tm-bg-tm-bg-alt tm-border tm-border-tm-border tm-rounded tm-text-tm-text"
        />

        <label htmlFor={remarksId} className="tm-block tm-text-sm tm-mt-3 tm-mb-1">
          {t("modal.task.remarks")}
        </label>
        <textarea
          id={remarksId}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder={t("modal.task.remarksPlaceholder")}
          rows={3}
          className="tm-w-full tm-resize-y tm-px-3 tm-py-2 tm-bg-tm-bg-alt tm-border tm-border-tm-border tm-rounded tm-text-tm-text"
        />

        <label htmlFor={tagsId} className="tm-block tm-text-sm tm-mt-3 tm-mb-1">
          {t("modal.task.tags")}
        </label>
        <input
          id={tagsId}
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder={t("modal.task.tagsPlaceholder")}
          className="tm-w-full tm-px-3 tm-py-2 tm-bg-tm-bg-alt tm-border tm-border-tm-border tm-rounded tm-text-tm-text"
        />

        <div className="tm-flex tm-justify-end tm-gap-2 tm-mt-4">
          <button type="button" onClick={onClose} className="tm-px-3 tm-py-1.5 tm-text-sm">
            {t("modal.task.cancel")}
          </button>
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            className="tm-px-3 tm-py-1.5 tm-text-sm tm-bg-tm-accent tm-text-white tm-rounded disabled:tm-opacity-50"
          >
            {submitting ? t("modal.task.saving") : t("modal.task.save")}
          </button>
        </div>
      </form>
    </div>
  );
};

function parseTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}
