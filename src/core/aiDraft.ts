// AI 초안: `claude -p --output-format json` 의 stdout에서 카드 필드 제안을 뽑고,
// 작업 단계의 실행 주체 접두어를 읽고 쓴다. 프로세스·UI를 모르는 순수 함수만 둔다.
//
// 왜 JSON만 받고 파일은 안 건드리게 하는가: 카드 .md 를 AI가 직접 쓰면
// Task.knownMtime conflict detection 과 부딪히고 passthrough/fieldOrder 보존이 깨진다.
// 적용은 TaskService.updateTask 를 타야 그 둘이 공짜로 따라온다 (ADR-0012).

import type { Priority } from "./types";

/** 단계 타이머가 측정하는 실행 주체. */
export const STEP_OWNERS = ["인간", "AI"] as const;
export type StepOwner = (typeof STEP_OWNERS)[number];

/** AI 응답이 비정상적으로 커져 UI를 밀어내지 않게 하는 저장 안전 상한이다. 계획 규칙은 아니다. */
export const MAX_STEPS = 7;

export interface PlanStep {
  /** 접두어를 못 읽었으면 null — 조용히 고치지 않고 UI에서 회색으로 보여준다. */
  owner: StepOwner | null;
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

/** 저장된 단계 문자열에서 실행 주체 접두어를 읽는다. 모르는 접두어는 owner=null. */
export function parsePlanStep(raw: string): PlanStep {
  const trimmed = raw.trim();
  const match = STEP_PREFIX.exec(trimmed);
  if (!match) return { owner: null, text: trimmed, raw: trimmed };
  const label = (match[1] ?? "").trim();
  const owner = STEP_OWNERS.find((candidate) => candidate === label) ?? null;
  if (!owner) return { owner: null, text: trimmed, raw: trimmed };
  return { owner, text: (match[2] ?? "").trim(), raw: trimmed };
}

export function formatPlanStep(owner: StepOwner, text: string): string {
  return `[${owner}] ${text.trim()}`;
}

export interface PlanWarning {
  code: "too-many" | "unlabeled";
  message: string;
}

/**
 * 측정에 필요한 실행 주체가 보이는지 본다. **고치지 않고 알리기만 한다** — 기존
 * 단계나 과거 접두어를 임의로 바꾸면 이미 쌓인 단계별 시간의 의미가 달라진다.
 */
export function inspectPlan(steps: readonly string[]): PlanWarning[] {
  const parsed = steps.map(parsePlanStep).filter((step) => step.text.length > 0);
  if (parsed.length === 0) return [];
  const warnings: PlanWarning[] = [];
  if (parsed.length > MAX_STEPS) {
    warnings.push({ code: "too-many", message: `단계가 ${parsed.length}개다 — 현재 국면을 알아차리는 용도보다 잘게 나뉘었다. 같은 주체의 연속 단계를 합칠 수 있는지 본다.` });
  }
  const unlabeled = parsed.filter((step) => step.owner == null).length;
  if (unlabeled > 0) {
    warnings.push({ code: "unlabeled", message: `실행 주체를 못 읽은 단계 ${unlabeled}개 — 접두어를 ${STEP_OWNERS.map((owner) => `[${owner}]`).join(" ")} 중 하나로 맞춘다.` });
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
  const owners = STEP_OWNERS.map((owner) => `[${owner}]`).join(" · ");
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
      ? "이 vault에서 **비슷한 과거 카드**(TaskMaster/Tasks, TaskMaster/Archive)와 관련 노트를 먼저 찾아, 인간과 AI가 맡았던 큰 국면과 실제 걸린 시간만 참고한다. 과거의 상세 단계명은 복사하지 않는다. Jira 키가 있으면 티켓 본문의 인수조건과 미확정 항목을 읽는다."
      : "이 카드에 적힌 내용만 보고 판단한다. 파일을 뒤지지 않는다.",
    "",
    "## 작업 단계의 목적",
    "- 단계는 체크리스트나 AI 작업 지시서가 아니다. **인간이 생각·판단한 시간과 AI가 실행된 시간을 분리해 측정하고, 지금 어느 국면인지 알아차리는 표지**다.",
    `- 단계마다 실행 주체 접두어를 붙인다: ${owners}`,
    "- `[인간]`은 생각·설계·결정·판정, `[AI]`는 에이전트 실행·조사·구현·테스트 실행이다.",
    "- 이름은 짧은 국면명으로 쓴다. `[인간] 설계`, `[AI] 구현`, `[인간] 검증`이면 충분하다.",
    "- `설계를 어떻게 할지 정리`처럼 방법·산출물·세부 체크리스트를 단계명에 쓰지 않는다. 그런 내용은 카드 본문이나 설계 문서가 맡는다.",
    "- 실행 주체가 바뀌거나 시간을 따로 보고 싶은 큰 국면이 바뀔 때만 나눈다. 고정 개수나 첫 단계 규칙은 없다.",
    "- 기다리는 시간은 인간·AI 생산성 시간이 아니므로 단계로 만들지 말고 상태나 비고에 둔다.",
    "",
  );

  if (mode === "generate") {
    lines.push(
      "## 이번 모드: 생성",
      "`steps`를 채운다. 필요한 측정 국면만 짧게 만들고, 단계 전환을 측정할 필요가 없는 한 덩어리 작업이면 빈 배열로 둔다. `critique`는 빈 배열로 둔다.",
    );
  } else {
    lines.push(
      "## 이번 모드: 비평",
      "이미 단계가 적혀 있으므로 **덮어쓰지 않는다.** `steps`는 빈 배열로 두고, `critique`에는 실행 주체가 빠졌거나 단계명이 세부 지시서처럼 길거나 측정할 국면 전환이 빠진 경우만 한 줄씩 지적한다. 트집을 위한 트집은 쓰지 않는다.",
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
    '  "steps": ["[인간] 설계", "[AI] 구현", "[인간] 검증"],',
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
