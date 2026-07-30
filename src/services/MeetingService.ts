// PRD §7.7: MeetingService.
// Phase 1은 createMeeting (action item 자동화는 Phase 2).

import type { MeetingRepository } from "../repositories/MeetingRepository";
import type { TaskMasterStore } from "../store/taskMasterStore";
import { newId } from "../core/ids";
import { nowIso } from "../core/time";
import { SCHEMA_VERSION } from "../core/types";
import type { CreateMeetingInput, Meeting, MeetingId } from "../core/types";

export class MeetingService {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly store: TaskMasterStore,
  ) {}

  async createMeeting(input: CreateMeetingInput): Promise<Meeting> {
    const id = newId("meeting") as MeetingId;
    const draft: Meeting = {
      schemaVersion: SCHEMA_VERSION,
      id,
      type: "meeting",
      title: input.title.trim() || "Untitled",
      project: input.project ?? null,
      date: input.date,
      participants: input.participants ?? [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      passthrough: {},
      fieldOrder: [
        "schemaVersion", "id", "type", "project", "date",
        "participants", "createdAt", "updatedAt",
      ],
      knownMtime: 0,
      path: "",
    };
    const persisted = await this.meetings.create(draft, input.body ?? "");
    this.store.getState().upsertMeeting(persisted);
    return persisted;
  }

  getMeetingPath(id: MeetingId): string | null {
    return this.store.getState().meetings.get(id)?.path ?? null;
  }
}
