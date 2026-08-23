// `claude -p` 를 Obsidian 렌더러(Electron)에서 헤드리스로 실행하는 어댑터.
// Obsidian이 GUI로 뜨면 PATH가 /usr/bin:/bin 수준이라 `claude`를 못 찾는다.
// 그래서 실행 전에 사용자 bin 경로를 PATH 앞에 붙인다(run.sh와 같은 목록).

import { debugLog } from "../ui/timer/debugLog";
import type { AiReportRunner, AiReportRunRequest, AiReportRunResult } from "../services/AiReportService";

const EXTRA_PATHS = ["/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"] as const;
const OUTPUT_TAIL = 4000;

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

export function createNodeAiReportRunner(): AiReportRunner {
  return {
    isSupported(): boolean {
      const module = resolveModule<ChildProcessModule>("child_process");
      if (!module) debugLog("ai report: child_process unavailable");
      return module != null;
    },
    run(request: AiReportRunRequest): Promise<AiReportRunResult> {
      const child_process = resolveModule<ChildProcessModule>("child_process");
      if (!child_process) {
        return Promise.resolve({ ok: false, message: "child_process를 사용할 수 없습니다." });
      }
      const args = ["-p", request.prompt, "--permission-mode", "acceptEdits"];
      debugLog(`ai report run: ${request.binary} ${args.join(" ")} cwd=${request.cwd}`);
      return new Promise<AiReportRunResult>((resolve) => {
        let settled = false;
        let output = "";
        const finish = (result: AiReportRunResult): void => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          debugLog(`ai report done ok=${String(result.ok)} ${result.message}`);
          resolve(result);
        };

        let child: ChildProcessLike;
        try {
          child = child_process.spawn(request.binary, args, {
            cwd: request.cwd,
            env: buildEnv(),
          });
        } catch (err) {
          finish({ ok: false, message: err instanceof Error ? err.message : String(err) });
          return;
        }

        const timeout = window.setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            /* 이미 죽은 프로세스는 무시한다. */
          }
          finish({ ok: false, message: `시간 초과 (${Math.round(request.timeoutMs / 1000)}초)` });
        }, request.timeoutMs);

        const collect = (chunk: unknown): void => {
          output = `${output}${String(chunk)}`.slice(-OUTPUT_TAIL);
        };
        child.stdout?.on("data", collect);
        child.stderr?.on("data", collect);
        child.on("error", (err) => {
          const hint = /ENOENT/u.test(err.message)
            ? `claude 실행 파일을 찾지 못했습니다 (${request.binary})`
            : err.message;
          finish({ ok: false, message: hint });
        });
        child.on("close", (code) => {
          if (code === 0) finish({ ok: true, message: "" });
          else finish({ ok: false, message: lastLine(output) || `종료 코드 ${String(code)}` });
        });
      });
    },
  };
}

function lastLine(output: string): string {
  const lines = output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1]!.slice(0, 200) : "";
}
