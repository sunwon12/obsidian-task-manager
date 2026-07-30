import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "obsidian";
import { MeetingService } from "../../src/services/MeetingService";
import { MeetingRepository } from "../../src/repositories/MeetingRepository";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { createTaskMasterStore } from "../../src/store/taskMasterStore";
import type { IsoDate } from "../../src/core/types";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("MeetingService", () => {
  it("creates meeting file and updates store", async () => {
    const app = new App();
    const store = createTaskMasterStore();
    const repo = new MeetingRepository(app, new DiagnosticsLog(), "TaskMaster/Meetings");
    const svc = new MeetingService(repo, store);
    const m = await svc.createMeeting({
      title: "킥오프",
      date: "2026-05-08" as IsoDate,
      participants: ["A", "B"],
    });
    expect(store.getState().meetings.get(m.id)).toBeDefined();
    expect(m.participants).toEqual(["A", "B"]);
  });

  it("getMeetingPath returns path or null", async () => {
    const app = new App();
    const store = createTaskMasterStore();
    const repo = new MeetingRepository(app, new DiagnosticsLog(), "TaskMaster/Meetings");
    const svc = new MeetingService(repo, store);
    const m = await svc.createMeeting({
      title: "x",
      date: "2026-05-08" as IsoDate,
    });
    expect(svc.getMeetingPath(m.id)).toBe(m.path);
    expect(svc.getMeetingPath("meeting_unknown" as never)).toBeNull();
  });
});
