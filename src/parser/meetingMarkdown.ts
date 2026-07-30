// LLD §4.2: Meeting Markdown 파서. taskMarkdown과 동일 패턴 (status/priority 없음, archive 없음).
import { parseFile, serializeFile } from "./frontmatter";
import { isValidId } from "../core/ids";
import { nowIso } from "../core/time";
import { SCHEMA_VERSION } from "../core/types";
import type {
  Meeting, MeetingFrontmatterDoc, MeetingId, ProjectId, IsoDateTime, IsoDate,
} from "../core/types";

export interface ParsedMeeting {
  meeting: Omit<Meeting, "knownMtime" | "path">;
  body: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseMeeting(raw: string): ParsedMeeting | null {
  const { fm, body } = parseFile(raw, "meeting");
  const m = fm.managed;

  if (m["type"] !== "meeting") return null;
  if (!isValidId("meeting", m["id"])) return null;
  const date = m["date"];
  if (typeof date !== "string" || !ISO_DATE_RE.test(date)) return null;

  const title = extractTitle(body) || "Untitled";

  return {
    meeting: {
      schemaVersion: SCHEMA_VERSION,
      id: m["id"] as MeetingId,
      type: "meeting",
      title,
      project: isValidId("project", m["project"])
        ? (m["project"] as ProjectId)
        : null,
      date: date as IsoDate,
      participants: parseStringArray(m["participants"]),
      createdAt: typeof m["createdAt"] === "string"
        ? (m["createdAt"] as IsoDateTime)
        : nowIso(),
      updatedAt: typeof m["updatedAt"] === "string"
        ? (m["updatedAt"] as IsoDateTime)
        : nowIso(),
      passthrough: fm.passthrough,
      fieldOrder: fm.fieldOrder,
    },
    body,
  };
}

export function serializeMeeting(meeting: Meeting, body: string): string {
  const doc: MeetingFrontmatterDoc = {
    schemaVersion: meeting.schemaVersion,
    id: meeting.id,
    type: "meeting",
    project: meeting.project,
    date: meeting.date,
    participants: meeting.participants,
    createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt,
  };

  return serializeFile(
    {
      managed: doc as unknown as Record<string, unknown>,
      passthrough: meeting.passthrough,
      fieldOrder: meeting.fieldOrder,
    },
    ensureHeading(body, meeting.title),
  );
}

function parseStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function extractTitle(body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m && m[1] ? m[1].trim() : "";
}

function ensureHeading(body: string, title: string): string {
  if (/^#\s+.+$/m.test(body)) {
    return body.replace(/^#\s+.+$/m, `# ${title}`);
  }
  const trimmed = body.replace(/^\n+/, "");
  return `# ${title}\n\n${trimmed}`;
}
