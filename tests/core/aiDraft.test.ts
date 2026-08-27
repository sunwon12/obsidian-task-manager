import { describe, expect, it } from "vitest";
import {
  buildDraftPrompt,
  draftMode,
  formatPlanStep,
  inspectPlan,
  MAX_STEPS,
  parseAiDraftResponse,
  parsePlanStep,
  type DraftPromptInput,
} from "../../src/core/aiDraft";

function envelope(inner: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: typeof inner === "string" ? inner : JSON.stringify(inner),
    ...extra,
  });
}

const BASE_INPUT: DraftPromptInput = {
  title: "댓글 유효기간 어드민화",
  body: "운영자가 이벤트마다 글자 수와 유효기간을 정한다.",
  jiraKey: "BDCC-1132",
  existingSteps: [],
  existingTags: [],
  existingRemarks: null,
  projectTitles: ["홈 커뮤니티"],
  deep: false,
};

describe("parsePlanStep", () => {
  it("아는 접두어는 실행 주체로 읽고 본문만 남긴다", () => {
    expect(parsePlanStep("[인간] 설계")).toEqual({
      owner: "인간",
      text: "설계",
      raw: "[인간] 설계",
    });
  });

  it("이전 분류 접두어는 조용히 바꾸지 않고 실행 주체 없음으로 둔다", () => {
    const parsed = parsePlanStep("[실작업] 구현");
    expect(parsed.owner).toBeNull();
    expect(parsed.text).toBe("[실작업] 구현");
  });

  it("접두어가 없으면 실행 주체 없음이다", () => {
    expect(parsePlanStep("그냥 단계").owner).toBeNull();
  });

  it("formatPlanStep은 다시 읽을 수 있는 형태로 쓴다", () => {
    const formatted = formatPlanStep("AI", "  구현  ");
    expect(formatted).toBe("[AI] 구현");
    expect(parsePlanStep(formatted).owner).toBe("AI");
  });
});

describe("inspectPlan", () => {
  it("규칙을 다 지킨 계획은 경고가 없다", () => {
    expect(inspectPlan([
      "[인간] 설계",
      "[AI] 구현",
      "[인간] 검증",
    ])).toEqual([]);
  });

  it("빈 계획은 판정하지 않는다 — 아직 안 쓴 것과 잘못 쓴 것은 다르다", () => {
    expect(inspectPlan([])).toEqual([]);
  });

  it("단계가 적다고 최소 개수나 첫 단계 종류를 강제하지 않는다", () => {
    expect(inspectPlan(["[AI] 구현"])).toEqual([]);
  });

  it("실행 주체를 못 읽은 단계를 센다", () => {
    const warning = inspectPlan(["[인간] 설계", "라벨 없음", "[AI] 구현"])
      .find((w) => w.code === "unlabeled");
    expect(warning?.message).toContain("1개");
    expect(warning?.message).toContain("[인간] [AI]");
  });

  it("안전 상한을 넘길 만큼 잘게 나뉜 계획은 합치기를 제안한다", () => {
    const many = Array.from({ length: MAX_STEPS + 1 }, (_, i) => `[AI] 국면 ${i}`);
    const warning = inspectPlan(many).find((w) => w.code === "too-many");
    expect(warning?.message).toContain("같은 주체의 연속 단계");
  });
});

describe("parseAiDraftResponse", () => {
  it("envelope 안의 JSON 객체를 읽는다", () => {
    const result = parseAiDraftResponse(envelope({
      priority: "high",
      projectTitle: "홈 커뮤니티",
      tags: ["#업무", " 백엔드 "],
      remarks: "기획 확정 대기",
      steps: ["[인간] 설계", "[AI] 구현"],
      critique: [],
      rationale: "BDCC-1132 본문",
    }));
    expect(result.ok).toBe(true);
    expect(result.suggestion).toMatchObject({
      priority: "high",
      projectTitle: "홈 커뮤니티",
      tags: ["업무", "백엔드"],
      remarks: "기획 확정 대기",
      rationale: "BDCC-1132 본문",
    });
    expect(result.suggestion?.steps).toHaveLength(2);
  });

  it("코드펜스와 앞뒤 설명이 붙어도 읽는다", () => {
    const inner = "다음과 같이 제안합니다.\n```json\n{\"priority\":\"low\",\"tags\":[\"잡무\"]}\n```\n끝.";
    const result = parseAiDraftResponse(envelope(inner));
    expect(result.ok).toBe(true);
    expect(result.suggestion?.priority).toBe("low");
    expect(result.suggestion?.tags).toEqual(["잡무"]);
  });

  it("envelope 없이 JSON만 와도 읽는다", () => {
    const result = parseAiDraftResponse('{"remarks":"바로 온 응답"}');
    expect(result.ok).toBe(true);
    expect(result.suggestion?.remarks).toBe("바로 온 응답");
  });

  it("is_error면 실패로 본다", () => {
    const result = parseAiDraftResponse(JSON.stringify({
      type: "result",
      is_error: true,
      result: "Credit balance too low\n두 번째 줄",
    }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Credit balance too low");
  });

  it("빈 출력과 JSON 없는 출력은 사유를 남긴다", () => {
    expect(parseAiDraftResponse("   ").error).toBe("응답이 비어 있습니다.");
    expect(parseAiDraftResponse("설명만 있고 객체가 없다").ok).toBe(false);
  });

  it("모르는 값은 무시하고 상한을 넘는 단계는 자른다", () => {
    const result = parseAiDraftResponse(envelope({
      priority: "urgent",
      tags: "문자열이면 무시",
      steps: Array.from({ length: 12 }, (_, i) => `[AI] ${i}`),
      unknownField: 1,
    }));
    expect(result.suggestion?.priority).toBeNull();
    expect(result.suggestion?.tags).toEqual([]);
    expect(result.suggestion?.steps).toHaveLength(MAX_STEPS);
  });
});

describe("buildDraftPrompt", () => {
  it("단계가 없으면 생성 모드다", () => {
    expect(draftMode([])).toBe("generate");
    expect(draftMode(["   "])).toBe("generate");
    const prompt = buildDraftPrompt(BASE_INPUT);
    expect(prompt).toContain("이번 모드: 생성");
    expect(prompt).toContain("[인간] 설계");
    expect(prompt).toContain("[AI] 구현");
    expect(prompt).toContain("인간이 생각·판단한 시간과 AI가 실행된 시간");
    expect(prompt).toContain("고정 개수나 첫 단계 규칙은 없다");
    expect(prompt).not.toContain("3~7개");
    expect(prompt).not.toContain("[결정]");
  });

  it("단계가 있으면 비평 모드고 덮어쓰지 말라고 못 박는다", () => {
    const prompt = buildDraftPrompt({ ...BASE_INPUT, existingSteps: ["[AI] 구현"] });
    expect(draftMode(["[AI] 구현"])).toBe("critique");
    expect(prompt).toContain("이번 모드: 비평");
    expect(prompt).toContain("덮어쓰지 않는다");
    expect(prompt).toContain("1. [AI] 구현");
    expect(prompt).toContain("세부 지시서처럼 길거나");
  });

  it("깊은 경로에서만 과거 카드를 뒤지라고 지시한다", () => {
    const prompt = buildDraftPrompt({ ...BASE_INPUT, deep: true });
    expect(prompt).toContain("비슷한 과거 카드");
    expect(prompt).toContain("과거의 상세 단계명은 복사하지 않는다");
    expect(buildDraftPrompt(BASE_INPUT)).toContain("파일을 뒤지지 않는다");
  });

  it("프로젝트 후보를 그대로 넘긴다", () => {
    expect(buildDraftPrompt(BASE_INPUT)).toContain('"홈 커뮤니티"');
  });
});
