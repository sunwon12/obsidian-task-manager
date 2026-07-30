import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "obsidian";
import { MeetingRepository } from "../../src/repositories/MeetingRepository";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { newId, ulidOf } from "../../src/core/ids";
import { SCHEMA_VERSION, type Meeting, type MeetingId, type IsoDate, type IsoDateTime } from "../../src/core/types";

const FOLDER = "TaskMaster/Meetings";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function makeMeeting(id: string, overrides: Partial<Meeting> = {}): Meeting {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id as MeetingId,
    type: "meeting",
    title: "킥오프",
    project: null,
    date: "2026-05-08" as IsoDate,
    participants: ["홍길동", "김영희"],
    createdAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
    updatedAt: "2026-05-08T10:00:00.000Z" as IsoDateTime,
    passthrough: {},
    fieldOrder: [],
    knownMtime: 0,
    path: "",
    ...overrides,
  };
}

describe("MeetingRepository", () => {
  it("creates a meeting file", async () => {
    const app = new App();
    const repo = new MeetingRepository(app, new DiagnosticsLog(), FOLDER);
    const id = newId("meeting");
    const m = makeMeeting(id, { title: "웹사이트 킥오프" });
    const persisted = await repo.create(m, "본문");
    expect(persisted.path).toBe(`${FOLDER}/웹사이트 킥오프 - meeting_${ulidOf(id).slice(0, 8)}.md`);
    expect(persisted.knownMtime).toBeGreaterThan(0);
  });

  it("findAll returns parsed meetings", async () => {
    const app = new App();
    const repo = new MeetingRepository(app, new DiagnosticsLog(), FOLDER);
    const id = newId("meeting");
    await repo.create(makeMeeting(id), "내용");
    // findAll은 metadataCache를 사용하므로 cache 등록 필요
    const path = repo.getKnownPath(id as MeetingId)!;
    (app.metadataCache as unknown as { __set(p: string, fm: Record<string, unknown>): void }).__set(
      path,
      {
        type: "meeting", id, schemaVersion: 1, project: null,
        date: "2026-05-08", participants: ["홍길동", "김영희"],
        createdAt: "2026-05-08T10:00:00.000Z",
        updatedAt: "2026-05-08T10:00:00.000Z",
      },
    );
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(id);
  });

  it("saveImmediate persists changes", async () => {
    const app = new App();
    const repo = new MeetingRepository(app, new DiagnosticsLog(), FOLDER);
    const id = newId("meeting");
    const persisted = await repo.create(makeMeeting(id), "");
    const updated: Meeting = {
      ...persisted,
      participants: ["홍길동", "김영희", "박철수"],
      updatedAt: "2026-05-08T11:00:00.000Z" as IsoDateTime,
    };
    await repo.saveImmediate(updated);

    const file = app.vault.getAbstractFileByPath(persisted.path);
    const raw = await app.vault.read(file as never);
    expect(raw).toContain("- 박철수");
  });

  it("delete trashes the file", async () => {
    const app = new App();
    const repo = new MeetingRepository(app, new DiagnosticsLog(), FOLDER);
    const id = newId("meeting");
    const persisted = await repo.create(makeMeeting(id), "");
    await repo.delete(id as MeetingId);
    expect(app.vault.getAbstractFileByPath(persisted.path)).toBeNull();
  });
});
