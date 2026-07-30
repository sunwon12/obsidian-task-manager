import * as React from "react";
import { useServices } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import type { TaskId } from "../../core/types";

interface Props {
  taskId: TaskId;
  value: string | null;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}

export const RemarksInlineEditor: React.FC<Props> = ({
  taskId,
  value,
  editing,
  onEditingChange,
}) => {
  const services = useServices();
  const [draft, setDraft] = React.useState(value ?? "");
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const inputId = React.useId();

  React.useEffect(() => {
    if (!editing) {
      setDraft(value ?? "");
      setStatus("idle");
    }
  }, [editing, value]);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function save(): Promise<void> {
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) {
      onEditingChange(false);
      return;
    }
    setStatus("saving");
    try {
      await services.taskService.setRemarks(taskId, trimmed || null);
      setStatus("saved");
      onEditingChange(false);
    } catch {
      setStatus("error");
    }
  }

  function cancel(): void {
    setDraft(value ?? "");
    setStatus("idle");
    onEditingChange(false);
  }

  if (!editing && !value) return null;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEditingChange(true);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="tm-mt-2 tm-block tm-w-full tm-text-left tm-text-xs tm-leading-5 tm-text-tm-text-muted hover:tm-text-tm-text"
      >
        <span
          className="tm-overflow-hidden"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {value}
        </span>
      </button>
    );
  }

  return (
    <div
      className="tm-mt-2 tm-rounded tm-border tm-border-tm-border tm-bg-tm-bg-alt tm-p-2"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <label htmlFor={inputId} className="tm-sr-only">
        {t("kanban.card.remarksPlaceholder")}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder={t("kanban.card.remarksPlaceholder")}
        className="tm-w-full tm-rounded tm-border tm-border-tm-border tm-bg-tm-bg tm-px-2 tm-py-1.5 tm-text-sm tm-text-tm-text"
      />
      <div className="tm-mt-2 tm-flex tm-items-center tm-justify-between tm-gap-2">
        <span role="status" className="tm-text-xs tm-text-tm-muted">
          {status === "saving" ? t("kanban.card.remarksSaving") : ""}
          {status === "saved" ? t("kanban.card.remarksSaved") : ""}
          {status === "error" ? t("kanban.card.remarksError") : ""}
        </span>
        <span className="tm-flex tm-gap-1">
          <button
            type="button"
            onClick={cancel}
            className="tm-rounded tm-px-2 tm-py-1 tm-text-xs tm-text-tm-muted hover:tm-bg-tm-bg-hover"
          >
            {t("kanban.card.remarksCancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={status === "saving"}
            className="tm-rounded tm-bg-tm-accent tm-px-2 tm-py-1 tm-text-xs tm-text-white disabled:tm-opacity-50"
          >
            {t("kanban.card.remarksSave")}
          </button>
        </span>
      </div>
    </div>
  );
};
