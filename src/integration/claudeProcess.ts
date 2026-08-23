// `claude` CLI 를 Obsidian 렌더러(Electron)에서 헤드리스로 돌리는 공통 어댑터.
// Obsidian이 GUI로 뜨면 PATH가 /usr/bin:/bin 수준이라 `claude`를 못 찾는다.
// 그래서 실행 전에 사용자 bin 경로를 PATH 앞에 붙인다(run.sh와 같은 목록).
//
// AI 리포트와 AI 초안이 같은 실행 경로를 쓰되 인자와 출력 처리만 다르다.

import { debugLog } from "../ui/timer/debugLog";

const EXTRA_PATHS = ["/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"] as const;
/** stdout 전체를 보관하되 폭주는 막는다 — JSON 응답은 이 안에 넉넉히 들어간다. */
const MAX_STDOUT = 1_000_000;
const ERROR_TAIL = 4000;

interface ChildProcessLike {
  stdout?: { on(event: "data", listener: (chunk: unknown) => void): void } | null;
  stderr?: { on(event: "data", listener: (chunk: unknown) => void): void } | null;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
  kill(signal?: string): void;
}

interface ChildProcessModule {
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string | undefined> },
  ): ChildProcessLike;
}

export interface ClaudeRunRequest {
  /** claude 실행 파일 경로 또는 이름. */
  binary: string;
  args: string[];
  /** vault 루트 절대 경로. */
  cwd: string;
  timeoutMs: number;
  /** 로그 접두어 — 어느 기능이 돌렸는지 구분한다. */
  label: string;
}

export interface ClaudeRunResult {
  ok: boolean;
  /** 성공했을 때의 표준 출력 전체(상한까지). */
  stdout: string;
  /** 실패 사유 한 줄. ok면 빈 문자열. */
  message: string;
}

function resolveModule<T>(id: string): T | null {
  try {
    const req = (window as Window & { require?: (name: string) => unknown }).require;
    if (typeof req !== "function") return null;
    return req(id) as T;
  } catch {
    return null;
  }
}

function buildEnv(): Record<string, string | undefined> {
  const env = { ...(globalThis.process?.env ?? {}) } as Record<string, string | undefined>;
  const home = env["HOME"] ?? "";
  const extras = EXTRA_PATHS.map((suffix) => (suffix.startsWith("/.") ? `${home}${suffix}` : suffix));
  const current = env["PATH"] ?? "/usr/bin:/bin";
  const merged = [...extras, ...current.split(":")].filter((entry, index, all) =>
    entry.length > 0 && all.indexOf(entry) === index,
  );
  env["PATH"] = merged.join(":");
  return env;
}

export function isClaudeSupported(): boolean {
  const module = resolveModule<ChildProcessModule>("child_process");
  if (!module) debugLog("claude: child_process unavailable");
  return module != null;
}

export function runClaude(request: ClaudeRunRequest): Promise<ClaudeRunResult> {
  const child_process = resolveModule<ChildProcessModule>("child_process");
  if (!child_process) {
    return Promise.resolve({ ok: false, stdout: "", message: "child_process를 사용할 수 없습니다." });
  }
  debugLog(`${request.label} run: ${request.binary} ${request.args.join(" ")} cwd=${request.cwd}`);
  return new Promise<ClaudeRunResult>((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const finish = (result: ClaudeRunResult): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      debugLog(`${request.label} done ok=${String(result.ok)} ${result.message}`);
      resolve(result);
    };

    let child: ChildProcessLike;
    try {
      child = child_process.spawn(request.binary, request.args, {
        cwd: request.cwd,
        env: buildEnv(),
      });
    } catch (err) {
      finish({ ok: false, stdout: "", message: err instanceof Error ? err.message : String(err) });
      return;
    }

    const timeout = window.setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* 이미 죽은 프로세스는 무시한다. */
      }
      finish({
        ok: false,
        stdout,
        message: `시간 초과 (${Math.round(request.timeoutMs / 1000)}초)`,
      });
    }, request.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      if (stdout.length < MAX_STDOUT) stdout = `${stdout}${String(chunk)}`.slice(0, MAX_STDOUT);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-ERROR_TAIL);
    });
    child.on("error", (err) => {
      const hint = /ENOENT/u.test(err.message)
        ? `claude 실행 파일을 찾지 못했습니다 (${request.binary})`
        : err.message;
      finish({ ok: false, stdout, message: hint });
    });
    child.on("close", (code) => {
      if (code === 0) finish({ ok: true, stdout, message: "" });
      else {
        const reason = lastLine(stderr) || lastLine(stdout) || `종료 코드 ${String(code)}`;
        finish({ ok: false, stdout, message: reason });
      }
    });
  });
}

function lastLine(output: string): string {
  const lines = output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1]!.slice(0, 200) : "";
}
