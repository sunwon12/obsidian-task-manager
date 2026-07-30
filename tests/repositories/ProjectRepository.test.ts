import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, TFile } from "obsidian";
import { ProjectRepository } from "../../src/repositories/ProjectRepository";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { newId } from "../../src/core/ids";
import { SCHEMA_VERSION, type Project, type ProjectId, type IsoDateTime } from "../../src/core/types";

const FOLDER = "TaskMaster/Projects";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function makeProject(id: string, overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id as ProjectId,
    type: "project",
    title: "프로젝트",
    createdAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
    updatedAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
    passthrough: {},
    fieldOrder: [],
    knownMtime: 0,
    path: "",
    ...overrides,
  };
}

describe("ProjectRepository", () => {
  it("creates a project file", async () => {
    const app = new App();
    const repo = new ProjectRepository(app, new DiagnosticsLog(), FOLDER);
    const id = newId("project");
    const p = makeProject(id, { title: "웹사이트 리뉴얼" });
    const persisted = await repo.create(p);
    expect(persisted.path.startsWith(`${FOLDER}/웹사이트 리뉴얼`)).toBe(true);
    expect(persisted.knownMtime).toBeGreaterThan(0);
  });

  it("findAll returns parsed projects", async () => {
    const app = new App();
    const repo = new ProjectRepository(app, new DiagnosticsLog(), FOLDER);
    const id = newId("project");
    await repo.create(makeProject(id));

    const path = repo.getKnownPath(id as ProjectId)!;
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      path,
      {
        type: "project", id, schemaVersion: 1,
        createdAt: "2026-05-08T10:00:00.000Z",
        updatedAt: "2026-05-08T10:00:00.000Z",
      },
    );
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(id);
  });

  it("writes a conflicted copy instead of overwriting stale project body", async () => {
    const app = new App();
    const diagnostics = new DiagnosticsLog();
    const repo = new ProjectRepository(app, diagnostics, FOLDER);
    const id = newId("project");
    const persisted = await repo.create(makeProject(id), "# 프로젝트\n\n## Quick Notes\n");
    const file = app.vault.getAbstractFileByPath(persisted.path) as TFile;
    await app.vault.modify(file, "# 프로젝트\n\nexternal edit\n");
    file.stat.mtime = persisted.knownMtime + 100;

    await repo.saveImmediate(
      { ...persisted, updatedAt: "2026-05-08T10:01:00.000Z" as IsoDateTime },
      "# 프로젝트\n\nlocal memo\n",
    );

    const original = await app.vault.read(file);
    expect(original).toContain("external edit");
    expect(original).not.toContain("local memo");

    const conflict = app.vault
      .getMarkdownFiles()
      .find((f) => f.path.includes("conflict"));
    expect(conflict).toBeInstanceOf(TFile);
    expect(await app.vault.read(conflict as TFile)).toContain("local memo");
    expect(diagnostics.list()[0]?.kind).toBe("conflict");
  });
});
