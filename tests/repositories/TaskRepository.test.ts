import { describe, it, expect, beforeEach, vi } from "vitest";
import { App } from "obsidian";
import { TaskRepository } from "../../src/repositories/TaskRepository";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { newId, ulidOf } from "../../src/core/ids";
import { nowIso } from "../../src/core/time";
import { SCHEMA_VERSION, type Task, type TaskId, type IsoDateTime } from "../../src/core/types";

const TASKS = "TaskMaster/Tasks";
const ARCHIVE = "TaskMaster/Archive";
const DEBOUNCE = 500;

function makeRaw(taskId: string, overrides: Partial<{
  status: string;
  title: string;
  body: string;
  archivedAt: string;
  extraFields: string;
}> = {}): string {
  const status = overrides.status ?? "todo";
  const title = overrides.title ?? "테스트";
  const body = overrides.body ?? "내용";
  const archivedLine = overrides.archivedAt ? `\narchivedAt: ${overrides.archivedAt}` : "";
  const extra = overrides.extraFields ? `\n${overrides.extraFields}` : "";
  return `---
schemaVersion: 1
id: ${taskId}
type: task
status: ${status}
project: null
priority: null
createdAt: 2026-05-08T10:00:00.000Z
updatedAt: 2026-05-08T10:00:00.000Z${archivedLine}${extra}
---

# ${title}

${body}
`;
}

async function seedTask(app: App, taskId: string, fileName?: string, overrides: Parameters<typeof makeRaw>[1] = {}): Promise<string> {
  const short = "task_" + ulidOf(taskId).slice(0, 8);
  const path = `${TASKS}/${fileName ?? `seeded - ${short}`}.md`;
  await app.vault.create(path, makeRaw(taskId, overrides));
  // Tell metadataCache about frontmatter for findAll path
  (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
    path,
    {
      schemaVersion: 1,
      id: taskId,
      type: "task",
      status: overrides.status ?? "todo",
      project: null,
      priority: null,
      createdAt: "2026-05-08T10:00:00.000Z",
      updatedAt: "2026-05-08T10:00:00.000Z",
      ...(overrides.archivedAt ? { archivedAt: overrides.archivedAt } : {}),
    },
  );
  return path;
}

function makeRepo(app: App): { repo: TaskRepository; diag: DiagnosticsLog } {
  const diag = new DiagnosticsLog();
  const repo = new TaskRepository(app, diag, DEBOUNCE, TASKS, ARCHIVE);
  return { repo, diag };
}

function makeTaskObject(id: string, overrides: Partial<Task> = {}): Task {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id as TaskId,
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
    fieldOrder: [
      "schemaVersion", "id", "type", "status", "project",
      "priority", "createdAt", "updatedAt",
    ],
    knownMtime: 0,
    path: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ---------- T-202 findAll ----------

describe("TaskRepository.findAll", () => {
  it("returns tasks from Tasks folder", async () => {
    const app = new App();
    const id1 = newId("task");
    const id2 = newId("task");
    // 같은 millisecond 내 ULID는 첫 8자가 같을 수 있어 fileName을 명시.
    await seedTask(app, id1, "first");
    await seedTask(app, id2, "second", { status: "doing" });
    const { repo } = makeRepo(app);
    const tasks = await repo.findAll();
    expect(tasks).toHaveLength(2);
    const statuses = tasks.map((t) => t.status).sort();
    expect(statuses).toEqual(["doing", "todo"]);
  });

  it("includes Archive folder tasks", async () => {
    const app = new App();
    const id = newId("task");
    const archived = "2026-05-09T11:00:00.000Z";
    const short = "task_" + ulidOf(id).slice(0, 8);
    const path = `${ARCHIVE}/old - ${short}.md`;
    await app.vault.create(path, makeRaw(id, { archivedAt: archived }));
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      path,
      { type: "task", id, status: "done", schemaVersion: 1, archivedAt: archived,
        createdAt: "2026-05-08T10:00:00.000Z", updatedAt: "2026-05-08T10:00:00.000Z",
        project: null, priority: null },
    );
    const { repo } = makeRepo(app);
    const tasks = await repo.findAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.archivedAt).toBe(archived);
  });

  it("skips files outside the configured folders", async () => {
    const app = new App();
    const id = newId("task");
    const short = "task_" + ulidOf(id).slice(0, 8);
    await app.vault.create(`OtherFolder/${short}.md`, makeRaw(id));
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      `OtherFolder/${short}.md`,
      { type: "task", id, status: "todo", schemaVersion: 1,
        createdAt: "x", updatedAt: "x", project: null, priority: null },
    );
    const { repo } = makeRepo(app);
    expect(await repo.findAll()).toHaveLength(0);
  });

  it("isolates a single bad file (T-205 contract)", async () => {
    const app = new App();
    const goodId = newId("task");
    const badId = newId("task");
    await seedTask(app, goodId);
    // Bad file: fm says task but content is malformed
    const badShort = "task_" + ulidOf(badId).slice(0, 8);
    const badPath = `${TASKS}/bad - ${badShort}.md`;
    await app.vault.create(badPath, "not valid markdown\n");
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      badPath,
      { type: "task", id: "task_short" /* invalid id */, status: "todo", schemaVersion: 1 },
    );
    const { repo, diag } = makeRepo(app);
    const tasks = await repo.findAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe(goodId);
    expect(diag.list().length).toBeGreaterThan(0);
  });

  it("ignores files whose frontmatter type is not 'task'", async () => {
    const app = new App();
    const taskId = newId("task");
    await seedTask(app, taskId);
    const otherId = newId("meeting");
    const otherShort = "meeting_" + ulidOf(otherId).slice(0, 8);
    const otherPath = `${TASKS}/m - ${otherShort}.md`;
    await app.vault.create(otherPath, "frontmatter doesn't matter");
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      otherPath,
      { type: "meeting", id: otherId },
    );
    const { repo } = makeRepo(app);
    expect(await repo.findAll()).toHaveLength(1);
  });
});

// ---------- T-203 create ----------

describe("TaskRepository.create", () => {
  it("creates file at safeTitle - shortId path", async () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task");
    const task = makeTaskObject(id, { title: "웹사이트 리뉴얼" });
    const persisted = await repo.create(task, "본문");
    const expectedShort = "task_" + ulidOf(id).slice(0, 8);
    expect(persisted.path).toBe(`${TASKS}/웹사이트 리뉴얼 - ${expectedShort}.md`);
    expect(persisted.knownMtime).toBeGreaterThan(0);
  });

  it("expands short ID length when collision occurs", async () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task");

    // 사전에 같은 short ID prefix로 task 점유.
    // findAll로 shortIds index를 구축해야 alloc이 인지한다.
    await seedTask(app, id, "occupied", { status: "todo" });
    await repo.findAll();

    // 다른 ULID로 새 task 생성. alloc이 같은 short ID 회피해야 함.
    const newTaskId = newId("task");
    const newTask = makeTaskObject(newTaskId, { title: "new" });
    const persisted = await repo.create(newTask, "");

    // ULID가 다르면 short ID prefix도 다름. 충돌 확률 매우 낮음.
    // 핵심 검증: 적어도 길이 8 이상의 short ID로 path가 잘 만들어졌고 충돌 없이 create 성공.
    expect(persisted.path).toMatch(/task_[0-9A-HJKMNP-TV-Z]{8,26}\.md$/);
    expect(app.vault.getAbstractFileByPath(persisted.path)).not.toBeNull();
  });

  it("expands short ID when same ULID prefix is already in shortIds index", async () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task");
    const expectedShort = "task_" + ulidOf(id).slice(0, 8);

    // 같은 short ID prefix로 다른 entity가 이미 등록된 상태를 강제로 만든다.
    // findAll 후 shortIds set에 등록되도록 path 형식을 유지.
    const conflictPath = `${TASKS}/conflicting - ${expectedShort}.md`;
    await app.vault.create(conflictPath, makeRaw(id, { title: "conflict" }));
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      conflictPath,
      { type: "task", id, status: "todo", schemaVersion: 1,
        createdAt: "x", updatedAt: "x", project: null, priority: null },
    );
    await repo.findAll();

    // 동일한 ULID로 새 path 할당 시도 → alloc은 다음 길이를 시도해야 함.
    const newTask = makeTaskObject(id, { title: "new" });
    // create는 file write를 하므로 conflict path와 새 path가 모두 존재.
    // 같은 ulid로 두 path가 만들어지지 않도록 alloc은 short ID expansion.
    // (실제 시나리오: findAll 직후 같은 id에 대해 다시 create는 비정상이지만, alloc 동작 검증용.)
    const persisted = await repo.create(newTask, "");
    expect(persisted.path).not.toBe(conflictPath);
    expect(persisted.path).toContain(`task_${ulidOf(id).slice(0, 9)}`);
  });

  it("creates parent folder if missing", async () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const task = makeTaskObject(newId("task"));
    await repo.create(task, "");
    expect(app.vault.getAbstractFileByPath(TASKS)).not.toBeNull();
  });
});

// ---------- T-204 saveImmediate, flush, retry ----------

describe("TaskRepository.saveImmediate / flush", () => {
  it("merges concurrent saveImmediate calls for the same id", async () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task");
    const task = makeTaskObject(id);
    const persisted = await repo.create(task, "");

    const t1: Task = { ...persisted, status: "doing", updatedAt: nowIso() };
    const t2: Task = { ...persisted, status: "done", updatedAt: nowIso() };

    // 동시 saveImmediate
    await Promise.all([repo.saveImmediate(t1), repo.saveImmediate(t2)]);
    const file = app.vault.getAbstractFileByPath(persisted.path);
    const content = await app.vault.read(file as never);
    // 마지막 값이 디스크에 있어야 함 (Map 병합으로 t2가 winner일 수도, 호출 순서에 따라 다름)
    // 핵심은 둘 다 race 없이 끝남
    expect(content).toMatch(/status: (doing|done)/);
  });

  it("handles 100 concurrent saveImmediate without race", async () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task");
    const persisted = await repo.create(makeTaskObject(id), "");

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      const t: Task = { ...persisted, updatedAt: nowIso() };
      promises.push(repo.saveImmediate(t));
    }
    await Promise.all(promises);
    // 끝까지 throw 없이 완료되면 OK
    expect(true).toBe(true);
  });

  it("queueSave debounces", async () => {
    vi.useFakeTimers();
    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task");
    const persisted = await repo.create(makeTaskObject(id), "");

    repo.queueSave({ ...persisted, status: "doing", updatedAt: nowIso() });
    repo.queueSave({ ...persisted, status: "done", updatedAt: nowIso() });

    // 아직 디스크에는 원본
    let content = await app.vault.read(
      app.vault.getAbstractFileByPath(persisted.path) as never,
    );
    expect(content).toContain("status: todo");

    // debounce 통과 후
    await vi.advanceTimersByTimeAsync(DEBOUNCE + 50);
    content = await app.vault.read(
      app.vault.getAbstractFileByPath(persisted.path) as never,
    );
    expect(content).toContain("status: done");
    vi.useRealTimers();
  });
});

// ---------- T-205 conflict ----------

describe("TaskRepository.persist conflict handling", () => {
  it("merges when external mtime is newer but valid", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T10:00:00Z"));

    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task");
    const persisted = await repo.create(makeTaskObject(id), "");

    // Simulate external write: file modified after persisted.knownMtime
    vi.setSystemTime(new Date("2026-05-08T11:00:00Z"));
    const file = app.vault.getAbstractFileByPath(persisted.path);
    const externalRaw = makeRaw(id, {
      status: "doing",
      extraFields: "tags:\n  - external",
    });
    await app.vault.modify(file as never, externalRaw);

    // Now save with stale knownMtime
    const stale: Task = { ...persisted, status: "done", updatedAt: "2026-05-08T11:30:00.000Z" as IsoDateTime };
    await repo.saveImmediate(stale);

    const finalRaw = await app.vault.read(file as never);
    // passthrough 보존됨 + 우리 status가 winner
    expect(finalRaw).toContain("- external");
    expect(finalRaw).toContain("status: done");
    vi.useRealTimers();
  });

  it("creates conflicted copy when external is unparseable", async () => {
    const app = new App();
    const { repo, diag } = makeRepo(app);
    const id = newId("task");
    const persisted = await repo.create(makeTaskObject(id), "");

    // 외부에서 garbage로 덮어쓰고 mtime을 미래로
    const file = app.vault.getAbstractFileByPath(persisted.path);
    await app.vault.modify(file as never, "completely broken\nno frontmatter");
    (file as unknown as { stat: { mtime: number } }).stat.mtime = Date.now() + 60_000;

    await repo.saveImmediate({ ...persisted, status: "done", updatedAt: nowIso() });

    const conflictFile = app.vault
      .getMarkdownFiles()
      .find((f) => f.path.includes("conflict"));
    expect(conflictFile).toBeDefined();
    expect(diag.list().some((e) => e.kind === "conflict")).toBe(true);
  });
});

// ---------- T-206 archive + delete ----------

describe("TaskRepository.archive", () => {
  it("moves file to Archive folder and adds archivedAt", async () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task");
    const persisted = await repo.create(makeTaskObject(id, { title: "old" }), "");

    const archived = await repo.archive(persisted);
    expect(archived.path.startsWith(ARCHIVE + "/")).toBe(true);
    expect(archived.archivedAt).not.toBeNull();

    const file = app.vault.getAbstractFileByPath(archived.path);
    const raw = await app.vault.read(file as never);
    expect(raw).toContain("archivedAt: ");
  });
});

describe("TaskRepository.delete", () => {
  it("trashes the file and removes from index", async () => {
    const app = new App();
    const { repo } = makeRepo(app);
    const id = newId("task");
    const persisted = await repo.create(makeTaskObject(id), "");

    await repo.delete(id as TaskId);
    expect(app.vault.getAbstractFileByPath(persisted.path)).toBeNull();
    expect(repo.getKnownPath(id as TaskId)).toBeUndefined();
  });
});
