// AI 리포트 서비스: `claude -p "<스킬>"`을 헤드리스로 돌리고, 스킬이 vault에 남긴
// Markdown을 읽어 패널이 그릴 상태로 보관한다.
//
// 왜 플러그인이 스케줄까지 갖는가: launchd 잡은 ~/Desktop 아래 스크립트를 실행하지
// 못해(TCC) 조용히 죽어 있었다. Obsidian은 이미 vault 접근 권한이 있고 실행 중이므로,
// 여기서 돌리면 실패가 패널에 그대로 보인다.

import { isReportForDay, parseAiReport, toLocalDate, type AiReport } from "../core/aiReport";

export type AiReportStatus = "idle" | "running" | "error";

export interface AiReportState {
  status: AiReportStatus;
  report: AiReport | null;
  /** 마지막 실행 실패 사유. 성공하면 비운다. */
  error: string | null;
  /** running일 때 경과 밀리초 계산용 timestamp. */
  startedAt: number | null;
}

export interface AiReportRunRequest {
  /** claude 실행 파일 경로 또는 이름. */
  binary: string;
  /** `-p` 로 넘길 프롬프트. 보통 "/daily-schedule-feedback". */
  prompt: string;
  /** vault 루트 절대 경로. 스킬이 상대 경로로 파일을 찾는다. */
  cwd: string;
  timeoutMs: number;
}

export interface AiReportRunResult {
  ok: boolean;
  /** 실패 사유 한 줄. ok면 무시한다. */
  message: string;
}

export interface AiReportRunner {
  isSupported(): boolean;
  run(request: AiReportRunRequest): Promise<AiReportRunResult>;
}

/** 스킬이 기록한 Markdown을 읽는다. 파일이 없으면 null. */
export interface AiReportSource {
  read(): Promise<string | null>;
}

export interface AiReportOptions {
  enabled: boolean;
  binary: string;
  prompt: string;
  cwd: string;
  timeoutMs: number;
  /** 자동 실행 시각 "HH:MM". 빈 문자열이면 자동 실행하지 않는다. */
  scheduleAt: string;
}

/** 패널이 의존하는 최소 표면 — UI는 서비스 구현을 몰라도 된다. */
export interface AiReportController {
  isSupported(): boolean;
  getState(): AiReportState;
  subscribe(listener: () => void): () => void;
  run(): void;
}

const SCHEDULE_PATTERN = /^(\d{1,2}):(\d{2})$/;

export class AiReportService implements AiReportController {
  private state: AiReportState = { status: "idle", report: null, error: null, startedAt: null };
  private readonly listeners = new Set<() => void>();
  private running: Promise<boolean> | null = null;
  /** 실패해도 하루에 한 번만 자동 시도한다. */
  private lastAutoAttempt: string | null = null;

  constructor(
    private readonly runner: AiReportRunner,
    private readonly source: AiReportSource,
    private readonly options: () => AiReportOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  isSupported(): boolean {
    return this.options().enabled && this.runner.isSupported();
  }

  getState(): AiReportState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 파일만 다시 읽는다(실행 없음). 플러그인 로드·패널 오픈 시 호출. */
  async refresh(): Promise<void> {
    try {
      const report = parseAiReport(await this.source.read());
      this.patch({ report });
    } catch (err) {
      this.patch({ error: describe(err) });
    }
  }

  /** 이미 돌고 있으면 그 실행에 합류한다. */
  async runNow(): Promise<boolean> {
    if (this.running) return this.running;
    const options = this.options();
    if (!options.enabled || !this.runner.isSupported()) {
      this.patch({ status: "error", error: "AI 리포트를 실행할 수 없는 환경입니다." });
      return false;
    }
    this.running = this.execute(options).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  run(): void {
    void this.runNow();
  }

  /**
   * 자동 실행: 오늘 리포트가 없고 예정 시각을 지났을 때 하루 한 번.
   * 패널을 열어 둘 필요 없이 플러그인 타이머가 부른다.
   */
  async runScheduledIfDue(): Promise<boolean> {
    const options = this.options();
    if (!options.enabled) return false;
    const minutes = parseSchedule(options.scheduleAt);
    if (minutes == null) return false;
    const now = this.now();
    const today = toLocalDate(now);
    if (this.lastAutoAttempt === today) return false;
    if (now.getHours() * 60 + now.getMinutes() < minutes) return false;
    if (this.state.report == null) await this.refresh();
    if (isReportForDay(this.state.report, now)) {
      this.lastAutoAttempt = today;
      return false;
    }
    this.lastAutoAttempt = today;
    return this.runNow();
  }

  private async execute(options: AiReportOptions): Promise<boolean> {
    this.patch({ status: "running", error: null, startedAt: this.now().getTime() });
    let result: AiReportRunResult;
    try {
      result = await this.runner.run({
        binary: options.binary,
        prompt: options.prompt,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
      });
    } catch (err) {
      result = { ok: false, message: describe(err) };
    }
    await this.refresh();
    this.patch({
      status: result.ok ? "idle" : "error",
      error: result.ok ? null : result.message,
      startedAt: null,
    });
    return result.ok;
  }

  private patch(next: Partial<AiReportState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
}

function parseSchedule(value: string): number | null {
  const match = SCHEDULE_PATTERN.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0]?.slice(0, 200) ?? "알 수 없는 오류";
}
