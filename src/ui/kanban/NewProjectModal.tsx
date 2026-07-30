// 단순 React modal (overlay 형태). Obsidian Modal API와 React 통합 복잡도 회피.
// ESC + outside click + Enter submit 지원.

import * as React from "react";
import { t } from "../../i18n";

interface Props {
  onClose: () => void;
  onCreate: (title: string) => Promise<void> | void;
}

export const NewProjectModal: React.FC<Props> = ({ onClose, onCreate }) => {
  const [title, setTitle] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

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
      await onCreate(trimmed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("modal.project.header")}
      onClick={onClose}
      className="tm-fixed tm-inset-0 tm-bg-black/40 tm-flex tm-items-center tm-justify-center tm-z-50"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="tm-bg-tm-bg tm-rounded-md tm-p-4 tm-w-96 tm-max-w-full tm-border tm-border-tm-border"
      >
        <h3 className="tm-text-lg tm-font-medium tm-mb-3">{t("modal.project.header")}</h3>
        <input
          ref={inputRef}
          type="text"
          placeholder={t("modal.project.placeholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="tm-w-full tm-px-3 tm-py-2 tm-bg-tm-bg-alt tm-border tm-border-tm-border tm-rounded tm-text-tm-text"
        />
        <div className="tm-flex tm-justify-end tm-gap-2 tm-mt-4">
          <button
            type="button"
            onClick={onClose}
            className="tm-px-3 tm-py-1.5 tm-text-sm"
          >
            {t("modal.task.cancel")}
          </button>
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            className="tm-px-3 tm-py-1.5 tm-text-sm tm-bg-tm-accent tm-text-white tm-rounded disabled:tm-opacity-50"
          >
            {submitting ? t("modal.task.creating") : t("modal.task.create")}
          </button>
        </div>
      </form>
    </div>
  );
};
