import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, fireEvent, act } from "@testing-library/react";
import { App as ObsidianApp, type WorkspaceLeaf } from "obsidian";
import { TaskMasterProvider } from "../../../src/app/providers/TaskMasterProvider";
import { createTaskMasterStore } from "../../../src/store/taskMasterStore";
import { EventBus } from "../../../src/core/eventBus";
import { DiagnosticsLog } from "../../../src/core/diagnostics";
import {
  BoardRepository, MeetingRepository, ProjectRepository, TaskRepository,
} from "../../../src/repositories";
import {
  BoardService, MeetingService, ProjectMemoService, ProjectService, TaskService,
} from "../../../src/services";
import { OpenProjectMemoButton } from "../../../src/ui/kanban/OpenProjectMemoButton";
import { DEFAULT_SETTINGS } from "../../../src/core/types";
import type { ServiceContainer } from "../../../src/main";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function build(): { app: ObsidianApp; container: ServiceContainer } {
  const app = new ObsidianApp();
  const store = createTaskMasterStore();
  const events = new EventBus();
  const diagnostics = new DiagnosticsLog();
  const boardRepo = new BoardRepository(app, diagnostics, "TaskMaster/.board.json", 500);
  const boardService = new BoardService(boardRepo, store, events);
  const taskRepo = new TaskRepository(app, diagnostics, 500, "TaskMaster/Tasks", "TaskMaster/Archive");
  const projectRepo = new ProjectRepository(app, diagnostics, "TaskMaster/Projects");
  const meetingRepo = new MeetingRepository(app, diagnostics, "TaskMaster/Meetings");
  const container: ServiceContainer = {
    store,
    taskService: new TaskService(taskRepo, boardService, store, events),
    boardService,
    projectService: new ProjectService(projectRepo, store),
    projectMemoService: new ProjectMemoService(projectRepo, store),
    meetingService: new MeetingService(meetingRepo, store),
    events,
    diagnostics,
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
  };
  return { app, container };
}

function renderWithProvider(container: ServiceContainer, app: ObsidianApp) {
  return render(
    <TaskMasterProvider container={container} app={app}>
      <OpenProjectMemoButton />
    </TaskMasterProvider>,
  );
}

describe("OpenProjectMemoButton", () => {
  it("is hidden unless a real project is selected", () => {
    const { app, container } = build();
    const { queryByText } = renderWithProvider(container, app);
    expect(queryByText(/Open memo|메모 열기/)).toBeNull();
  });

  it("opens the selected project note", async () => {
    const { app, container } = build();
    const project = await container.projectService.createProject({ title: "Checkout" });
    container.store.getState().setProjectFilter(project.id);
    const openFile = vi.fn();
    vi.spyOn(app.workspace, "getLeaf").mockReturnValue({
      openFile,
    } as unknown as WorkspaceLeaf);

    const { getByText } = renderWithProvider(container, app);
    await act(async () => {
      fireEvent.click(getByText(/Open memo|메모 열기/));
    });

    expect(openFile).toHaveBeenCalledWith(
      app.vault.getAbstractFileByPath(project.path),
    );
  });
});
