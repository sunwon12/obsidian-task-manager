import * as React from "react";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import type { ProjectId } from "../../core/types";
import type { ProjectMemoBlock } from "../../services/ProjectMemoService";
import { ProjectMemoActions } from "./ProjectMemoActions";

export const ProjectMemoPreview: React.FC<{ projectId: ProjectId }> = ({ projectId }) => {
  const services = useServices();
  const project = useStore((s) => s.projects.get(projectId) ?? null);
  const [memos, setMemos] = React.useState<ProjectMemoBlock[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void services.projectMemoService.listRecentMemos(projectId, 3)
      .then((next) => {
        if (!cancelled) {
          setMemos((prev) => (sameMemos(prev, next) ? prev : next));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMemos((prev) => (prev.length === 0 ? prev : []));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [services.projectMemoService, projectId, project]);

  if (memos.length === 0) return null;

  return (
    <ul
      aria-label={t("projectMemo.previewLabel")}
      className="tm-mt-3 tm-space-y-1 tm-text-xs tm-text-tm-text-muted"
    >
      {memos.map((memo) => (
        <li key={memo.id} className="tm-flex tm-flex-wrap tm-items-center tm-gap-2 tm-min-w-0">
          <span className="tm-shrink-0 tm-font-medium">{memo.time}</span>
          <span className="tm-min-w-40 tm-flex-1 tm-truncate">{toPlainSummary(memo.text)}</span>
          <ProjectMemoActions projectId={projectId} memo={memo} />
        </li>
      ))}
    </ul>
  );
};

function toPlainSummary(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function sameMemos(a: readonly ProjectMemoBlock[], b: readonly ProjectMemoBlock[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((memo, idx) => {
    const other = b[idx];
    if (!other) return false;
    return memo.id === other.id &&
      memo.time === other.time &&
      memo.text === other.text;
  });
}

export const __test_toPlainSummary = toPlainSummary;
