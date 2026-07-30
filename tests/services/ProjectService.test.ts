import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, TFile } from "obsidian";
import { ProjectService } from "../../src/services/ProjectService";
import { ProjectRepository } from "../../src/repositories/ProjectRepository";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { createTaskMasterStore } from "../../src/store/taskMasterStore";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("ProjectService", () => {
  it("creates a project file and updates store", async () => {
    const app = new App();
    const store = createTaskMasterStore();
    const repo = new ProjectRepository(app, new DiagnosticsLog(), "TaskMaster/Projects");
    const svc = new ProjectService(repo, store);
    const p = await svc.createProject({ title: "웹사이트 리뉴얼" });
    expect(store.getState().projects.get(p.id)).toBeDefined();
    expect(p.path).toContain("웹사이트 리뉴얼");
  });

  it("creates project notes with memo-friendly default sections", async () => {
    const app = new App();
    const store = createTaskMasterStore();
    const repo = new ProjectRepository(app, new DiagnosticsLog(), "TaskMaster/Projects");
    const svc = new ProjectService(repo, store);
    const p = await svc.createProject({ title: "Checkout" });
    const file = app.vault.getAbstractFileByPath(p.path);
    expect(file).toBeInstanceOf(TFile);
    const raw = await app.vault.read(file as TFile);
    expect(raw).toContain("# Checkout");
    expect(raw).toContain("## Goal");
    expect(raw).toContain("## Current Status");
    expect(raw).toContain("## Decisions");
    expect(raw).toContain("## References");
    expect(raw).toContain("## Quick Notes");
  });

  it("list returns projects sorted by title", async () => {
    const app = new App();
    const store = createTaskMasterStore();
    const repo = new ProjectRepository(app, new DiagnosticsLog(), "TaskMaster/Projects");
    const svc = new ProjectService(repo, store);
    await svc.createProject({ title: "B project" });
    await svc.createProject({ title: "A project" });
    const list = svc.list();
    expect(list.map((p) => p.title)).toEqual(["A project", "B project"]);
  });
});
