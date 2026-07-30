// HLD §8.3: 프로젝트 선택 + 새 프로젝트 만들기.

import * as React from "react";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { NewProjectModal } from "./NewProjectModal";
import { t } from "../../i18n";
import type { ProjectFilter } from "../../store/taskMasterStore";

const NEW_SENTINEL = "__new__";

export const ProjectSelector: React.FC = () => {
  const services = useServices();
  const projects = useStore((s) => s.projects);
  const selected = useStore((s) => s.selectedProjectId);
  const [modalOpen, setModalOpen] = React.useState(false);

  const sortedProjects = React.useMemo(
    () => [...projects.values()].sort((a, b) => a.title.localeCompare(b.title)),
    [projects],
  );

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const v = e.target.value;
    if (v === NEW_SENTINEL) {
      setModalOpen(true);
      return;
    }
    services.store.getState().setProjectFilter(v as ProjectFilter);
  }

  async function handleCreate(title: string): Promise<void> {
    const project = await services.projectService.createProject({ title });
    services.store.getState().setProjectFilter(project.id);
    setModalOpen(false);
  }

  return (
    <>
      <select
        value={selected}
        onChange={handleChange}
        aria-label={t("header.projectFilter")}
        className="tm-text-sm tm-bg-tm-bg tm-border tm-border-tm-border tm-rounded tm-px-2 tm-py-1"
      >
        <option value="all">{t("header.allProjects")}</option>
        <option value="none">{t("header.noProject")}</option>
        {sortedProjects.length > 0 && <option disabled>──────</option>}
        {sortedProjects.map((p) => (
          <option key={p.id} value={p.id}>{p.title}</option>
        ))}
        <option disabled>──────</option>
        <option value={NEW_SENTINEL}>{t("header.newProject")}</option>
      </select>
      {modalOpen && (
        <NewProjectModal
          onClose={() => setModalOpen(false)}
          onCreate={handleCreate}
        />
      )}
    </>
  );
};
