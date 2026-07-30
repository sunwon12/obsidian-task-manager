import { describe, it, expect } from "vitest";
import { __test_filterColumn } from "../../src/store/selectors";
import { newId } from "../../src/core/ids";
import { SCHEMA_VERSION, type IsoDateTime, type Task, type TaskId, type ProjectId, type BoardColumn } from "../../src/core/types";

function makeTask(overrides: Partial<Task> = {}): Task {
  const id = newId("task") as TaskId;
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    type: "task",
    status: "todo",
    title: "x",
    project: null,
    priority: null,
    jiraKey: null,
    remarks: null,
    createdAt: "x" as IsoDateTime,
    updatedAt: "x" as IsoDateTime,
    archivedAt: null,
    passthrough: {},
    fieldOrder: [],
    knownMtime: 0,
    path: "x.md",
    ...overrides,
  };
}

describe("filterColumn", () => {
  const projectA = newId("project") as ProjectId;
  const t1 = makeTask({ project: projectA });
  const t2 = makeTask({ project: null });
  const t3 = makeTask({ project: null });
  const tasks = new Map<TaskId, Task>([
    [t1.id, t1], [t2.id, t2], [t3.id, t3],
  ]);
  const todoColumn: BoardColumn = {
    id: "todo", title: "Todo", taskIds: [t1.id, t2.id, t3.id],
  };
  const doneColumn: BoardColumn = {
    id: "done", title: "Done", taskIds: [t1.id, t2.id],
  };

  it("returns all when filter is 'all'", () => {
    const out = __test_filterColumn(todoColumn, tasks, "all", false);
    expect(out.taskIds).toEqual([t1.id, t2.id, t3.id]);
  });

  it("filters to project ID", () => {
    const out = __test_filterColumn(todoColumn, tasks, projectA, false);
    expect(out.taskIds).toEqual([t1.id]);
  });

  it("filters to no-project tasks", () => {
    const out = __test_filterColumn(todoColumn, tasks, "none", false);
    expect(out.taskIds).toEqual([t2.id, t3.id]);
  });

  it("hides done column when hideCompleted is true", () => {
    const out = __test_filterColumn(doneColumn, tasks, "all", true);
    expect(out.taskIds).toEqual([]);
  });

  it("does not hide non-done columns even when hideCompleted is true", () => {
    const out = __test_filterColumn(todoColumn, tasks, "all", true);
    expect(out.taskIds.length).toBe(3);
  });

  it("filters by priority", () => {
    const high = makeTask({ priority: "high" });
    const low = makeTask({ priority: "low" });
    const map = new Map<TaskId, Task>([[high.id, high], [low.id, low]]);
    const column: BoardColumn = { id: "todo", title: "Todo", taskIds: [high.id, low.id] };
    const out = __test_filterColumn(column, map, "all", false, "", "high");
    expect(out.taskIds).toEqual([high.id]);
  });

  it("searches title, body summary, jira key, and remarks", () => {
    const byTitle = makeTask({ title: "Checkout renewal" });
    const byBody = makeTask({ title: "Other", bodySummary: "payment exception details" });
    const byJira = makeTask({ title: "Other", jiraKey: "M29CEF-3126" });
    const byRemarks = makeTask({ title: "Other", remarks: "blocked by vendor" });
    const miss = makeTask({ title: "Inventory" });
    const map = new Map<TaskId, Task>([
      [byTitle.id, byTitle],
      [byBody.id, byBody],
      [byJira.id, byJira],
      [byRemarks.id, byRemarks],
      [miss.id, miss],
    ]);
    const column: BoardColumn = {
      id: "todo",
      title: "Todo",
      taskIds: [byTitle.id, byBody.id, byJira.id, byRemarks.id, miss.id],
    };

    expect(__test_filterColumn(column, map, "all", false, "renewal").taskIds).toEqual([byTitle.id]);
    expect(__test_filterColumn(column, map, "all", false, "exception").taskIds).toEqual([byBody.id]);
    expect(__test_filterColumn(column, map, "all", false, "m29cef").taskIds).toEqual([byJira.id]);
    expect(__test_filterColumn(column, map, "all", false, "vendor").taskIds).toEqual([byRemarks.id]);
  });
});
