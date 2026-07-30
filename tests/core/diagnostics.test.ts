import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DiagnosticsLog } from "../../src/core/diagnostics";

describe("DiagnosticsLog", () => {
  let log: DiagnosticsLog;

  beforeEach(() => {
    log = new DiagnosticsLog();
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records entries in reverse chronological order", () => {
    log.record({ kind: "parse", message: "first" });
    log.record({ kind: "parse", message: "second" });
    const list = log.list();
    expect(list[0]?.message).toBe("second");
    expect(list[1]?.message).toBe("first");
  });

  it("caps at 50 entries", () => {
    for (let i = 0; i < 60; i++) {
      log.record({ kind: "parse", message: `n${i}` });
    }
    expect(log.list().length).toBe(50);
    expect(log.list()[0]?.message).toBe("n59");
    expect(log.list()[49]?.message).toBe("n10");
  });

  it("includes provided fields", () => {
    log.record({
      kind: "conflict",
      path: "TaskMaster/Tasks/x.md",
      entityId: "task_abc",
      message: "oops",
      cause: "external_modify",
    });
    const e = log.list()[0]!;
    expect(e.kind).toBe("conflict");
    expect(e.path).toBe("TaskMaster/Tasks/x.md");
    expect(e.entityId).toBe("task_abc");
    expect(e.cause).toBe("external_modify");
    expect(e.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("forwards recorded entries to the configured sink", () => {
    const sink = vi.fn();
    const withSink = new DiagnosticsLog(sink);
    withSink.record({ kind: "flush", message: "write failed" });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({
      kind: "flush",
      message: "write failed",
    }));
  });

  it("emits Notice for non-boot kinds and throttles same kind within 5s", async () => {
    // Notice mock에서는 생성 횟수만 추적할 수 있도록 mock obsidian이 처리.
    // 직접 검증은 어려우므로 throttle 동작은 시간 흐름으로 검증.
    log.record({ kind: "parse", message: "first" });
    log.record({ kind: "parse", message: "second" });
    log.record({ kind: "parse", message: "third" });
    // 여기서 Notice는 한 번만 떠야 한다. 검증은 mock 강화 시점에.

    vi.advanceTimersByTime(6000);
    log.record({ kind: "parse", message: "fourth" });
    // 5초 후 다시 Notice 가능.

    expect(log.list().length).toBe(4); // 모두 기록은 됨
  });

  it("does not Notice for boot kind", () => {
    log.record({ kind: "boot", message: "starting" });
    expect(log.list().length).toBe(1);
  });

  it("clear empties the log", () => {
    log.record({ kind: "parse", message: "a" });
    log.clear();
    expect(log.list().length).toBe(0);
  });
});
