// AI 초안 서비스: `claude -p --output-format json` 을 헤드리스로 돌려 카드 필드
// 제안을 받아 온다. AI는 JSON만 뱉고 파일은 건드리지 않는다 — 적용은 UI가 고른
// 필드만 TaskService.updateTask 로 넘긴다 (ADR-0012).

import { buildDraftPrompt, draftMode, parseAiDraftResponse, type AiDraftSuggestion, type DraftPromptInput } from "../core/aiDraft";

export type AiDraftStatus = "idle" | "running" | "error";
export type AiDraftMode = "generate" | "critique";

export interface AiDraftState {
  status: AiDraftStatus;
  suggestion: AiDraftSuggestion | null;
  /** 마지막 실행 실패 사유. 성공하면 비운다. */
  error: string | null;
  /** running일 때 경과 밀리초 계산용 timestamp. */
  startedAt: number | null;
  /** 마지막 실행이 생성이었는지 비평이었는지. */
  mode: AiDraftMode;
  /** 과거 카드까지 뒤진 실행이었는지. */
  deep: boolean;
}

export interface AiDraftRunRequest {
  binary: string;
  prompt: string;
  cwd: string;
  timeoutMs: number;
  /** `--model` 로 넘길 값. 보통 "sonnet". */
  model: string;
  /** true면 파일 읽기 도구를 허용한다. */
  deep: boolean;
}

export interface AiDraftRunResult {
  ok: boolean;
  stdout: string;
  message: string;
}

export interface AiDraftRunner {
  isSupported(): boolean;
  run(request: AiDraftRunRequest): Promise<AiDraftRunResult>;
}

export interface AiDraftOptions {
  enabled: boolean;
  binary: string;
  cwd: string;
  model: string;
  timeoutMs: number;
}

/** 모달이 의존하는 최소 표면. */
export interface AiDraftController {
  isSupported(): boolean;
  getState(): AiDraftState;
  subscribe(listener: () => void): () => void;
  suggest(input: DraftPromptInput): Promise<boolean>;
  reset(): void;
}

const IDLE: AiDraftState = {
  status: "idle",
  suggestion: null,
  error: null,
  startedAt: null,
  mode: "generate",
  deep: false,
};

export class AiDraftService implements AiDraftController {
  private state: AiDraftState = IDLE;
  private readonly listeners = new Set<() => void>();
  private running: Promise<boolean> | null = null;

  constructor(
    private readonly runner: AiDraftRunner,
    private readonly options: () => AiDraftOptions,
    private readonly now: () => number = () => Date.now(),
  ) {}

  isSupported(): boolean {
    return this.options().enabled && this.runner.isSupported();
  }

  getState(): AiDraftState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 다른 카드를 열 때 이전 제안이 남아 있으면 안 된다. */
  reset(): void {
    if (this.running) return;
    this.state = IDLE;
    this.notify();
  }

  /** 이미 돌고 있으면 그 실행에 합류한다. */
  async suggest(input: DraftPromptInput): Promise<boolean> {
    if (this.running) return this.running;
    const options = this.options();
    if (!options.enabled || !this.runner.isSupported()) {
      this.patch({ status: "error", error: "AI 초안을 실행할 수 없는 환경입니다." });
      return false;
    }
    this.running = this.execute(options, input).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async execute(options: AiDraftOptions, input: DraftPromptInput): Promise<boolean> {
    const mode = draftMode(input.existingSteps);
    this.patch({
      status: "running",
      error: null,
      suggestion: null,
      startedAt: this.now(),
      mode,
      deep: input.deep,
    });

    let result: AiDraftRunResult;
    try {
      result = await this.runner.run({
        binary: options.binary,
        prompt: buildDraftPrompt(input),
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        model: options.model,
        deep: input.deep,
      });
    } catch (err) {
      result = { ok: false, stdout: "", message: describe(err) };
    }

    if (!result.ok) {
      this.patch({ status: "error", error: result.message || "실행에 실패했습니다.", startedAt: null });
      return false;
    }

    const parsed = parseAiDraftResponse(result.stdout);
    if (!parsed.ok || !parsed.suggestion) {
      this.patch({ status: "error", error: parsed.error ?? "응답을 읽지 못했습니다.", startedAt: null });
      return false;
    }

    this.patch({ status: "idle", suggestion: parsed.suggestion, error: null, startedAt: null });
    return true;
  }

  private patch(next: Partial<AiDraftState>): void {
    this.state = { ...this.state, ...next };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0]?.slice(0, 200) ?? "알 수 없는 오류";
}
