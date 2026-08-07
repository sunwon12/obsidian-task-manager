import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { act, fireEvent, render, within } from "@testing-library/react";
import { App as ObsidianApp } from "obsidian";
import { KanbanBoard } from "../../../src/ui/kanban/KanbanBoard";
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
import { DEFAULT_SETTINGS, type PluginSettings } from "../../../src/core/types";
import type { ServiceContainer } from "../../../src/main";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "(max-width: 767px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

function build(
  initialSettings: Partial<PluginSettings> = {},
): { app: ObsidianApp; container: ServiceContainer; saveSettings: ReturnType<typeof vi.fn> } {
  const app = new ObsidianApp();
  const store = createTaskMasterStore();
  const events = new EventBus();
  const diagnostics = new DiagnosticsLog();
  const boardRepo = new BoardRepository(app, diagnostics, "TaskMaster/.board.json", 500);
  const boardService = new BoardService(boardRepo, store, events);
  const taskRepo = new TaskRepository(app, diagnostics, 500, "TaskMaster/Tasks", "TaskMaster/Archive");
  const projectRepo = new ProjectRepository(app, diagnostics, "TaskMaster/Projects");
  const meetingRepo = new MeetingRepository(app, diagnostics, "TaskMaster/Meetings");
  const settings: PluginSettings = { ...DEFAULT_SETTINGS, ...initialSettings };
  const saveSettings = vi.fn(async (next: PluginSettings) => {
    Object.assign(settings, next);
    store.getState().bumpSettingsRevision();
  });
  const container: ServiceContainer = {
    store,
    taskService: new TaskService(taskRepo, boardService, store, events),
    boardService,
    projectService: new ProjectService(projectRepo, store),
    projectMemoService: new ProjectMemoService(projectRepo, store),
    meetingService: new MeetingService(meetingRepo, store),
    events,
    diagnostics,
    settings,
    saveSettings,
  };
  return { app, container, saveSettings };
}

function renderBoard(container: ServiceContainer, app: ObsidianApp) {
  return render(
    <TaskMasterProvider container={container} app={app}>
      <KanbanBoard />
    </TaskMasterProvider>,
  );
}

describe("KanbanBoard", () => {
  it("quick-adds a task into the target column status", async () => {
    const { app, container } = build();
    const view = renderBoard(container, app);
    fireEvent.click(view.getByRole("button", { name: /Add task to TODO|TODO에 할 일 추가/i }));
    const form = view.getByRole("form", { name: /Add task to TODO|TODO에 할 일 추가/i });
    const input = within(form).getByPlaceholderText(/New task|새 할 일/i);

    await act(async () => {
      fireEvent.change(input, { target: { value: "column task" } });
      fireEvent.click(within(form).getByText(/Add|추가/));
    });

    const task = [...container.store.getState().tasks.values()].find((t) => t.title === "column task");
    expect(task?.status).toBe("todo");
    const todo = container.store.getState().board.columns.find((c) => c.id === "todo");
    expect(todo?.taskIds).toContain(task?.id);
    expect(view.queryByRole("form", { name: /Add task to TODO|TODO에 할 일 추가/i })).toBeNull();
  });

  it("keeps column quick-add forms outside the task list and modal form", async () => {
    const { app, container } = build();
    const view = renderBoard(container, app);
    fireEvent.click(view.getByRole("button", { name: /Add task to TODO|TODO에 할 일 추가/i }));

    const todoList = view.container.querySelector('[data-column-id="todo"]');
    expect(todoList?.querySelector("form")).toBeNull();

    const quickAddForm = view.getByRole("form", { name: /Add task to TODO|TODO에 할 일 추가/i });
    fireEvent.click(within(quickAddForm).getByText(/Details|상세/i));
    expect(view.container.querySelector("form form")).toBeNull();
  });

  it("allows cancelling column quick-add even when the title is empty", () => {
    const { app, container } = build();
    const view = renderBoard(container, app);
    fireEvent.click(view.getByRole("button", { name: /Add task to TODO|TODO에 할 일 추가/i }));
    const form = view.getByRole("form", { name: /Add task to TODO|TODO에 할 일 추가/i });
    const cancel = within(form).getByText(/Cancel|취소/i);

    expect((cancel as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cancel);
    expect(view.queryByRole("form", { name: /Add task to TODO|TODO에 할 일 추가/i })).toBeNull();
  });

  it("hides status columns through rounded visibility chips", async () => {
    const { app, container, saveSettings } = build();
    const view = renderBoard(container, app);
    const todoChip = view.getByLabelText(/Hide TODO|TODO 숨기기/i);
    const todoStyle = todoChip.getAttribute("style") ?? "";
    const holdStyle = view.getByLabelText(/Hide HOLD|HOLD 숨기기/i).getAttribute("style") ?? "";

    expect(todoChip.className).toContain("tm-rounded-full");
    expect(todoChip.className).toContain("tm-border-solid");
    expect(todoStyle).toContain("box-shadow");
    expect(todoStyle).not.toEqual(holdStyle);

    await act(async () => {
      fireEvent.click(todoChip);
    });

    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      hiddenStatuses: ["todo"],
    }));
    expect(view.container.querySelector('[data-column-id="todo"]')).toBeNull();
    const hiddenTodoChip = view.getByLabelText(/Show TODO|TODO 보이기/i);
    expect(hiddenTodoChip.className).toContain("tm-border-dashed");
    expect(container.store.getState().board.columns.map((c) => c.id)).toEqual([
      "backlog",
      "hold",
      "todo",
      "doing",
      "in-review",
      "done",
    ]);
  });

  it("does not hide the last visible desktop status", async () => {
    const { app, container, saveSettings } = build({
      hiddenStatuses: ["backlog", "hold", "doing", "in-review", "done"],
    });
    const view = renderBoard(container, app);

    await act(async () => {
      fireEvent.click(view.getByLabelText(/Hide TODO|TODO 숨기기/i));
    });

    expect(saveSettings).not.toHaveBeenCalled();
    expect(view.container.querySelector('[data-column-id="todo"]')).toBeTruthy();
  });

  it("restores hidden status columns in their original order with tasks", async () => {
    const { app, container } = build();
    await act(async () => {
      await container.taskService.createTask({ title: "hidden todo task", status: "todo" });
    });
    const view = renderBoard(container, app);
    expect(view.getByText("hidden todo task")).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByLabelText(/Hide TODO|TODO 숨기기/i));
    });

    expect(view.queryByText("hidden todo task")).toBeNull();
    expect(view.container.querySelector('[data-column-id="todo"]')).toBeNull();

    await act(async () => {
      fireEvent.click(view.getByLabelText(/Show TODO|TODO 보이기/i));
    });

    const renderedColumns = Array.from(view.container.querySelectorAll("[data-column-id]"))
      .map((node) => node.getAttribute("data-column-id"));
    expect(renderedColumns).toEqual(["backlog", "hold", "todo", "doing", "in-review", "done"]);
    expect(view.getByText("hidden todo task")).toBeTruthy();
  });

  it("uses only visible statuses for mobile tabs and quick-add fallback", () => {
    Object.defineProperty(window, "innerWidth", { value: 500, writable: true });
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      media: "(max-width: 767px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { app, container } = build({ hiddenStatuses: ["todo"] });
    const view = renderBoard(container, app);

    expect(view.queryByRole("tab", { name: /TODO/i })).toBeNull();
    expect(view.getByRole("tab", { name: /DOING/i })).toBeTruthy();
    expect(view.getByRole("form", { name: /Add task to DOING|DOING에 할 일 추가/i })).toBeTruthy();
  });
});
