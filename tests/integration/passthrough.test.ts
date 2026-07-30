// T-708, ADR-0008: 사용자가 frontmatter에 직접 추가한 field가
// TaskService를 통한 status 변경 후에도 보존되는지 검증.
//
// 시나리오: Dataview, Tag Wrangler 등이 사용하는 field가 우리 코드를 거쳐도 안 사라짐.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "obsidian";
import { TaskRepository } from "../../src/repositories/TaskRepository";
import { BoardRepository } from "../../src/repositories/BoardRepository";
import { BoardService } from "../../src/services/BoardService";
import { TaskService } from "../../src/services/TaskService";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { EventBus } from "../../src/core/eventBus";
import { createTaskMasterStore } from "../../src/store/taskMasterStore";
import { newId, ulidOf } from "../../src/core/ids";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("passthrough end-to-end", () => {
  it("preserves user-defined frontmatter fields across status change", async () => {
    const app = new App();
    const diag = new DiagnosticsLog();
    const events = new EventBus();
    const store = createTaskMasterStore();
    const taskRepo = new TaskRepository(app, diag, 500, "TaskMaster/Tasks", "TaskMaster/Archive");
    const boardRepo = new BoardRepository(app, diag, "TaskMaster/.board.json", 500);
    const boardSvc = new BoardService(boardRepo, store, events);
    const taskSvc = new TaskService(taskRepo, boardSvc, store, events);

    // 사용자가 직접 만든 task 파일을 시뮬레이션 (Dataview 호환 field 포함)
    const id = newId("task");
    const short = `task_${ulidOf(id).slice(0, 8)}`;
    const path = `TaskMaster/Tasks/user-made - ${short}.md`;
    const userRaw = `---
schemaVersion: 1
id: ${id}
type: task
status: todo
project: null
priority: null
createdAt: 2026-05-08T10:00:00.000Z
updatedAt: 2026-05-08T10:00:00.000Z
tags:
  - obsidian
  - kanban
aliases:
  - WSR
deadline: 2026-06-01
templater_inserted: true
---

# 사용자가 만든 task

본문
`;
    await app.vault.create(path, userRaw);
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      path,
      {
        type: "task", id, status: "todo", schemaVersion: 1,
        project: null, priority: null,
        createdAt: "2026-05-08T10:00:00.000Z",
        updatedAt: "2026-05-08T10:00:00.000Z",
        tags: ["obsidian", "kanban"],
        aliases: ["WSR"],
        deadline: "2026-06-01",
        templater_inserted: true,
      },
    );

    // findAll로 store에 인덱싱
    const tasks = await taskRepo.findAll();
    store.getState().setTasks(tasks);
    expect(store.getState().tasks.size).toBe(1);

    // status 변경 (TaskService 통과)
    const taskId = tasks[0]!.id;
    await taskSvc.moveTask(taskId, "doing");

    // 디스크에서 다시 읽어 사용자 field가 모두 보존되었는지 확인
    const file = app.vault.getAbstractFileByPath(path);
    const finalRaw = await app.vault.read(file as never);

    expect(finalRaw).toContain("status: doing"); // 우리 변경 적용됨
    expect(finalRaw).toContain("- obsidian"); // tags 보존
    expect(finalRaw).toContain("- kanban");
    expect(finalRaw).toContain("- WSR"); // aliases 보존
    expect(finalRaw).toContain("deadline: 2026-06-01"); // deadline 보존
    expect(finalRaw).toContain("templater_inserted: true"); // 다른 plugin field 보존

    // 본문도 유지
    expect(finalRaw).toContain("# 사용자가 만든 task");
    expect(finalRaw).toContain("본문");
  });

  it("preserves field order across multiple updates", async () => {
    const app = new App();
    const diag = new DiagnosticsLog();
    const events = new EventBus();
    const store = createTaskMasterStore();
    const taskRepo = new TaskRepository(app, diag, 500, "TaskMaster/Tasks", "TaskMaster/Archive");
    const boardSvc = new BoardService(
      new BoardRepository(app, diag, "TaskMaster/.board.json", 500),
      store, events,
    );
    const taskSvc = new TaskService(taskRepo, boardSvc, store, events);

    const id = newId("task");
    const short = `task_${ulidOf(id).slice(0, 8)}`;
    const path = `TaskMaster/Tasks/order - ${short}.md`;
    // unusual field order: passthrough가 사이에 끼어 있음
    await app.vault.create(path, `---
schemaVersion: 1
id: ${id}
tags:
  - first
type: task
status: todo
deadline: 2026-06-01
project: null
priority: null
createdAt: 2026-05-08T10:00:00.000Z
updatedAt: 2026-05-08T10:00:00.000Z
---

# task
`);
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      path,
      {
        schemaVersion: 1, id, type: "task", status: "todo", project: null, priority: null,
        createdAt: "2026-05-08T10:00:00.000Z", updatedAt: "2026-05-08T10:00:00.000Z",
        tags: ["first"], deadline: "2026-06-01",
      },
    );

    store.getState().setTasks(await taskRepo.findAll());
    const taskId = [...store.getState().tasks.values()][0]!.id;

    // 여러 번 update
    await taskSvc.moveTask(taskId, "doing");
    await taskSvc.updateTitle(taskId, "renamed");

    const file = app.vault.getAbstractFileByPath(path);
    const finalRaw = await app.vault.read(file as never);

    // tags가 schemaVersion/id 다음 등장 (원본 순서 보존)
    const idLine = finalRaw.indexOf("id:");
    const tagsLine = finalRaw.indexOf("tags:");
    const typeLine = finalRaw.indexOf("type:");
    expect(idLine).toBeGreaterThan(0);
    expect(tagsLine).toBeGreaterThan(idLine);
    expect(tagsLine).toBeLessThan(typeLine); // 원래 순서대로
  });
});
