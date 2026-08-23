// AI 리포트용 어댑터. 실행 자체는 claudeProcess가 소유하고 여기서는 인자만 정한다.
// 리포트는 스킬이 vault에 Markdown을 쓰는 방식이라 stdout을 쓰지 않는다.

import { isClaudeSupported, runClaude } from "./claudeProcess";
import type { AiReportRunner, AiReportRunRequest, AiReportRunResult } from "../services/AiReportService";

export function createNodeAiReportRunner(): AiReportRunner {
  return {
    isSupported: isClaudeSupported,
    async run(request: AiReportRunRequest): Promise<AiReportRunResult> {
      const result = await runClaude({
        binary: request.binary,
        args: ["-p", request.prompt, "--permission-mode", "acceptEdits"],
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
        label: "ai report",
      });
      return { ok: result.ok, message: result.message };
    },
  };
}
