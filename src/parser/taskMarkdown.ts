// LLD §4.2: Task Markdown 파서.
// 검증 실패 시 throw 대신 null을 반환해 single-file failure를 격리한다 (PRD §7.4).

import { parseFile, serializeFile } from "./frontmatter";
import { isValidId } from "../core/ids";
import { nowIso } from "../core/time";
import { isTaskStatus, SCHEMA_VERSION } from "../core/types";
import type {
  Task, TaskFrontmatterDoc, Priority,
  TaskId, ProjectId, IsoDateTime,
} from "../core/types";

export interface ParsedTask {
  task: Omit<Task, "knownMtime" | "path">;
  body: string;
}

export function parseTask(raw: string): ParsedTask | null {
  const { fm, body } = parseFile(raw, "task");
  const m = fm.managed;

  if (m["type"] !== "task") return null;
  if (!isValidId("task", m["id"])) return null;
  const status = m["status"];
  if (!isTaskStatus(status)) return null;

  const title = extractTitle(body) || "Untitled";

  return {
    task: {
      schemaVersion: SCHEMA_VERSION,
      id: m["id"] as TaskId,
      type: "task",
      status,
      title,
      project: isValidId("project", m["project"])
        ? (m["project"] as ProjectId)
        : null,
      priority: isValidPriority(m["priority"]) ? m["priority"] : null,
      jiraKey: typeof m["jiraKey"] === "string" && m["jiraKey"].length > 0
        ? m["jiraKey"]
        : null,
      remarks: typeof m["remarks"] === "string" && m["remarks"].trim().length > 0
        ? m["remarks"].trim()
        : null,
      tags: normalizeTags(m["tags"]),
      bodySummary: extractBodySummary(body),
      createdAt: typeof m["createdAt"] === "string"
        ? (m["createdAt"] as IsoDateTime)
        : nowIso(),
      updatedAt: typeof m["updatedAt"] === "string"
        ? (m["updatedAt"] as IsoDateTime)
        : nowIso(),
      archivedAt: typeof m["archivedAt"] === "string"
        ? (m["archivedAt"] as IsoDateTime)
        : null,
      passthrough: fm.passthrough,
      fieldOrder: fm.fieldOrder,
    },
    body,
  };
}

export function serializeTask(task: Task, body: string): string {
  const doc: TaskFrontmatterDoc = {
    schemaVersion: task.schemaVersion,
    id: task.id,
    type: "task",
    status: task.status,
    project: task.project,
    priority: task.priority,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
  if (task.jiraKey) doc.jiraKey = task.jiraKey;
  if (task.remarks) doc.remarks = task.remarks;
  if (task.tags?.length) doc.tags = normalizeTags(task.tags);
  if (task.archivedAt) doc.archivedAt = task.archivedAt;

  return serializeFile(
    {
      managed: doc as unknown as Record<string, unknown>,
      passthrough: task.passthrough,
      fieldOrder: task.fieldOrder,
    },
    ensureHeading(body, task.title),
  );
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

function extractBodySummary(body: string): string {
  const withoutTitle = body.replace(/^#\s+.+$/mu, "").trim();
  const firstBlock = withoutTitle
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .find((block) => block.length > 0 && !block.startsWith("#"));
  return (firstBlock ?? "")
    .replace(/\s+/gu, " ")
    .slice(0, 180);
}

function isValidPriority(v: unknown): v is Priority | null {
  return v === "low" || v === "medium" || v === "high" || v === null;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().replace(/^#/u, ""))
    .filter(Boolean))];
}
