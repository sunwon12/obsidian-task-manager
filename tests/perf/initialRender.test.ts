// PRD §10.2, §12.2: 1000개 task 기준 보드 초기 렌더링 1초 이내.
// node 환경에서 in-memory mock으로 측정하므로 절대값은 실제 Obsidian보다 빠르다.
// 여기서 검증하는 건 "알고리즘 복잡도가 N이지 N²이 아님"과 회귀 방지.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "obsidian";
import { TaskRepository } from "../../src/repositories/TaskRepository";
import { BoardRepository } from "../../src/repositories/BoardRepository";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { newId, ulidOf } from "../../src/core/ids";

const TASKS = "TaskMaster/Tasks";
const ARCHIVE = "TaskMaster/Archive";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function seed(app: App, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const id = newId("task");
    const status = (i % 3 === 0) ? "todo" : (i % 3 === 1) ? "doing" : "done";
    const short = `task_${ulidOf(id).slice(0, 8)}`;
    const path = `${TASKS}/seed${i} - ${short}.md`;
    await app.vault.create(
      path,
      `---
schemaVersion: 1
id: ${id}
type: task
status: ${status}
project: null
priority: null
createdAt: 2026-05-08T10:00:00.000Z
updatedAt: 2026-05-08T10:00:00.000Z
---

# Task ${i}

content
`,
    );
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      path,
      { type: "task", id, status, schemaVersion: 1, project: null, priority: null,
        createdAt: "2026-05-08T10:00:00.000Z", updatedAt: "2026-05-08T10:00:00.000Z" },
    );
  }
}

describe("perf: 1000 task initial render", () => {
  it("findAll + rebuildFromTasks 가 합리적 시간 안에 끝난다", { timeout: 10_000 }, async () => {
    const app = new App();
    await seed(app, 1000);

    const taskRepo = new TaskRepository(app, new DiagnosticsLog(), 500, TASKS, ARCHIVE);
    const boardRepo = new BoardRepository(app, new DiagnosticsLog(), "TaskMaster/.board.json", 500);

    const start = performance.now();
    const tasks = await taskRepo.findAll();
    const board = boardRepo.rebuildFromTasks(tasks);
    const elapsed = performance.now() - start;

    expect(tasks).toHaveLength(1000);
    expect(board.columns.flatMap((c) => c.taskIds)).toHaveLength(1000);

    // 회귀 방지 임계: in-memory mock에서 1000개가 1초 이상이면 알고리즘 의심.
    // 실제 Obsidian은 metadataCache가 더 빠르므로 더 빠를 것.
    expect(elapsed).toBeLessThan(1000);
    console.log(`[perf] 1000-task scan + rebuild: ${elapsed.toFixed(1)}ms`);
  });

  it("reconcile 1000개 task가 100ms 이내", () => {
    const app = new App();
    const repo = new BoardRepository(app, new DiagnosticsLog(), "TaskMaster/.board.json", 500);
    const tasks = Array.from({ length: 1000 }, (_, i) => ({
      schemaVersion: 1 as const,
      id: newId("task") as never,
      type: "task" as const,
      status: i % 3 === 0 ? "todo" : i % 3 === 1 ? "doing" : "done" as never,
      title: `t${i}`,
      project: null,
      priority: null,
      createdAt: "2026-05-08T10:00:00.000Z" as never,
      updatedAt: "2026-05-08T10:00:00.000Z" as never,
      archivedAt: null,
      passthrough: {},
      fieldOrder: [],
      knownMtime: 0,
      path: `x${i}.md`,
    }));
    const board = repo.rebuildFromTasks(tasks as never);

    const start = performance.now();
    const reconciled = repo.reconcile(board, tasks as never);
    const elapsed = performance.now() - start;

    expect(reconciled.columns.flatMap((c) => c.taskIds)).toHaveLength(1000);
    expect(elapsed).toBeLessThan(100);
    console.log(`[perf] 1000-task reconcile: ${elapsed.toFixed(1)}ms`);
  });
});
