import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { App as ObsidianApp } from "obsidian";
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
import { DEFAULT_SETTINGS } from "../../../src/core/types";
import { ArchiveView } from "../../../src/ui/kanban/ArchiveView";
import type { ServiceContainer } from "../../../src/main";
import type { BoardState, ColumnId, TaskId } from "../../../src/core/types";

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
  return {
    app,
    container: {
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
    },
  };
}

function renderArchive(container: ServiceContainer, app: ObsidianApp) {
  return render(
    <TaskMasterProvider container={container} app={app}>
      <ArchiveView />
    </TaskMasterProvider>,
  );
}

function taskIds(board: BoardState, id: ColumnId): TaskId[] {
  return board.columns.find((c) => c.id === id)?.taskIds ?? [];
}

describe("ArchiveView", () => {
  it("shows archived tasks and restores them to the active board", async () => {
    const { app, container } = build();
    const active = await container.taskService.createTask({ title: "active task" });
    const archived = await container.taskService.createTask({ title: "archived task", status: "doing" });
    await container.taskService.archiveTask(archived.id);

    const { getByText, queryByText } = renderArchive(container, app);
    expect(getByText("archived task")).toBeTruthy();
    expect(queryByText("active task")).toBeNull();

    await act(async () => {
      fireEvent.click(getByText(/Restore|복원/));
    });

    expect(container.store.getState().tasks.get(archived.id)?.archivedAt).toBeNull();
    expect(taskIds(container.store.getState().board, "doing")).toContain(archived.id);
    expect(taskIds(container.store.getState().board, "todo")).toContain(active.id);
  });
});
