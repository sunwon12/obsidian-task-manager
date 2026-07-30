import { describe, it, expect } from "vitest";
import { parseMeeting, serializeMeeting } from "../../src/parser/meetingMarkdown";
import type { Meeting, MeetingId, IsoDate, IsoDateTime } from "../../src/core/types";
import { SCHEMA_VERSION } from "../../src/core/types";

const validId = "meeting_01HX7T4A0KN9F9RHHKMJ4F5H8A";

const baseRaw = `---
schemaVersion: 1
id: ${validId}
type: meeting
project: null
date: 2026-05-08
participants:
  - 홍길동
  - 김영희
createdAt: 2026-05-08T15:00:00.000Z
updatedAt: 2026-05-08T16:00:00.000Z
---

# 웹사이트 리뉴얼 킥오프

## 논의 내용
`;

describe("parseMeeting", () => {
  it("parses a valid meeting", () => {
    const result = parseMeeting(baseRaw);
    expect(result).not.toBeNull();
    expect(result!.meeting.id).toBe(validId);
    expect(result!.meeting.date).toBe("2026-05-08");
    expect(result!.meeting.participants).toEqual(["홍길동", "김영희"]);
    expect(result!.meeting.title).toBe("웹사이트 리뉴얼 킥오프");
  });

  it("rejects invalid date", () => {
    const raw = baseRaw.replace("date: 2026-05-08", "date: 2026/05/08");
    expect(parseMeeting(raw)).toBeNull();
  });

  it("rejects type mismatch", () => {
    const raw = baseRaw.replace("type: meeting", "type: task");
    expect(parseMeeting(raw)).toBeNull();
  });

  it("ignores non-string participants", () => {
    const raw = baseRaw.replace(
      "participants:\n  - 홍길동\n  - 김영희",
      "participants:\n  - 홍길동\n  - 42",
    );
    const result = parseMeeting(raw);
    expect(result?.meeting.participants).toEqual(["홍길동"]);
  });
});

describe("serializeMeeting", () => {
  function makeMeeting(): Meeting {
    return {
      schemaVersion: SCHEMA_VERSION,
      id: validId as MeetingId,
      type: "meeting",
      title: "테스트 회의",
      project: null,
      date: "2026-05-08" as IsoDate,
      participants: ["홍길동", "김영희"],
      createdAt: "2026-05-08T15:00:00.000Z" as IsoDateTime,
      updatedAt: "2026-05-08T16:00:00.000Z" as IsoDateTime,
      passthrough: {},
      fieldOrder: [
        "schemaVersion", "id", "type", "project", "date",
        "participants", "createdAt", "updatedAt",
      ],
      knownMtime: 0,
      path: "TaskMaster/Meetings/test.md",
    };
  }

  it("round-trips participants array", () => {
    const meeting = makeMeeting();
    const out = serializeMeeting(meeting, "본문\n");
    const reparsed = parseMeeting(out);
    expect(reparsed?.meeting.participants).toEqual(meeting.participants);
  });

  it("preserves passthrough", () => {
    const meeting: Meeting = {
      ...makeMeeting(),
      passthrough: { tags: ["kickoff"] },
      fieldOrder: [
        "schemaVersion", "id", "type", "project", "date",
        "participants", "createdAt", "updatedAt", "tags",
      ],
    };
    const out = serializeMeeting(meeting, "본문\n");
    const reparsed = parseMeeting(out);
    expect(reparsed?.meeting.passthrough).toEqual({ tags: ["kickoff"] });
  });
});
