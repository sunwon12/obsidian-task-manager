import * as React from "react";
import { Notice, TFile } from "obsidian";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import type { ProjectFilter } from "../../store/taskMasterStore";
import type { ProjectId } from "../../core/types";

export const OpenProjectMemoButton: React.FC = () => {
  const services = useServices();
  const selected = useStore((s) => s.selectedProjectId);

  if (!isProjectId(selected)) return null;

  async function handleOpen(): Promise<void> {
    if (!isProjectId(selected)) return;
    const path = services.projectService.getProjectPath(selected);
    if (!path) {
      new Notice(t("header.openProjectMemoMissing"));
      return;
    }
    const file = services.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(t("header.openProjectMemoMissing"));
      return;
    }
    const leaf = services.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }

  return (
    <button
      type="button"
      onClick={() => void handleOpen()}
      className="tm-px-3 tm-py-1.5 tm-text-sm tm-border tm-border-tm-border tm-rounded hover:tm-bg-tm-bg-hover"
    >
      {t("header.openProjectMemo")}
    </button>
  );
};

function isProjectId(v: ProjectFilter): v is ProjectId {
  return v !== "all" && v !== "none";
}
