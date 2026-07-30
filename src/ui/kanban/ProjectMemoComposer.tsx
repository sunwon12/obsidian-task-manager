import * as React from "react";
import { useServices } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import type { ProjectId } from "../../core/types";

type SaveState = "idle" | "saving" | "saved" | "error";

export const ProjectMemoComposer: React.FC<{ projectId: ProjectId }> = ({ projectId }) => {
  const services = useServices();
  const [text, setText] = React.useState("");
  const [state, setState] = React.useState<SaveState>("idle");

  const trimmed = text.trim();
  const disabled = !trimmed || state === "saving";

  async function save(): Promise<void> {
    if (disabled) return;
    setState("saving");
    try {
      await services.projectMemoService.appendMemo(projectId, text);
      setText("");
      setState("saved");
    } catch {
      setState("error");
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  }

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>): void {
    setText(event.target.value);
    if (state !== "idle") setState("idle");
  }

  return (
    <div className="tm-flex tm-flex-col tm-gap-2">
      <textarea
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        aria-label={t("projectMemo.inputLabel")}
        placeholder={t("projectMemo.placeholder")}
        rows={2}
        className="tm-w-full tm-resize-y tm-rounded tm-border tm-border-tm-border tm-bg-tm-bg tm-px-3 tm-py-2 tm-text-sm tm-text-tm-text placeholder:tm-text-tm-text-muted focus:tm-outline-none focus:tm-ring-2 focus:tm-ring-tm-accent"
      />
      <div className="tm-flex tm-flex-wrap tm-items-center tm-justify-between tm-gap-2">
        <div role="status" className="tm-min-h-5 tm-text-xs tm-text-tm-text-muted">
          {state === "saving" && t("projectMemo.saving")}
          {state === "saved" && t("projectMemo.saved")}
          {state === "error" && t("projectMemo.error")}
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={disabled}
          className="tm-px-3 tm-py-1.5 tm-text-sm tm-bg-tm-accent tm-text-white tm-rounded hover:tm-opacity-90 disabled:tm-opacity-50"
        >
          {t("projectMemo.save")}
        </button>
      </div>
    </div>
  );
};
