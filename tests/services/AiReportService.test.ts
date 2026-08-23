import { describe, expect, it, vi } from "vitest";
import {
  AiReportService,
  type AiReportOptions,
  type AiReportRunner,
  type AiReportSource,
} from "../../src/services/AiReportService";

const REPORT = (date: string): string =>
  `## ${date} (일)\n\n**스냅샷** — 상태 한 줄.\n\n- **리드** — 본문.\n\n**오늘의 하이라이트** — 30분.\n`;

function build(overrides: Partial<AiReportOptions> = {}) {
  let markdown: string | null = null;
  const runs: string[] = [];
  const runner: AiReportRunner = {
    isSupported: () => true,
    run: async (request) => {
      runs.push(request.prompt);
      markdown = REPORT("2026-08-23");
      return { ok: true, message: "" };
    },
  };
  const source: AiReportSource = { read: async () => markdown };
  const options: AiReportOptions = {
    enabled: true,
    binary: "claude",
    prompt: "/daily-schedule-feedback",
    cwd: "/vault",
    timeoutMs: 600_000,
    scheduleAt: "08:40",
    ...overrides,
  };
  return {
    runs,
    options,
    setMarkdown: (value: string | null) => { markdown = value; },
    service: (now: () => Date) => new AiReportService(runner, source, () => options, now),
    runner,
    source,
  };
}

describe("AiReportService", () => {
  it("실행이 끝나면 파일을 다시 읽어 리포트를 채운다", async () => {
    const harness = build();
    const service = harness.service(() => new Date("2026-08-23T10:00:00+09:00"));
    await expect(service.runNow()).resolves.toBe(true);
    expect(harness.runs).toEqual(["/daily-schedule-feedback"]);
    expect(service.getState().report?.date).toBe("2026-08-23");
    expect(service.getState().status).toBe("idle");
    expect(service.getState().error).toBeNull();
  });

  it("실행 중 재요청은 새 프로세스를 띄우지 않고 같은 실행에 합류한다", async () => {
    const harness = build();
    const service = harness.service(() => new Date("2026-08-23T10:00:00+09:00"));
    const [a, b] = await Promise.all([service.runNow(), service.runNow()]);
    expect([a, b]).toEqual([true, true]);
    expect(harness.runs).toHaveLength(1);
  });

  it("실패하면 사유를 남기고 status를 error로 둔다", async () => {
    const runner: AiReportRunner = {
      isSupported: () => true,
      run: async () => ({ ok: false, message: "claude 실행 파일을 찾지 못했습니다" }),
    };
    const service = new AiReportService(
      runner,
      { read: async () => null },
      () => ({ enabled: true, binary: "claude", prompt: "/x", cwd: "/vault", timeoutMs: 1000, scheduleAt: "" }),
      () => new Date("2026-08-23T10:00:00+09:00"),
    );
    await expect(service.runNow()).resolves.toBe(false);
    expect(service.getState().status).toBe("error");
    expect(service.getState().error).toContain("찾지 못했습니다");
  });

  it("예정 시각 전에는 자동 실행하지 않는다", async () => {
    const harness = build();
    const service = harness.service(() => new Date("2026-08-23T08:00:00+09:00"));
    await expect(service.runScheduledIfDue()).resolves.toBe(false);
    expect(harness.runs).toHaveLength(0);
  });

  it("예정 시각을 지났고 오늘 리포트가 없으면 하루 한 번만 실행한다", async () => {
    const harness = build();
    const service = harness.service(() => new Date("2026-08-23T09:00:00+09:00"));
    await expect(service.runScheduledIfDue()).resolves.toBe(true);
    // 같은 날 재확인은 이미 시도했으므로 다시 돌리지 않는다.
    await expect(service.runScheduledIfDue()).resolves.toBe(false);
    expect(harness.runs).toHaveLength(1);
  });

  it("오늘 리포트가 이미 있으면 자동 실행을 건너뛴다", async () => {
    const harness = build();
    harness.setMarkdown(REPORT("2026-08-23"));
    const service = harness.service(() => new Date("2026-08-23T09:00:00+09:00"));
    await expect(service.runScheduledIfDue()).resolves.toBe(false);
    expect(harness.runs).toHaveLength(0);
  });

  it("자동 실행 시각이 비어 있으면 버튼으로만 돈다", async () => {
    const harness = build({ scheduleAt: "" });
    const service = harness.service(() => new Date("2026-08-23T23:00:00+09:00"));
    await expect(service.runScheduledIfDue()).resolves.toBe(false);
    expect(harness.runs).toHaveLength(0);
  });

  it("기능을 끄면 isSupported가 false이고 실행 요청은 오류로 끝난다", async () => {
    const harness = build({ enabled: false });
    const service = harness.service(() => new Date("2026-08-23T10:00:00+09:00"));
    expect(service.isSupported()).toBe(false);
    await expect(service.runNow()).resolves.toBe(false);
    expect(harness.runs).toHaveLength(0);
  });

  it("상태가 바뀌면 구독자에게 알린다", async () => {
    const harness = build();
    const service = harness.service(() => new Date("2026-08-23T10:00:00+09:00"));
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    await service.runNow();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    await service.refresh();
    expect(listener).not.toHaveBeenCalled();
  });
});
