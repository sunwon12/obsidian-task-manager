// LLD §9.1: React tree root.
// M5: BoardHeader + KanbanBoard 활성화.

import * as React from "react";
import type { App as ObsidianApp } from "obsidian";
import type { ServiceContainer } from "../main";
import { TaskMasterProvider, useStore } from "./providers/TaskMasterProvider";
import { BoardHeader } from "../ui/kanban/BoardHeader";
import { KanbanBoard } from "../ui/kanban/KanbanBoard";
import { ProjectContextHeader } from "../ui/kanban/ProjectContextHeader";
import { ArchiveView } from "../ui/kanban/ArchiveView";

export interface AppProps {
  container: ServiceContainer;
  app: ObsidianApp;
}

export const App: React.FC<AppProps> = ({ container, app }) => {
  return (
    <TaskMasterProvider container={container} app={app}>
      <div className="tm-flex tm-flex-col tm-h-full">
        <BoardHeader />
        <ProjectContextHeader />
        <div className="tm-flex-1 tm-overflow-hidden">
          <MainContent />
        </div>
      </div>
    </TaskMasterProvider>
  );
};

const MainContent: React.FC = () => {
  const viewMode = useStore((s) => s.viewMode);
  if (viewMode === "archive") return <ArchiveView />;
  return <KanbanBoard />;
};
