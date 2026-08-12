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
  const numberedSteps = extractNumberedSteps(m);
  // v0.5.0~0.5.1의 steps YAML 목록도 계속 읽어 자동 마이그레이션한다.
  const steps = numberedSteps.length > 0 ? numberedSteps : normalizeSteps(m["steps"]);

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
      estimateMd: typeof m["estimateMd"] === "number" && Number.isFinite(m["estimateMd"])
        ? m["estimateMd"]
        : null,
      actualMd: typeof m["actualMd"] === "number" && Number.isFinite(m["actualMd"])
        ? m["actualMd"]
        : null,
      due: typeof m["due"] === "string" && m["due"].trim().length > 0
        ? m["due"].trim()
        : null,
      tags: normalizeTags(m["tags"]),
      steps,
      currentStep: normalizeCurrentStep(m["currentStep"], steps),
      stepSeconds: extractStepSeconds(m, steps.length),
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
  if (task.estimateMd != null) doc.estimateMd = task.estimateMd;
  if (task.actualMd != null) doc.actualMd = task.actualMd;
  if (task.due) doc.due = task.due;
  if (task.tags?.length) doc.tags = normalizeTags(task.tags);
  const managed = doc as unknown as Record<string, unknown>;
  const normalizedSteps = normalizeSteps(task.steps);
  const stepSeconds = normalizeStepSeconds(task.stepSeconds, normalizedSteps.length);
  normalizedSteps.forEach((step, index) => {
    managed[`step${index + 1}`] = step;
    const seconds = stepSeconds[index] ?? 0;
    if (seconds > 0) managed[`step${index + 1}Seconds`] = seconds;
  });
  if (task.currentStep != null && task.steps?.length) {
    doc.currentStep = normalizeCurrentStep(task.currentStep, task.steps) ?? 1;
  }
  if (task.archivedAt) doc.archivedAt = task.archivedAt;

  return serializeFile(
    {
      managed,
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

function normalizeSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((step): step is string => typeof step === "string")
    .map((step) => step.trim())
    .filter(Boolean);
}

function extractNumberedSteps(managed: Record<string, unknown>): string[] {
  return Object.entries(managed)
    .flatMap(([key, value]) => {
      const match = key.match(/^step([1-9]\d*)$/u);
      if (!match || typeof value !== "string" || !value.trim()) return [];
      return [{ number: Number(match[1]), value: value.trim() }];
    })
    .sort((a, b) => a.number - b.number)
    .map((entry) => entry.value);
}

function extractStepSeconds(managed: Record<string, unknown>, stepCount: number): number[] {
  return Array.from({ length: stepCount }, (_, index) => {
    const value = managed[`step${index + 1}Seconds`];
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.round(value)
      : 0;
  });
}

function normalizeStepSeconds(value: unknown, stepCount: number): number[] {
  const values = Array.isArray(value) ? value : [];
  return Array.from({ length: stepCount }, (_, index) => {
    const seconds = values[index];
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
      ? Math.round(seconds)
      : 0;
  });
}

function normalizeCurrentStep(value: unknown, steps: readonly string[]): number | null {
  if (steps.length === 0 || typeof value !== "number" || !Number.isInteger(value)) return null;
  return Math.min(Math.max(value, 1), steps.length);
}
