import { describe, expect, it } from "vitest";
import {
  AiDraftService,
  type AiDraftOptions,
  type AiDraftRunner,
  type AiDraftRunResult,
} from "../../src/services/AiDraftService";
import type { DraftPromptInput } from "../../src/core/aiDraft";

const INPUT: DraftPromptInput = {
  title: "오피셜 체크 노출",
  body: "",
  jiraKey: "BDCC-1002",
  existingSteps: [],
  existingTags: [],
  existingRemarks: null,
  projectTitles: [],
  deep: false,
};

function ok(payload: unknown): AiDraftRunResult {
  return {
    ok: true,
    stdout: JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(payload) }),
    message: "",
  };
}

function build(
  respond: () => Promise<AiDraftRunResult>,
  overrides: Partial<AiDraftOptions> = {},
  supported = true,
) {
  const prompts: string[] = [];
  const models: string[] = [];
  const runner: AiDraftRunner = {
    isSupported: () => supported,
    run: async (request) => {
      prompts.push(request.prompt);
      models.push(request.model);
      return respond();
    },
  };
  const service = new AiDraftService(runner, () => ({
    enabled: true,
    binary: "claude",
    cwd: "/vault",
    model: "sonnet",
    timeoutMs: 1000,
    ...overrides,
  }));
  return { service, prompts, models };
}

describe("AiDraftService", () => {
  it("성공하면 제안을 상태에 담고 구독자에게 알린다", async () => {
    const { service, models } = build(async () => ok({ priority: "high", tags: ["업무"] }));
    let notified = 0;
    service.subscribe(() => { notified += 1; });

    expect(await service.suggest(INPUT)).toBe(true);

    const state = service.getState();
    expect(state.status).toBe("idle");
    expect(state.suggestion?.priority).toBe("high");
    expect(state.error).toBeNull();
    expect(state.startedAt).toBeNull();
    expect(state.mode).toBe("generate");
    expect(models).toEqual(["sonnet"]);
    expect(notified).toBeGreaterThan(0);
  });

  it("이미 돌고 있으면 새로 실행하지 않고 같은 실행에 합류한다", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => { release = () => resolve(); });
    const { service, prompts } = build(async () => {
      await gate;
      return ok({ tags: ["업무"] });
    });

    const first = service.suggest(INPUT);
    const second = service.suggest(INPUT);
    expect(service.getState().status).toBe("running");
    release();

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(prompts).toHaveLength(1);
  });

  it("실행 중에는 reset이 상태를 지우지 않는다", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => { release = () => resolve(); });
    const { service } = build(async () => {
      await gate;
      return ok({ tags: ["업무"] });
    });

    const running = service.suggest(INPUT);
    service.reset();
    expect(service.getState().status).toBe("running");
    release();
    await running;

    service.reset();
    expect(service.getState().suggestion).toBeNull();
  });

  it("프로세스가 실패하면 사유를 남긴다", async () => {
    const { service } = build(async () => ({ ok: false, stdout: "", message: "시간 초과 (60초)" }));
    expect(await service.suggest(INPUT)).toBe(false);
    expect(service.getState()).toMatchObject({ status: "error", error: "시간 초과 (60초)" });
  });

  it("응답을 파싱하지 못하면 조용히 성공하지 않는다", async () => {
    const { service } = build(async () => ({ ok: true, stdout: "JSON이 아닌 출력", message: "" }));
    expect(await service.suggest(INPUT)).toBe(false);
    expect(service.getState().status).toBe("error");
    expect(service.getState().error).toContain("JSON");
  });

  it("러너가 던져도 상태로 흡수한다", async () => {
    const { service } = build(async () => { throw new Error("spawn 실패\n상세"); });
    expect(await service.suggest(INPUT)).toBe(false);
    expect(service.getState().error).toBe("spawn 실패");
  });

  it("꺼져 있거나 지원하지 않는 환경이면 실행 자체를 막는다", async () => {
    const disabled = build(async () => ok({}), { enabled: false });
    expect(await disabled.service.suggest(INPUT)).toBe(false);
    expect(disabled.prompts).toHaveLength(0);
    expect(disabled.service.isSupported()).toBe(false);

    const unsupported = build(async () => ok({}), {}, false);
    expect(await unsupported.service.suggest(INPUT)).toBe(false);
    expect(unsupported.prompts).toHaveLength(0);
  });

  it("기존 단계가 있으면 비평 모드로 돌고 steps를 덮어쓸 값이 오지 않는다", async () => {
    const { service, prompts } = build(async () => ok({
      steps: [],
      critique: ["1번이 닫히기 전엔 3번이 불가능하다"],
    }));

    await service.suggest({ ...INPUT, existingSteps: ["[실작업] 구현"] });

    expect(service.getState().mode).toBe("critique");
    expect(service.getState().suggestion?.steps).toEqual([]);
    expect(service.getState().suggestion?.critique).toHaveLength(1);
    expect(prompts[0]).toContain("이번 모드: 비평");
  });
});
