import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeAiDraftRunner } from "../../src/integration/aiDraftRunner";
import { createNodeAiReportRunner } from "../../src/integration/aiReportRunner";
import { isClaudeSupported } from "../../src/integration/claudeProcess";

type Listener = (payload: never) => void;

interface SpawnCall {
  command: string;
  args: string[];
  options: { cwd: string; env: Record<string, string | undefined> };
}

/**
 * Electron 렌더러의 window.require를 흉내 낸다. 이 어댑터는 실기기에서만 도는
 * 코드라 자동 검증이 없었는데, 인자 한 글자가 틀려도 조용히 실패한다.
 */
function stubChildProcess() {
  const calls: SpawnCall[] = [];
  const handlers = {
    stdout: [] as Listener[],
    stderr: [] as Listener[],
    error: [] as Listener[],
    close: [] as Listener[],
  };
  const killed: string[] = [];
  const child = {
    stdout: { on: (_: "data", fn: Listener) => handlers.stdout.push(fn) },
    stderr: { on: (_: "data", fn: Listener) => handlers.stderr.push(fn) },
    on: (event: "error" | "close", fn: Listener) => handlers[event].push(fn),
    kill: (signal?: string) => killed.push(signal ?? "SIGTERM"),
  };
  const module = {
    spawn: (command: string, args: string[], options: SpawnCall["options"]) => {
      calls.push({ command, args, options });
      return child;
    },
  };
  const previous = (window as Window & { require?: unknown }).require;
  (window as Window & { require?: unknown }).require = (id: string) =>
    id === "child_process" ? module : null;

  return {
    calls,
    killed,
    emit(channel: keyof typeof handlers, payload: unknown): void {
      for (const fn of handlers[channel]) fn(payload as never);
    },
    restore(): void {
      (window as Window & { require?: unknown }).require = previous;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("claude 실행 어댑터", () => {
  it("child_process를 못 얻으면 지원하지 않는다고 답한다", () => {
    const previous = (window as Window & { require?: unknown }).require;
    (window as Window & { require?: unknown }).require = undefined;
    expect(isClaudeSupported()).toBe(false);
    (window as Window & { require?: unknown }).require = previous;
  });

  it("AI 초안은 JSON 출력을 요구하고 깊은 경로에서만 읽기 도구를 연다", async () => {
    const stub = stubChildProcess();
    try {
      const runner = createNodeAiDraftRunner();
      expect(runner.isSupported()).toBe(true);

      const fast = runner.run({
        binary: "claude", prompt: "P", cwd: "/vault", timeoutMs: 1000, model: "sonnet", deep: false,
      });
      stub.emit("stdout", "{\"ok\":1}");
      stub.emit("close", 0);
      await expect(fast).resolves.toMatchObject({ ok: true, stdout: "{\"ok\":1}" });

      expect(stub.calls[0]?.args).toEqual(["-p", "P", "--output-format", "json", "--model", "sonnet"]);
      expect(stub.calls[0]?.options.cwd).toBe("/vault");
      // 파일을 쓰는 권한 모드가 절대 붙지 않는다 (ADR-0012 §1).
      expect(stub.calls[0]?.args).not.toContain("--permission-mode");

      const deep = runner.run({
        binary: "claude", prompt: "P", cwd: "/vault", timeoutMs: 1000, model: "", deep: true,
      });
      stub.emit("close", 0);
      await deep;
      expect(stub.calls[1]?.args).toEqual(["-p", "P", "--output-format", "json", "--allowedTools", "Read,Grep,Glob"]);
    } finally {
      stub.restore();
    }
  });

  it("AI 리포트 인자는 리팩터링 전과 같다", async () => {
    const stub = stubChildProcess();
    try {
      const run = createNodeAiReportRunner().run({
        binary: "/opt/claude", prompt: "/daily-schedule-feedback", cwd: "/vault", timeoutMs: 1000,
      });
      stub.emit("close", 0);
      await expect(run).resolves.toEqual({ ok: true, message: "" });
      expect(stub.calls[0]?.command).toBe("/opt/claude");
      expect(stub.calls[0]?.args).toEqual([
        "-p", "/daily-schedule-feedback", "--permission-mode", "acceptEdits",
      ]);
    } finally {
      stub.restore();
    }
  });

  it("PATH 앞에 사용자 bin 경로를 붙인다 — GUI로 뜬 Obsidian은 claude를 못 찾는다", async () => {
    const stub = stubChildProcess();
    try {
      const run = createNodeAiReportRunner().run({
        binary: "claude", prompt: "P", cwd: "/vault", timeoutMs: 1000,
      });
      stub.emit("close", 0);
      await run;
      const path = stub.calls[0]?.options.env["PATH"] ?? "";
      expect(path).toContain("/opt/homebrew/bin");
      expect(path).toContain("/usr/local/bin");
      expect(path.split(":")[0]).toContain(".local/bin");
    } finally {
      stub.restore();
    }
  });

  it("실행 파일을 못 찾으면 경로를 담은 사유를 남긴다", async () => {
    const stub = stubChildProcess();
    try {
      const run = createNodeAiDraftRunner().run({
        binary: "claude", prompt: "P", cwd: "/vault", timeoutMs: 1000, model: "sonnet", deep: false,
      });
      stub.emit("error", new Error("spawn claude ENOENT"));
      await expect(run).resolves.toMatchObject({
        ok: false,
        message: "claude 실행 파일을 찾지 못했습니다 (claude)",
      });
    } finally {
      stub.restore();
    }
  });

  it("비정상 종료는 stderr 마지막 줄을 사유로 쓴다", async () => {
    const stub = stubChildProcess();
    try {
      const run = createNodeAiDraftRunner().run({
        binary: "claude", prompt: "P", cwd: "/vault", timeoutMs: 1000, model: "sonnet", deep: false,
      });
      stub.emit("stderr", "warning: something\nCredit balance too low\n");
      stub.emit("close", 1);
      await expect(run).resolves.toMatchObject({ ok: false, message: "Credit balance too low" });
    } finally {
      stub.restore();
    }
  });

  it("시간이 넘으면 프로세스를 죽이고 초 단위 사유를 남긴다", async () => {
    vi.useFakeTimers();
    const stub = stubChildProcess();
    try {
      const run = createNodeAiDraftRunner().run({
        binary: "claude", prompt: "P", cwd: "/vault", timeoutMs: 180_000, model: "sonnet", deep: true,
      });
      await vi.advanceTimersByTimeAsync(180_001);
      await expect(run).resolves.toMatchObject({ ok: false, message: "시간 초과 (180초)" });
      expect(stub.killed).toEqual(["SIGTERM"]);
    } finally {
      stub.restore();
    }
  });
});
