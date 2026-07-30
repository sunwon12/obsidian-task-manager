import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, fireEvent, act, within } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { App as ObsidianApp } from "obsidian";
import { KanbanCard } from "../../../src/ui/kanban/KanbanCard";
import { TaskMasterProvider } from "../../../src/app/providers/TaskMasterProvider";
import { createTaskMasterStore } from "../../../src/store/taskMasterStore";
import { EventBus } from "../../../src/core/eventBus";
import { DiagnosticsLog } from "../../../src/core/diagnostics";
import {
  TaskRepository, BoardRepository, MeetingRepository, ProjectRepository,
} from "../../../src/repositories";
import {
  BoardService, MeetingService, ProjectMemoService, ProjectService, TaskService,
} from "../../../src/services";
import {
  DEFAULT_SETTINGS,
  type BoardState,
  type ColumnId,
  type ProjectId,
  type TaskId,
} from "../../../src/core/types";
import type { ServiceContainer } from "../../../src/main";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function setup() {
  const app = new ObsidianApp();
  const events = new EventBus();
  const diagnostics = new DiagnosticsLog();
  const store = createTaskMasterStore();
  const taskRepo = new TaskRepository(app, diagnostics, 500, "TaskMaster/Tasks", "TaskMaster/Archive");
  const boardRepo = new BoardRepository(app, diagnostics, "TaskMaster/.board.json", 500);
  const boardService = new BoardService(boardRepo, store, events);
  const taskService = new TaskService(taskRepo, boardService, store, events);
  const projectRepo = new ProjectRepository(app, diagnostics, "TaskMaster/Projects");
  const projectService = new ProjectService(projectRepo, store);
  const meetingService = new MeetingService(new MeetingRepository(app, diagnostics, "TaskMaster/Meetings"), store);

  const container: ServiceContainer = {
    store, taskService, boardService, projectService,
    projectMemoService: new ProjectMemoService(projectRepo, store),
    meetingService,
    events, diagnostics,
    settings: { ...DEFAULT_SETTINGS, confirmOnDelete: false },
    saveSettings: async () => {},
  };

  // Create a real task in the store so KanbanCard can render.
  const task = await taskService.createTask({ title: "테스트", status: "todo", priority: "high" });

  function wrap(node: React.ReactNode, items: TaskId[] = [task.id]): React.ReactElement {
    return (
      <TaskMasterProvider container={container} app={app}>
        <DndContext>
          <SortableContext items={items}>
            {node}
          </SortableContext>
        </DndContext>
      </TaskMasterProvider>
    );
  }

  return { container, taskService, app, task, wrap };
}

function taskIds(board: BoardState, id: ColumnId): TaskId[] {
  return board.columns.find((c) => c.id === id)?.taskIds ?? [];
}

describe("KanbanCard", () => {
  it("renders title and aria-label", async () => {
    const { task, wrap } = await setup();
    const { getByText, getByLabelText } = render(wrap(<KanbanCard taskId={task.id} />));
    expect(getByText("테스트")).toBeTruthy();
    expect(getByLabelText(/테스트.*priority high/i)).toBeTruthy();
  });

  it("does not render body summary as a card preview", async () => {
    const { taskService, wrap } = await setup();
    const task = await taskService.createTask({
      title: "summary task",
      body: "First paragraph summary\n\nSecond paragraph",
    });
    const { queryByText } = render(wrap(<KanbanCard taskId={task.id} />, [task.id]));
    expect(queryByText("First paragraph summary")).toBeNull();
  });

  it("renders remarks when available", async () => {
    const { taskService, wrap } = await setup();
    const task = await taskService.createTask({
      title: "remarks task",
      body: "Markdown **body** should stay hidden",
      remarks: "리뷰 전에 QA 확인",
    });
    const { getByText, queryByText } = render(wrap(<KanbanCard taskId={task.id} />, [task.id]));
    expect(getByText("리뷰 전에 QA 확인")).toBeTruthy();
    expect(queryByText("Markdown **body** should stay hidden")).toBeNull();
  });

  it("Cmd+Enter moves to next status", async () => {
    const { task, taskService, wrap } = await setup();
    const moveSpy = vi.spyOn(taskService, "moveTask");
    const { getByLabelText } = render(wrap(<KanbanCard taskId={task.id} />));
    const card = getByLabelText(/테스트/);
    await act(async () => {
      fireEvent.keyDown(card, { key: "Enter", metaKey: true });
    });
    expect(moveSpy).toHaveBeenCalledWith(task.id, "doing");
  });

  it("Cmd+Shift+Enter moves to previous status", async () => {
    const { task, taskService, wrap } = await setup();
    const moveSpy = vi.spyOn(taskService, "moveTask");
    const { getByLabelText } = render(wrap(<KanbanCard taskId={task.id} />));
    const card = getByLabelText(/테스트/);
    await act(async () => {
      fireEvent.keyDown(card, { key: "Enter", metaKey: true, shiftKey: true });
    });
    expect(moveSpy).toHaveBeenCalledWith(task.id, "hold");
  });

  it("Cmd+Shift+Enter is a no-op at hold", async () => {
    const { taskService, wrap } = await setup();
    const task = await taskService.createTask({ title: "held", status: "hold" });
    const moveSpy = vi.spyOn(taskService, "moveTask");
    const { getByLabelText } = render(wrap(<KanbanCard taskId={task.id} />, [task.id]));
    await act(async () => {
      fireEvent.keyDown(getByLabelText(/held/), { key: "Enter", metaKey: true, shiftKey: true });
    });
    expect(moveSpy).not.toHaveBeenCalled();
  });

  it("Cmd+E archives", async () => {
    const { task, taskService, wrap } = await setup();
    const archiveSpy = vi.spyOn(taskService, "archiveTask").mockResolvedValue(undefined);
    const { getByLabelText } = render(wrap(<KanbanCard taskId={task.id} />));
    const card = getByLabelText(/테스트/);
    await act(async () => {
      fireEvent.keyDown(card, { key: "e", metaKey: true });
    });
    expect(archiveSpy).toHaveBeenCalledWith(task.id);
  });

  it("Cmd+Backspace deletes (confirmOnDelete=false bypasses dialog)", async () => {
    const { task, taskService, wrap } = await setup();
    const deleteSpy = vi.spyOn(taskService, "deleteTask").mockResolvedValue(undefined);
    const { getByLabelText } = render(wrap(<KanbanCard taskId={task.id} />));
    const card = getByLabelText(/테스트/);
    await act(async () => {
      fireEvent.keyDown(card, { key: "Backspace", metaKey: true });
    });
    expect(deleteSpy).toHaveBeenCalledWith(task.id);
  });

  it("plain Enter opens the note (no error when file missing)", async () => {
    const { task, app, wrap } = await setup();
    const getLeafSpy = vi.spyOn(app.workspace, "getLeaf");
    const { getByLabelText } = render(wrap(<KanbanCard taskId={task.id} />));
    const card = getByLabelText(/테스트/);
    await act(async () => {
      fireEvent.keyDown(card, { key: "Enter" });
    });
    expect(getLeafSpy).toHaveBeenCalled();
  });

  it("renders a desktop action menu and keeps menu clicks from opening the card", async () => {
    const { task, app, taskService, wrap } = await setup();
    const getLeafSpy = vi.spyOn(app.workspace, "getLeaf");
    const archiveSpy = vi.spyOn(taskService, "archiveTask").mockResolvedValue(undefined);
    const { getByLabelText, getByText, queryByRole } = render(wrap(<KanbanCard taskId={task.id} />));
    fireEvent.click(getByLabelText(/더 보기|more/i));
    fireEvent.click(getByText(/보관|archive/i));
    expect(archiveSpy).toHaveBeenCalledWith(task.id);
    expect(getLeafSpy).not.toHaveBeenCalled();
    expect(queryByRole("menu")).toBeNull();
  });

  it("dismisses the desktop action menu on outside click and Escape", async () => {
    const { task, wrap } = await setup();
    const { getByLabelText, getByRole, queryByRole } = render(wrap(<KanbanCard taskId={task.id} />));

    fireEvent.click(getByLabelText(/더 보기|more/i));
    expect(getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(queryByRole("menu")).toBeNull();

    fireEvent.click(getByLabelText(/더 보기|more/i));
    expect(getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(queryByRole("menu")).toBeNull();
  });

  it("moves status from the desktop action menu", async () => {
    const { task, container, wrap } = await setup();
    const { getByLabelText } = render(wrap(<KanbanCard taskId={task.id} />));
    fireEvent.click(getByLabelText(/더 보기|more/i));
    await act(async () => {
      fireEvent.click(getByLabelText(/Move to IN REVIEW|IN REVIEW로 이동/i));
    });
    expect(container.store.getState().tasks.get(task.id)?.status).toBe("in-review");
    expect(taskIds(container.store.getState().board, "in-review")).toContain(task.id);
  });

  it("edits remarks inline without opening the note", async () => {
    const { task, app, container, wrap } = await setup();
    const getLeafSpy = vi.spyOn(app.workspace, "getLeaf");
    const { getByLabelText, getByPlaceholderText, getByText } = render(wrap(<KanbanCard taskId={task.id} />));
    fireEvent.click(getByLabelText(/더 보기|more/i));
    fireEvent.click(getByText(/비고 추가|Add remarks/i));

    const input = getByPlaceholderText(/^비고$|^Remarks$/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: "inline note" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(container.store.getState().tasks.get(task.id)?.remarks).toBe("inline note");
    expect(getLeafSpy).not.toHaveBeenCalled();
  });

  it("edits title, priority, and project from the desktop menu", async () => {
    const { task, app, container, wrap } = await setup();
    const project = await container.projectService.createProject({ title: "Checkout" });
    const { getByLabelText, getByText, getByRole } = render(wrap(<KanbanCard taskId={task.id} />));
    fireEvent.click(getByLabelText(/더 보기|more/i));
    fireEvent.click(getByText(/편집|edit/i));
    const dialog = within(getByRole("dialog", { name: /할 일 편집|edit task/i }));

    await act(async () => {
      fireEvent.change(dialog.getByLabelText(/제목|title/i), { target: { value: "updated title" } });
      fireEvent.change(dialog.getByLabelText(/우선순위|priority/i), { target: { value: "medium" } });
      fireEvent.change(dialog.getByLabelText(/프로젝트|project/i), { target: { value: project.id } });
      fireEvent.click(dialog.getByText(/^저장$|^Save$/i));
    });

    const updated = container.store.getState().tasks.get(task.id);
    expect(updated?.title).toBe("updated title");
    expect(updated?.priority).toBe("medium");
    expect(updated?.project).toBe(project.id);
    const raw = await app.vault.read(app.vault.getAbstractFileByPath(task.path) as never);
    expect(raw).toContain("# updated title");
    expect(raw).toContain(`project: ${project.id}`);
    expect(raw).toContain("priority: medium");
  });

  it("Cmd+ArrowUp reorders within the visible filtered column while preserving hidden cards", async () => {
    const { task: hiddenTop, taskService, container, wrap } = await setup();
    const projectA = "project_01HX7SM2J6K4XQ7EV6C8T92PPW" as ProjectId;
    const visibleFirst = await taskService.createTask({ title: "visible first", project: projectA });
    const hiddenMiddle = await taskService.createTask({ title: "hidden middle", project: null });
    const visibleSecond = await taskService.createTask({ title: "visible second", project: projectA });
    const hiddenBottom = await taskService.createTask({ title: "hidden bottom", project: null });
    container.store.getState().setProjectFilter(projectA);

    const { getByLabelText } = render(
      wrap(<KanbanCard taskId={visibleSecond.id} />, [visibleFirst.id, visibleSecond.id]),
    );
    await act(async () => {
      fireEvent.keyDown(getByLabelText(/visible second/), { key: "ArrowUp", metaKey: true });
    });

    expect(taskIds(container.store.getState().board, "todo")).toEqual([
      hiddenTop.id,
      visibleSecond.id,
      hiddenMiddle.id,
      visibleFirst.id,
      hiddenBottom.id,
    ]);
  });

  it("returns null when task is missing from store", async () => {
    const { wrap } = await setup();
    const { container } = render(wrap(<KanbanCard taskId={"task_unknown" as TaskId} />));
    expect(container.querySelector("li")).toBeNull();
  });
});
