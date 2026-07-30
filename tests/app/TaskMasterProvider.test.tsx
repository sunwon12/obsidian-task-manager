import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, render, act } from "@testing-library/react";
import { App as ObsidianApp } from "obsidian";
import {
  TaskMasterProvider, useServices, useStore,
} from "../../src/app/providers/TaskMasterProvider";
import { createTaskMasterStore } from "../../src/store/taskMasterStore";
import { EventBus } from "../../src/core/eventBus";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { TaskRepository, BoardRepository, MeetingRepository, ProjectRepository } from "../../src/repositories";
import {
  BoardService, MeetingService, ProjectMemoService, ProjectService, TaskService,
} from "../../src/services";
import { DEFAULT_SETTINGS } from "../../src/core/types";
import type { ServiceContainer } from "../../src/main";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function buildContainer(): { container: ServiceContainer; app: ObsidianApp } {
  const app = new ObsidianApp();
  const events = new EventBus();
  const diagnostics = new DiagnosticsLog();
  const store = createTaskMasterStore();
  const taskRepo = new TaskRepository(app, diagnostics, 500, "TaskMaster/Tasks", "TaskMaster/Archive");
  const boardRepo = new BoardRepository(app, diagnostics, "TaskMaster/.board.json", 500);
  const projectRepo = new ProjectRepository(app, diagnostics, "TaskMaster/Projects");
  const boardService = new BoardService(boardRepo, store, events);
  const container: ServiceContainer = {
    store,
    taskService: new TaskService(taskRepo, boardService, store, events),
    boardService,
    projectService: new ProjectService(projectRepo, store),
    projectMemoService: new ProjectMemoService(projectRepo, store),
    meetingService: new MeetingService(new MeetingRepository(app, diagnostics, "TaskMaster/Meetings"), store),
    events,
    diagnostics,
    settings: DEFAULT_SETTINGS,
    saveSettings: vi.fn(async () => {}),
  };
  return { container, app };
}

describe("TaskMasterProvider", () => {
  it("useServices returns the injected container", () => {
    const { container, app } = buildContainer();
    const { result } = renderHook(() => useServices(), {
      wrapper: ({ children }) => (
        <TaskMasterProvider container={container} app={app}>
          {children}
        </TaskMasterProvider>
      ),
    });
    expect(result.current.taskService).toBe(container.taskService);
    expect(result.current.projectMemoService).toBe(container.projectMemoService);
    expect(result.current.app).toBe(app);
  });

  it("useServices throws when used outside provider", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useServices())).toThrow();
    errSpy.mockRestore();
  });

  it("useStore subscribes to a slice", () => {
    const { container, app } = buildContainer();
    const { result } = renderHook(() => useStore((s) => s.tasks.size), {
      wrapper: ({ children }) => (
        <TaskMasterProvider container={container} app={app}>
          {children}
        </TaskMasterProvider>
      ),
    });
    expect(result.current).toBe(0);
  });

  it("useStore re-renders when subscribed slice changes", async () => {
    const { container, app } = buildContainer();
    const renderCount = vi.fn();
    const Probe: React.FC = () => {
      const size = useStore((s) => s.tasks.size);
      renderCount();
      return <div data-testid="size">{size}</div>;
    };
    const { findByTestId } = render(
      <TaskMasterProvider container={container} app={app}>
        <Probe />
      </TaskMasterProvider>,
    );
    expect((await findByTestId("size")).textContent).toBe("0");

    await act(async () => {
      await container.taskService.createTask({ title: "x" });
    });
    expect((await findByTestId("size")).textContent).toBe("1");
  });
});
