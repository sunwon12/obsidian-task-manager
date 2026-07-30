// HLD §8.1: BoardHeader = ProjectSelector + HideCompletedToggle + NewTaskButton.

import * as React from "react";
import { useServices, useStore } from "../../app/providers/TaskMasterProvider";
import { ProjectSelector } from "./ProjectSelector";
import { HideCompletedToggle } from "./HideCompletedToggle";
import { NewTaskButton } from "./NewTaskButton";
import { t } from "../../i18n";
import { BoardFilters } from "./BoardFilters";

export const BoardHeader: React.FC = () => {
  const services = useServices();
  const viewMode = useStore((s) => s.viewMode);
  const isArchive = viewMode === "archive";

  return (
    <header className="tm-flex tm-flex-wrap tm-items-center tm-justify-between tm-gap-3 tm-px-4 tm-py-3 tm-border-b tm-border-tm-border">
      <div className="tm-flex tm-flex-wrap tm-items-center tm-gap-3">
        <ProjectSelector />
        <HideCompletedToggle />
        <BoardFilters />
      </div>
      <div className="tm-flex tm-items-center tm-gap-2">
        <button
          type="button"
          onClick={() => services.store.getState().setViewMode(isArchive ? "board" : "archive")}
          className="tm-px-3 tm-py-1.5 tm-text-sm tm-border tm-border-tm-border tm-rounded hover:tm-bg-tm-bg-hover"
        >
          {isArchive ? t("header.boardView") : t("header.archiveView")}
        </button>
        <NewTaskButton />
      </div>
    </header>
  );
};
