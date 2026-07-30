import * as React from "react";
import { useStore } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import type { ProjectFilter } from "../../store/taskMasterStore";
import type { ProjectId } from "../../core/types";
import { OpenProjectMemoButton } from "./OpenProjectMemoButton";
import { ProjectMemoComposer } from "./ProjectMemoComposer";
import { ProjectMemoPreview } from "./ProjectMemoPreview";
import { NewMeetingButton } from "./NewMeetingButton";

export const ProjectContextHeader: React.FC = () => {
  const selected = useStore((s) => s.selectedProjectId);
  const project = useStore((s) =>
    isProjectId(selected) ? s.projects.get(selected) ?? null : null,
  );
  const [memoOpen, setMemoOpen] = React.useState(false);

  React.useEffect(() => {
    setMemoOpen(false);
  }, [selected]);

  if (!isProjectId(selected) || !project) return null;

  return (
    <section
      aria-label={t("projectMemo.contextLabel")}
      className="tm-border-b tm-border-tm-border tm-bg-tm-bg tm-px-4 tm-py-3"
    >
      <div className="tm-flex tm-flex-wrap tm-items-center tm-justify-between tm-gap-2">
        <h2 className="tm-min-w-0 tm-truncate tm-text-base tm-font-semibold tm-text-tm-text">
          {project.title}
        </h2>
        <div className="tm-flex tm-flex-wrap tm-items-center tm-gap-2">
          <NewMeetingButton project={project} />
          <OpenProjectMemoButton />
          <button
            type="button"
            aria-expanded={memoOpen}
            onClick={() => setMemoOpen((open) => !open)}
            className="tm-px-3 tm-py-1.5 tm-text-sm tm-border tm-border-tm-border tm-rounded hover:tm-bg-tm-bg-hover"
          >
            {memoOpen ? t("projectMemo.collapse") : t("projectMemo.expand")}
          </button>
        </div>
      </div>
      {memoOpen && (
        <>
          <ProjectMemoPreview projectId={project.id} />
          <div className="tm-mt-3">
            <ProjectMemoComposer projectId={project.id} />
          </div>
        </>
      )}
    </section>
  );
};

function isProjectId(v: ProjectFilter): v is ProjectId {
  return v !== "all" && v !== "none";
}
