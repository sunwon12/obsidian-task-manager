import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { createTaskMasterStore } from "../../src/store/taskMasterStore";
import { ProjectRepository } from "../../src/repositories/ProjectRepository";
import { ProjectService } from "../../src/services/ProjectService";
import {
  ProjectMemoService,
  __test_appendQuickMemo,
  __test_findQuickMemo,
  __test_listQuickMemos,
  __test_markMemoTaskLinked,
  type ProjectMemoBlockId,
} from "../../src/services/ProjectMemoService";

const FOLDER = "TaskMaster/Projects";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 4, 11, 9, 30));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ProjectMemoService", () => {
  it("appends a quick memo under today's Quick Notes heading", async () => {
    const app = new App();
    const store = createTaskMasterStore();
    const repo = new ProjectRepository(app, new DiagnosticsLog(), FOLDER);
    const projectService = new ProjectService(repo, store);
    const memoService = new ProjectMemoService(repo, store);
    const project = await projectService.createProject({ title: "Checkout" });

    vi.setSystemTime(new Date(2026, 4, 11, 9, 31));
    const memo = await memoService.appendMemo(project.id, "Check payment exception flow");

    const file = app.vault.getAbstractFileByPath(project.path);
    expect(file).toBeInstanceOf(TFile);
    const raw = await app.vault.read(file as TFile);
    expect(raw).toContain("## Quick Notes");
    expect(raw).toContain("### 2026-05-11");
    expect(raw).toContain("- 09:31 Check payment exception flow");
    expect(raw).toContain(`^${memo?.id}`);
    expect(memo?.id).toMatch(/^tm-memo-[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(store.getState().projects.get(project.id)?.updatedAt).not.toBe(project.updatedAt);
  });

  it("finds an appended memo by its Obsidian block id", async () => {
    const app = new App();
    const store = createTaskMasterStore();
    const repo = new ProjectRepository(app, new DiagnosticsLog(), FOLDER);
    const projectService = new ProjectService(repo, store);
    const memoService = new ProjectMemoService(repo, store);
    const project = await projectService.createProject({ title: "Checkout" });

    const memo = await memoService.appendMemo(
      project.id,
      "First line\nSecond line",
    );

    expect(memo).not.toBeNull();
    const found = await memoService.findMemo(project.id, memo!.id);
    expect(found).toEqual({
      id: memo!.id,
      date: "2026-05-11",
      time: "09:30",
      text: "First line\nSecond line",
    });
  });

  it("creates Quick Notes and date headings when missing", () => {
    const out = __test_appendQuickMemo("## Goal\n\nShip it\n", "memo", new Date(2026, 4, 11, 9, 30));
    expect(out).toContain("## Quick Notes");
    expect(out).toContain("### 2026-05-11");
    expect(out).toContain("- 09:30 memo");
  });

  it("preserves multiline memo text as an indented bullet continuation", () => {
    const out = __test_appendQuickMemo(
      "## Quick Notes\n",
      "first line\nsecond line",
      new Date(2026, 4, 11, 9, 30),
    );
    expect(out).toMatch(/- 09:30 first line \^tm-memo-[0-9A-HJKMNP-TV-Z]{26}\n  second line/u);
  });

  it("parses memo identity without treating the marker as memo text", () => {
    const id = "tm-memo-01HZA7YB9WV2G5X9FJ8M3N4P6Q" as ProjectMemoBlockId;
    const found = __test_findQuickMemo(
      [
        "## Quick Notes",
        "",
        "### 2026-05-11",
        "",
        `- 10:05 Ship checkout fixes ^${id}`,
        "  follow up with QA",
        "  Task: [[Ship checkout fixes - task_01HZA7YB]]",
        "  Promoted: [[Ship checkout fixes - memo_01HZA7YB]]",
      ].join("\n"),
      id,
    );

    expect(found).toEqual({
      id,
      date: "2026-05-11",
      time: "10:05",
      text: "Ship checkout fixes\nfollow up with QA",
    });
  });

  it("links a created task from the source memo", async () => {
    const app = new App();
    const store = createTaskMasterStore();
    const repo = new ProjectRepository(app, new DiagnosticsLog(), FOLDER);
    const projectService = new ProjectService(repo, store);
    const memoService = new ProjectMemoService(repo, store);
    const project = await projectService.createProject({ title: "Checkout" });
    const memo = await memoService.appendMemo(project.id, "Turn this into a task");

    await memoService.linkMemoToTask(
      project.id,
      memo!.id,
      "TaskMaster/Tasks/Turn this into a task - task_01HZA7YB.md",
    );

    const raw = await app.vault.read(app.vault.getAbstractFileByPath(project.path) as TFile);
    expect(raw).toContain("Turn this into a task");
    expect(raw).toContain("Task: [[Turn this into a task - task_01HZA7YB]]");
  });

  it("does not duplicate existing task links on a memo", () => {
    const id = "tm-memo-01HZA7YB9WV2G5X9FJ8M3N4P6Q" as ProjectMemoBlockId;
    const body = [
      "## Quick Notes",
      "",
      "### 2026-05-11",
      "",
      `- 10:05 Follow up ^${id}`,
      "  Task: [[Follow up - task_01HZA7YB]]",
    ].join("\n");

    const out = __test_markMemoTaskLinked(body, id, "[[Follow up - task_01HZA7YB]]");

    expect(out.match(/Task: \[\[Follow up - task_01HZA7YB\]\]/gu)).toHaveLength(1);
  });

  it("lists recent quick memos newest first", () => {
    const one = "tm-memo-01HZA7YB9WV2G5X9FJ8M3N4P6Q";
    const two = "tm-memo-01HZA7YB9WV2G5X9FJ8M3N4P6R";
    const three = "tm-memo-01HZA7YB9WV2G5X9FJ8M3N4P6S";
    const recent = __test_listQuickMemos(
      [
        "## Quick Notes",
        "",
        "### 2026-05-10",
        "",
        `- 09:00 older ^${one}`,
        "",
        "### 2026-05-11",
        "",
        `- 10:00 middle ^${two}`,
        "",
        `- 11:00 newest ^${three}`,
      ].join("\n"),
      2,
    );

    expect(recent.map((memo) => memo.text)).toEqual(["newest", "middle"]);
  });

  it("serializes concurrent appends for the same project", async () => {
    const app = new App();
    const store = createTaskMasterStore();
    const repo = new ProjectRepository(app, new DiagnosticsLog(), FOLDER);
    const projectService = new ProjectService(repo, store);
    const memoService = new ProjectMemoService(repo, store);
    const project = await projectService.createProject({ title: "Checkout" });

    await Promise.all([
      memoService.appendMemo(project.id, "first concurrent memo"),
      memoService.appendMemo(project.id, "second concurrent memo"),
    ]);

    const raw = await app.vault.read(app.vault.getAbstractFileByPath(project.path) as TFile);
    expect(raw).toContain("first concurrent memo");
    expect(raw).toContain("second concurrent memo");
    expect(raw.match(/\^tm-memo-[0-9A-HJKMNP-TV-Z]{26}/gu)).toHaveLength(2);
  });

  it("promotes a quick memo to a standalone note and links it from the source memo", async () => {
    const app = new App();
    const store = createTaskMasterStore();
    const repo = new ProjectRepository(app, new DiagnosticsLog(), FOLDER);
    const projectService = new ProjectService(repo, store);
    const memoService = new ProjectMemoService(repo, store);
    const project = await projectService.createProject({ title: "Checkout" });
    const memo = await memoService.appendMemo(project.id, "Promote this memo\nwith context");

    const result = await memoService.promoteMemoToNote(project.id, memo!.id);

    expect(result.path).toMatch(/^TaskMaster\/ProjectMemos\/Promote this memo - memo_/u);
    const note = app.vault.getAbstractFileByPath(result.path);
    expect(note).toBeInstanceOf(TFile);
    const noteRaw = await app.vault.read(note as TFile);
    expect(noteRaw).toContain("# Promote this memo");
    expect(noteRaw).toContain("Project: [[Checkout - project_");
    expect(noteRaw).toContain(`Source memo: [[Checkout - project_`);
    expect(noteRaw).toContain(`#^${memo!.id}]]`);
    expect(noteRaw).toContain("with context");

    const projectRaw = await app.vault.read(app.vault.getAbstractFileByPath(project.path) as TFile);
    expect(projectRaw).toContain("Promote this memo");
    expect(projectRaw).toContain("Promoted: [[Promote this memo - memo_");
  });

  it("ignores blank memos", async () => {
    const app = new App();
    const store = createTaskMasterStore();
    const repo = new ProjectRepository(app, new DiagnosticsLog(), FOLDER);
    const projectService = new ProjectService(repo, store);
    const memoService = new ProjectMemoService(repo, store);
    const project = await projectService.createProject({ title: "Checkout" });
    const before = await app.vault.read(app.vault.getAbstractFileByPath(project.path) as TFile);

    const memo = await memoService.appendMemo(project.id, "   ");

    const after = await app.vault.read(app.vault.getAbstractFileByPath(project.path) as TFile);
    expect(memo).toBeNull();
    expect(after).toBe(before);
  });
});
