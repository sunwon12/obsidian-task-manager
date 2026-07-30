import { describe, it, expect } from "vitest";
import { createTaskMasterStore } from "../../src/store/taskMasterStore";
import { newId } from "../../src/core/ids";
import {
  SCHEMA_VERSION,
  type IsoDateTime, type Task, type TaskId, type DiagnosticEntry,
} from "../../src/core/types";

function makeTask(): Task {
  const id = newId("task") as TaskId;
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    type: "task",
    status: "todo",
    title: "샘플",
    project: null,
    priority: null,
    jiraKey: null,
    remarks: null,
    createdAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
    updatedAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
    archivedAt: null,
    passthrough: {},
    fieldOrder: [],
    knownMtime: 0,
    path: "x.md",
  };
}

describe("taskMasterStore", () => {
  it("upserts task into Map", () => {
    const store = createTaskMasterStore();
    const t = makeTask();
    store.getState().upsertTask(t);
    expect(store.getState().tasks.get(t.id)).toEqual(t);
  });

  it("removeTask deletes from Map", () => {
    const store = createTaskMasterStore();
    const t = makeTask();
    store.getState().upsertTask(t);
    store.getState().removeTask(t.id);
    expect(store.getState().tasks.has(t.id)).toBe(false);
  });

  it("removeTask is a no-op when id missing (referential equality)", () => {
    const store = createTaskMasterStore();
    const before = store.getState().tasks;
    store.getState().removeTask("task_missing" as TaskId);
    const after = store.getState().tasks;
    expect(after).toBe(before);
  });

  it("setTasks replaces entire Map", () => {
    const store = createTaskMasterStore();
    const t1 = makeTask();
    const t2 = makeTask();
    store.getState().setTasks([t1, t2]);
    expect(store.getState().tasks.size).toBe(2);
  });

  it("recordDiagnostic prepends and caps at 50", () => {
    const store = createTaskMasterStore();
    for (let i = 0; i < 60; i++) {
      const entry: DiagnosticEntry = {
        ts: "2026-05-08T00:00:00.000Z" as IsoDateTime,
        kind: "parse",
        message: `n${i}`,
      };
      store.getState().recordDiagnostic(entry);
    }
    expect(store.getState().diagnostics.length).toBe(50);
    expect(store.getState().diagnostics[0]?.message).toBe("n59");
  });

  it("setProjectFilter, viewMode, and filters update state", () => {
    const store = createTaskMasterStore();
    store.getState().setProjectFilter("none");
    store.getState().setHideCompleted(true);
    store.getState().setViewMode("archive");
    store.getState().setSearchQuery("checkout");
    store.getState().setPriorityFilter("high");
    expect(store.getState().selectedProjectId).toBe("none");
    expect(store.getState().hideCompleted).toBe(true);
    expect(store.getState().viewMode).toBe("archive");
    expect(store.getState().searchQuery).toBe("checkout");
    expect(store.getState().priorityFilter).toBe("high");
  });

  it("bumpSettingsRevision increments settingsRevision", () => {
    const store = createTaskMasterStore();
    expect(store.getState().settingsRevision).toBe(0);
    store.getState().bumpSettingsRevision();
    expect(store.getState().settingsRevision).toBe(1);
  });

  it("reset returns to empty state", () => {
    const store = createTaskMasterStore();
    store.getState().upsertTask(makeTask());
    store.getState().reset();
    expect(store.getState().tasks.size).toBe(0);
  });
});
