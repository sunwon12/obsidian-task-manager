// AI 초안용 어댑터. 실행은 claudeProcess가 소유하고 여기서는 인자만 정한다.
//
// 리포트와 달리 파일을 쓰게 하지 않는다. 깊은 경로에서도 읽기 도구만 허용해
// AI가 카드 .md 를 직접 고치는 경로를 원천 차단한다 (ADR-0012 §1).

import { isClaudeSupported, runClaude } from "./claudeProcess";
import type { AiDraftRunner, AiDraftRunRequest, AiDraftRunResult } from "../services/AiDraftService";

const READ_ONLY_TOOLS = "Read,Grep,Glob";

export function createNodeAiDraftRunner(): AiDraftRunner {
  return {
    isSupported: isClaudeSupported,
    async run(request: AiDraftRunRequest): Promise<AiDraftRunResult> {
      const args = ["-p", request.prompt, "--output-format", "json"];
      if (request.model.trim()) args.push("--model", request.model.trim());
      if (request.deep) args.push("--allowedTools", READ_ONLY_TOOLS);
      const result = await runClaude({
        binary: request.binary,
        args,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
        label: "ai draft",
      });
      return { ok: result.ok, stdout: result.stdout, message: result.message };
    },
  };
}
