import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { App as ObsidianApp, TFile, type Plugin, type WorkspaceLeaf } from "obsidian";
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
import { ProjectContextHeader } from "../../../src/ui/kanban/ProjectContextHeader";
import { IndexService } from "../../../src/integration/IndexService";
import type { ServiceContainer } from "../../../src/main";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function build(): {
  app: ObsidianApp;
  container: ServiceContainer;
  indexService: IndexService;
} {
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
  const indexService = new IndexService(
    app,
    { registerEvent: vi.fn() } as unknown as Plugin,
    store,
    taskRepo,
    boardRepo,
    boardService,
    meetingRepo,
    projectRepo,
    events,
    diagnostics,
    "TaskMaster",
  );
  return { app, container, indexService };
}

function renderHeader(container: ServiceContainer, app: ObsidianApp) {
  return render(
    <TaskMasterProvider container={container} app={app}>
      <ProjectContextHeader />
    </TaskMasterProvider>,
  );
}

function expandMemo(view: ReturnType<typeof render>): void {
  fireEvent.click(view.getByText(/Show memo|메모 펼치기/));
}

describe("ProjectContextHeader", () => {
  it("is hidden when a real project is not selected", () => {
    const { app, container } = build();
    const { queryByLabelText } = renderHeader(container, app);
    expect(queryByLabelText(/Project memo|프로젝트 메모/)).toBeNull();
  });

  it("shows selected project title and keeps memo content collapsed by default", async () => {
    const { app, container } = build();
    const project = await container.projectService.createProject({ title: "Checkout" });
    container.store.getState().setProjectFilter(project.id);

    const view = renderHeader(container, app);

    expect(view.getByText("Checkout")).toBeTruthy();
    expect(view.getByText(/Open memo|메모 열기/)).toBeTruthy();
    expect(view.getByText(/New meeting|회의록 만들기/)).toBeTruthy();
    expect(view.getByText(/Show memo|메모 펼치기/)).toBeTruthy();
    expect(view.queryByLabelText(/Quick memo|빠른 메모/)).toBeNull();

    expandMemo(view);

    expect(view.getByText(/Hide memo|메모 접기/)).toBeTruthy();
    expect(view.getByLabelText(/Quick memo|빠른 메모/)).toBeTruthy();
  });

  it("creates and opens a project-linked meeting note", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 11, 10, 0));
    const { app, container } = build();
    const project = await container.projectService.createProject({ title: "Checkout" });
    container.store.getState().setProjectFilter(project.id);
    const openFile = vi.fn();
    vi.spyOn(app.workspace, "getLeaf").mockReturnValue({
      openFile,
    } as unknown as WorkspaceLeaf);
    const { getByText } = renderHeader(container, app);

    await act(async () => {
      fireEvent.click(getByText(/New meeting|회의록 만들기/));
    });

    const meeting = [...container.store.getState().meetings.values()][0];
    expect(meeting?.project).toBe(project.id);
    expect(meeting?.date).toBe("2026-05-11");
    const raw = await app.vault.read(app.vault.getAbstractFileByPath(meeting!.path) as TFile);
    expect(raw).toContain("Project: [[Checkout - project_");
    expect(raw).toContain("## Action Items");
    expect(openFile).toHaveBeenCalledWith(app.vault.getAbstractFileByPath(meeting!.path));
  });

  it("saves a quick memo with Cmd+Enter and clears the composer", async () => {
    const { app, container } = build();
    const project = await container.projectService.createProject({ title: "Checkout" });
    container.store.getState().setProjectFilter(project.id);
    const view = renderHeader(container, app);
    expandMemo(view);
    const input = view.getByLabelText(/Quick memo|빠른 메모/) as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Check renewal risk" } });
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    });

    const file = app.vault.getAbstractFileByPath(project.path);
    expect(file).toBeInstanceOf(TFile);
    const raw = await app.vault.read(file as TFile);
    expect(raw).toContain("Check renewal risk");
    expect(raw).toMatch(/\^tm-memo-[0-9A-HJKMNP-TV-Z]{26}/u);
    expect(input.value).toBe("");
    expect(view.getByText(/Saved|저장됨/)).toBeTruthy();
    expect(await view.findByText("Check renewal risk")).toBeTruthy();
  });

  it("saves a quick memo from the save button", async () => {
    const { app, container } = build();
    const project = await container.projectService.createProject({ title: "Checkout" });
    container.store.getState().setProjectFilter(project.id);
    const view = renderHeader(container, app);
    expandMemo(view);
    const input = view.getByLabelText(/Quick memo|빠른 메모/) as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Button save memo" } });
      fireEvent.click(view.getByText(/Save|저장/));
    });

    const raw = await app.vault.read(app.vault.getAbstractFileByPath(project.path) as TFile);
    expect(raw).toContain("Button save memo");
    expect(input.value).toBe("");
  });

  it("does not allow blank quick memos", async () => {
    const { app, container } = build();
    const project = await container.projectService.createProject({ title: "Checkout" });
    container.store.getState().setProjectFilter(project.id);
    const view = renderHeader(container, app);
    expandMemo(view);
    const rawBefore = await app.vault.read(app.vault.getAbstractFileByPath(project.path) as TFile);
    const button = view.getByText(/Save|저장/) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(button);
    });

    const rawAfter = await app.vault.read(app.vault.getAbstractFileByPath(project.path) as TFile);
    expect(rawAfter).toBe(rawBefore);
  });

  it("refreshes the memo preview after project note metadata changes", async () => {
    const { app, container, indexService } = build();
    const project = await container.projectService.createProject({ title: "Checkout" });
    container.store.getState().setProjectFilter(project.id);
    const view = renderHeader(container, app);
    expandMemo(view);
    const file = app.vault.getAbstractFileByPath(project.path) as TFile;
    const raw = await app.vault.read(file);
    await app.vault.modify(
      file,
      raw.replace(
        "## Quick Notes\n",
        "## Quick Notes\n\n### 2026-05-11\n\n- 12:00 External memo ^tm-memo-01HZA7YB9WV2G5X9FJ8M3N4P6T\n",
      ),
    );
    (app.metadataCache as unknown as { __set(path: string, fm: Record<string, unknown>): void }).__set(
      project.path,
      {
        schemaVersion: 1,
        id: project.id,
        type: "project",
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    );

    await act(async () => {
      await indexService.handleMetaChangedForTest(file);
    });

    expect(await view.findByText("External memo")).toBeTruthy();
  });

  it("creates a task from a quick memo without removing the memo", async () => {
    const { app, container } = build();
    const project = await container.projectService.createProject({ title: "Checkout" });
    container.store.getState().setProjectFilter(project.id);
    const view = renderHeader(container, app);
    expandMemo(view);
    const input = view.getByLabelText(/Quick memo|빠른 메모/) as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Convert this memo\nwith context" } });
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    });
    await view.findByText("Convert this memo with context");

    await act(async () => {
      fireEvent.click(await view.findByText(/Create task|할 일로 만들기/));
    });

    const tasks = [...container.store.getState().tasks.values()];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Convert this memo");
    expect(tasks[0]?.project).toBe(project.id);

    const taskRaw = await app.vault.read(app.vault.getAbstractFileByPath(tasks[0]!.path) as TFile);
    expect(taskRaw).toContain("Source memo: [[Checkout - project_");
    expect(taskRaw).toMatch(/#\^tm-memo-[0-9A-HJKMNP-TV-Z]{26}\]\]/u);
    expect(taskRaw).toContain("with context");

    const projectRaw = await app.vault.read(app.vault.getAbstractFileByPath(project.path) as TFile);
    expect(projectRaw).toContain("Convert this memo");
    expect(projectRaw).toContain("Task: [[Convert this memo - task_");
  });

  it("promotes a quick memo to a standalone note from preview actions", async () => {
    const { app, container } = build();
    const project = await container.projectService.createProject({ title: "Checkout" });
    container.store.getState().setProjectFilter(project.id);
    const view = renderHeader(container, app);
    expandMemo(view);
    const input = view.getByLabelText(/Quick memo|빠른 메모/) as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Promote from UI" } });
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    });
    await view.findByText("Promote from UI");

    await act(async () => {
      fireEvent.click(await view.findByText(/Promote note|노트로 승격/));
    });

    const promoted = app.vault
      .getMarkdownFiles()
      .find((file) => file.path.startsWith("TaskMaster/ProjectMemos/"));
    expect(promoted).toBeInstanceOf(TFile);
    expect(await app.vault.read(promoted as TFile)).toContain("Promote from UI");
    const projectRaw = await app.vault.read(app.vault.getAbstractFileByPath(project.path) as TFile);
    expect(projectRaw).toContain("Promoted: [[Promote from UI - memo_");
  });

  it("copies an Obsidian block link for a quick memo", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { app, container } = build();
    const project = await container.projectService.createProject({ title: "Checkout" });
    container.store.getState().setProjectFilter(project.id);
    const view = renderHeader(container, app);
    expandMemo(view);
    const input = view.getByLabelText(/Quick memo|빠른 메모/) as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "Copy this memo link" } });
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    });
    await view.findByText("Copy this memo link");

    await act(async () => {
      fireEvent.click(await view.findByText(/Copy link|링크 복사/));
    });

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^\[\[Checkout - project_[0-9A-HJKMNP-TV-Z]{8,26}#\^tm-memo-[0-9A-HJKMNP-TV-Z]{26}\]\]$/u),
    );
    expect(await view.findByText(/Copied|복사됨/)).toBeTruthy();
  });
});
