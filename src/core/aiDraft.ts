// AI 초안: `claude -p --output-format json` 의 stdout에서 카드 필드 제안을 뽑고,
// 작업 단계의 종류 접두어를 읽고 쓴다. 프로세스·UI를 모르는 순수 함수만 둔다.
//
// 왜 JSON만 받고 파일은 안 건드리게 하는가: 카드 .md 를 AI가 직접 쓰면
// Task.knownMtime conflict detection 과 부딪히고 passthrough/fieldOrder 보존이 깨진다.
// 적용은 TaskService.updateTask 를 타야 그 둘이 공짜로 따라온다 (ADR-0012).

import type { Priority } from "./types";

/** 단계의 종류. 곧 "누가 하는가"의 위임 라우팅 키다 (ADR-0012 §4). */
export const STEP_KINDS = ["결정", "조사", "실작업", "검증", "대기"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** 규칙: 3~7개. 2개면 안 쪼갠 것, 8개 넘으면 카드가 두 장이어야 한다. */
export const MIN_STEPS = 3;
export const MAX_STEPS = 7;

export interface PlanStep {
  /** 접두어를 못 읽었으면 null — 조용히 고치지 않고 UI에서 회색으로 보여준다. */
  kind: StepKind | null;
  /** 접두어를 뗀 본문. */
  text: string;
  /** 저장된 원문 그대로. */
  raw: string;
}

export interface AiDraftSuggestion {
  priority: Priority | null;
  /** ProjectId를 AI가 알 수 없으므로 제목으로 받고 호출부가 매칭한다. */
  projectTitle: string | null;
  tags: string[];
  remarks: string | null;
  /** 생성 모드에서만 채워진다. */
  steps: string[];
  /** 비평 모드에서만 채워진다. 한 줄씩. */
  critique: string[];
  /** 무엇을 근거로 뽑았는지 한 줄. */
  rationale: string | null;
}

export interface AiDraftParseResult {
  ok: boolean;
  suggestion: AiDraftSuggestion | null;
  /** 실패 사유 한 줄. ok면 null. */
  error: string | null;
}

const STEP_PREFIX = /^\s*\[\s*([^\]]{1,12}?)\s*\]\s*(.*)$/u;
const FENCE = /```(?:json)?\s*([\s\S]*?)```/u;
const PRIORITIES: readonly Priority[] = ["low", "medium", "high"];

export const EMPTY_SUGGESTION: AiDraftSuggestion = {
  priority: null,
  projectTitle: null,
  tags: [],
  remarks: null,
  steps: [],
  critique: [],
  rationale: null,
};

/** 저장된 단계 문자열에서 종류 접두어를 읽는다. 모르는 접두어는 kind=null. */
export function parsePlanStep(raw: string): PlanStep {
  const trimmed = raw.trim();
  const match = STEP_PREFIX.exec(trimmed);
  if (!match) return { kind: null, text: trimmed, raw: trimmed };
  const label = (match[1] ?? "").trim();
  const kind = STEP_KINDS.find((candidate) => candidate === label) ?? null;
  if (!kind) return { kind: null, text: trimmed, raw: trimmed };
  return { kind, text: (match[2] ?? "").trim(), raw: trimmed };
}

export function formatPlanStep(kind: StepKind, text: string): string {
  return `[${kind}] ${text.trim()}`;
}

export interface PlanWarning {
  code: "too-few" | "too-many" | "no-decision" | "bad-first" | "unlabeled";
  message: string;
}

/**
 * 단계 목록이 규칙을 어겼는지 본다. **고치지 않고 알리기만 한다** — 구조는 기계가
 * 보되 의미는 사람이 판정해야 하고, 여기서 조용히 바로잡으면 AI가 결정 단계를
 * 빠뜨린 사실 자체가 숨는다.
 */
export function inspectPlan(steps: readonly string[]): PlanWarning[] {
  const parsed = steps.map(parsePlanStep).filter((step) => step.text.length > 0);
  if (parsed.length === 0) return [];
  const warnings: PlanWarning[] = [];
  if (parsed.length < MIN_STEPS) {
    warnings.push({ code: "too-few", message: `단계가 ${parsed.length}개다 — ${MIN_STEPS}개 미만이면 아직 안 쪼갠 것이다.` });
  }
  if (parsed.length > MAX_STEPS) {
    warnings.push({ code: "too-many", message: `단계가 ${parsed.length}개다 — ${MAX_STEPS}개를 넘으면 카드가 두 장이어야 한다.` });
  }
  if (!parsed.some((step) => step.kind === "결정")) {
    warnings.push({ code: "no-decision", message: "[결정] 단계가 없다 — 닫아야 할 선택지가 정말 없는지 본다." });
  }
  const first = parsed[0];
  if (first && first.kind !== "결정" && first.kind !== "조사") {
    warnings.push({ code: "bad-first", message: "첫 단계가 [결정]도 [조사]도 아니다 — 루틴 카드가 아니면 모르는 채로 출발하는 것이다." });
  }
  const unlabeled = parsed.filter((step) => step.kind == null).length;
  if (unlabeled > 0) {
    warnings.push({ code: "unlabeled", message: `종류를 못 읽은 단계 ${unlabeled}개 — 접두어를 ${STEP_KINDS.map((k) => `[${k}]`).join(" ")} 중 하나로 맞춘다.` });
  }
  return warnings;
}

/**
 * `claude -p --output-format json` 의 stdout을 파싱한다.
 * 바깥 envelope({type:"result", result:"..."})와 안쪽 본문 양쪽을 벗겨 내고,
 * 코드펜스로 감싼 응답도 받아 준다.
 */
export function parseAiDraftResponse(stdout: string): AiDraftParseResult {
  const raw = stdout.trim();
  if (!raw) return fail("응답이 비어 있습니다.");

  const envelope = tryParse(raw);
  if (isRecord(envelope) && envelope["is_error"] === true) {
    return fail(oneLine(String(envelope["result"] ?? "claude가 오류로 끝났습니다.")));
  }

  const inner = isRecord(envelope) && typeof envelope["result"] === "string"
    ? envelope["result"]
    : raw;

  const payload = extractObject(inner) ?? (isRecord(envelope) ? envelope : null);
  if (!payload) return fail("응답에서 JSON 객체를 찾지 못했습니다.");

  return { ok: true, suggestion: normalizeSuggestion(payload), error: null };
}

function normalizeSuggestion(payload: Record<string, unknown>): AiDraftSuggestion {
  const priority = payload["priority"];
  const steps = toStringArray(payload["steps"])
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, MAX_STEPS);
  return {
    priority: PRIORITIES.find((candidate) => candidate === priority) ?? null,
    projectTitle: toNullableString(payload["projectTitle"] ?? payload["project"]),
    tags: toStringArray(payload["tags"])
      .map((tag) => tag.trim().replace(/^#/u, ""))
      .filter(Boolean)
      .slice(0, 8),
    remarks: toNullableString(payload["remarks"]),
    steps,
    critique: toStringArray(payload["critique"]).map((line) => line.trim()).filter(Boolean).slice(0, 8),
    rationale: toNullableString(payload["rationale"]),
  };
}

/** 균형 잡힌 중괄호로 첫 JSON 객체를 잘라 낸다 — 앞뒤에 설명이 붙어도 산다. */
function extractObject(text: string): Record<string, unknown> | null {
  const fenced = FENCE.exec(text);
  const candidates = [fenced?.[1], text].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index += 1) {
      const char = candidate[index];
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const parsed = tryParse(candidate.slice(start, index + 1));
          if (isRecord(parsed)) return parsed;
          break;
        }
      }
    }
  }
  return null;
}

export interface DraftPromptInput {
  title: string;
  body: string;
  jiraKey: string | null;
  existingSteps: readonly string[];
  existingTags: readonly string[];
  existingRemarks: string | null;
  projectTitles: readonly string[];
  /** true면 과거 카드까지 뒤진다(느림). false면 이 카드만 보고 빠르게. */
  deep: boolean;
}

/** 생성 모드인지 비평 모드인지는 기존 단계 유무가 정한다 (ADR-0012 §3). */
export function draftMode(existingSteps: readonly string[]): "generate" | "critique" {
  return existingSteps.some((step) => step.trim().length > 0) ? "critique" : "generate";
}

export function buildDraftPrompt(input: DraftPromptInput): string {
  const mode = draftMode(input.existingSteps);
  const kinds = STEP_KINDS.map((kind) => `[${kind}]`).join(" · ");
  const lines: string[] = [
    "너는 내 개인 태스크 보드(TaskMaster)의 카드 하나를 채우는 보조자다.",
    "아래 카드를 읽고 **JSON 객체 하나만** 출력한다. 설명 문장을 앞뒤에 붙이지 않는다.",
    "",
    "## 카드",
    `제목: ${input.title}`,
  ];
  if (input.jiraKey) lines.push(`Jira: ${input.jiraKey}`);
  if (input.existingTags.length > 0) lines.push(`기존 태그: ${input.existingTags.join(", ")}`);
  if (input.existingRemarks) lines.push(`기존 비고: ${input.existingRemarks}`);
  if (input.body.trim()) lines.push("", "본문:", input.body.trim());
  if (mode === "critique") {
    lines.push("", "이미 적어 둔 작업 단계:");
    input.existingSteps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  }

  lines.push(
    "",
    "## 먼저 할 일",
    input.deep
      ? "이 vault에서 **비슷한 과거 카드**(TaskMaster/Tasks, TaskMaster/Archive)와 관련 노트를 먼저 찾아, 그때 쓴 단계와 실제 걸린 시간을 재사용한다. Jira 키가 있으면 티켓 본문의 인수조건과 미확정 항목을 읽는다."
      : "이 카드에 적힌 내용만 보고 판단한다. 파일을 뒤지지 않는다.",
    "",
    "## 작업 단계 규칙",
    `- 단계마다 종류 접두어를 붙인다: ${kinds}`,
    "- `결정`=선택지를 닫는 일(사람만 할 수 있다) · `조사`=모르는 걸 아는 상태로 · `실작업`=코드·문서 변경 · `검증`=됐는지 확인 · `대기`=남이 해줘야 움직이는 일",
    "- 이름은 **동사 + 산출물**로 쓴다. \"설계\"가 아니라 \"A와 B 중 하나 골라 티켓에 근거 2줄\".",
    `- ${MIN_STEPS}~${MAX_STEPS}개. 첫 단계는 [결정] 또는 [조사]다.`,
    "- **30분 안에 끝나는 카드는 단계를 만들지 않는다** — 빈 배열로 둔다. 잡무·루틴에 단계를 붙이는 건 순손실이다.",
    "- `대기` 단계에는 기한과 \"안 오면 어떻게 한다\"를 함께 적는다.",
    "",
  );

  if (mode === "generate") {
    lines.push(
      "## 이번 모드: 생성",
      "`steps`를 채운다. **닫아야 할 선택지가 있으면 반드시 [결정] 단계를 하나 이상 세운다** — 실작업만 나열하면 카드가 다시 멈춘다. `critique`는 빈 배열로 둔다.",
    );
  } else {
    lines.push(
      "## 이번 모드: 비평",
      "이미 단계가 적혀 있으므로 **덮어쓰지 않는다.** `steps`는 빈 배열로 두고, `critique`에 지적만 한 줄씩 담는다 — 빠진 단계, 아직 안 닫힌 결정, 순서가 성립하지 않는 곳, 실작업으로 위장한 결정. 트집을 위한 트집은 쓰지 않는다.",
    );
  }

  const projects = input.projectTitles.length > 0
    ? input.projectTitles.map((title) => `"${title}"`).join(", ")
    : "(없음)";

  lines.push(
    "",
    "## 출력 스키마",
    "```json",
    "{",
    '  "priority": "low" | "medium" | "high" | null,',
    `  "projectTitle": null 또는 다음 중 하나 — ${projects},`,
    '  "tags": ["짧은 분류 태그", "..."],',
    '  "remarks": "카드에 띄울 한 줄 비고 또는 null",',
    '  "steps": ["[결정] ...", "[실작업] ..."],',
    '  "critique": ["지적 한 줄", "..."],',
    '  "rationale": "무엇을 근거로 뽑았는지 한 줄"',
    "}",
    "```",
    "모르는 필드는 null 또는 빈 배열로 둔다. 억지로 채우지 않는다.",
  );

  return lines.join("\n");
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function oneLine(text: string): string {
  return text.split("\n")[0]?.slice(0, 200) ?? "알 수 없는 오류";
}

function fail(error: string): AiDraftParseResult {
  return { ok: false, suggestion: null, error };
}
