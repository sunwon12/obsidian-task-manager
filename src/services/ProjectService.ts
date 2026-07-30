// LLD §6.4: ProjectService.
// Phase 1은 createProject + list만 (HLD §8.3).

import type { ProjectRepository } from "../repositories/ProjectRepository";
import type { TaskMasterStore } from "../store/taskMasterStore";
import { newId } from "../core/ids";
import { nowIso } from "../core/time";
import { SCHEMA_VERSION } from "../core/types";
import type { CreateProjectInput, Project, ProjectId } from "../core/types";

export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly store: TaskMasterStore,
  ) {}

  async createProject(input: CreateProjectInput): Promise<Project> {
    const id = newId("project") as ProjectId;
    const draft: Project = {
      schemaVersion: SCHEMA_VERSION,
      id,
      type: "project",
      title: input.title.trim() || "Untitled",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      passthrough: {},
      fieldOrder: ["schemaVersion", "id", "type", "createdAt", "updatedAt"],
      knownMtime: 0,
      path: "",
    };
    const persisted = await this.projects.create(draft, defaultProjectBody());
    this.store.getState().upsertProject(persisted);
    return persisted;
  }

  /** Sorted by title. */
  list(): Project[] {
    return [...this.store.getState().projects.values()].sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }

  getProjectPath(id: ProjectId): string | null {
    return this.store.getState().projects.get(id)?.path ?? null;
  }
}

function defaultProjectBody(): string {
  return [
    "## Goal",
    "",
    "## Current Status",
    "",
    "## Decisions",
    "",
    "## References",
    "",
    "## Quick Notes",
    "",
  ].join("\n");
}
