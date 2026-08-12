// T-901 (task_01KZN31H): DOING 타이머 알림 배너 — 서비스 레이어.
//
// 요구사항 출처: TaskMaster 카드 "옵시디언 일정 플래닝 플러그인 수정하기" +
// 2026-08-10 대화(맥북 슬랙 알림창 스타일: 직사각형 스택, 스와이프 닫기, 정지/스탑 버튼,
// 스탑 시 actualMd 기록). 스펙: tests/services/TaskTimerService.test.ts (R1~R22).
//
// 설계:
// - EventBus 구독으로 DOING 진입/이탈 감지. doing→doing 필드 수정은 타이머를 건드리지 않는다.
// - 시간은 wall-clock anchor(runningSince) + accumulatedMs 누적 방식으로 계산한다.
//   setInterval로 세지 않으므로 macOS 잠자기·탭 스로틀링에 영향받지 않는다.
// - stop()은 TaskService.updateTask 한 번으로 done 이동 + actualMd 기록을 원자적으로 처리.
//   task:updated(doing→done) 이벤트가 돌아오면서 타이머가 제거된다.
// - dismiss()(스와이프)는 배너만 숨기고 추적은 유지한다. doing 이탈 시 함께 정리.
// - 모든 변이 후 persistence.save() (fire-and-forget) → Obsidian 재시작 복원.
// - services 존 규칙: react/obsidian import 금지. persistence는 port로 역전시켜
//   main.ts에서 vault 파일(.timers.json) 어댑터를 주입한다.

import type { EventBus } from "../core/eventBus";
import type { TaskMasterStore } from "../store/taskMasterStore";
import type { Task, TaskId, TaskMasterEvent, UpdateTaskInput } from "../core/types";
import type { TaskService } from "./TaskService";

export type TimerPhase = "idle" | "running" | "paused";

export interface TaskTimerSnapshot {
  taskId: TaskId;
  /** 배너에 표시할 태스크 제목 (store에서 derive). */
  title: string;
  /** 태스크에 미리 입력한 작업 계획. */
  steps: string[];
  /** 1-based 현재 단계. */
  currentStep: number | null;
  /** 각 단계의 실시간 누적 측정값(ms). steps와 같은 index. */
  stepElapsedMs: number[];
  phase: TimerPhase;
  /** 호출 시점 기준 누적 측정 시간(ms). running이면 실시간 계산값. */
  elapsedMs: number;
  /** 스와이프로 배너를 숨겼는지. 숨겨도 추적은 계속된다. */
  dismissed: boolean;
  /** DOING 진입 시각(epoch ms). 스택 정렬 기준 — 최신이 위. */
  enteredDoingAt: number;
}

export interface PersistedTimer {
  taskId: string;
  phase: TimerPhase;
  accumulatedMs: number;
  /** running이었다면 마지막 running 구간의 시작 epoch ms, 아니면 null. */
  runningSince: number | null;
  /** v0.6+: 단계별 누적 시간. 이전 저장 파일 호환을 위해 optional. */
  stepAccumulatedMs?: number[];
  activeStep?: number | null;
  stepRunningSince?: number | null;
  dismissed: boolean;
  enteredDoingAt: number;
}

/** main.ts에서 vault 파일(.timers.json) 어댑터로 구현해 주입한다. */
export interface TimerPersistencePort {
  load(): Promise<PersistedTimer[]>;
  save(timers: PersistedTimer[]): Promise<void>;
}

/** UI 배너 경과 시간 갱신 주기. */
export const TIMER_TICK_MS = 1000;
/** 이 거리(px) 이상 오른쪽으로 밀면 배너 dismiss (맥 알림과 동일 방향). */
export const SWIPE_DISMISS_THRESHOLD_PX = 80;

/**
 * "MM:SS", 1시간 이상이면 "H:MM:SS".
 * 예: 0 → "00:00", 61_000 → "01:01", 3_661_000 → "1:01:01".
 */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 1 MD = 8시간 (Task.actualMd·estimateMd와 동일 단위). */
export const MS_PER_MD = 8 * 60 * 60 * 1000;

/**
 * 측정 시간(ms) → MD 환산. 소수 둘째 자리 반올림하되,
 * 측정이 0보다 크면 최소 0.01을 보장한다 (짧은 세션이 0으로 증발하지 않게).
 * 예: 8h → 1, 4h → 0.5, 1h → 0.13, 2분 → 0.01, 0 → 0.
 */
export function elapsedMsToMd(ms: number): number {
  if (ms <= 0) return 0;
  const md = Math.round((ms / MS_PER_MD) * 100) / 100;
  return Math.max(md, 0.01);
}

interface TimerInternal {
  taskId: TaskId;
  phase: TimerPhase;
  accumulatedMs: number;
  runningSince: number | null;
  stepAccumulatedMs: number[];
  activeStep: number | null;
  stepRunningSince: number | null;
  dismissed: boolean;
  enteredDoingAt: number;
  /** enteredDoingAt이 같을 때(같은 ms에 연속 생성) 최신 판별용 단조 증가 번호. */
  seq: number;
}

export class TaskTimerService {
  private readonly timers = new Map<TaskId, TimerInternal>();
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private seqCounter = 0;
  private persistQueue: Promise<void> = Promise.resolve();
  private lifecycleFlush: Promise<void> | null = null;

  constructor(
    private readonly events: EventBus,
    private readonly store: TaskMasterStore,
    private readonly tasks: TaskService,
    private readonly persistence: TimerPersistencePort,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * persisted 복원 + store 대조(reconcile) + EventBus 구독.
   * store에 doing인데 타이머가 없으면 idle로 생성, doing이 아닌 저장분은 버린다.
   */
  async init(): Promise<void> {
    let persisted: PersistedTimer[] = [];
    try {
      persisted = await this.persistence.load();
    } catch (err) {
      console.error("[TaskMaster] timer state load failed", err);
    }

    const state = this.store.getState();
    for (const p of persisted) {
      const task = state.tasks.get(p.taskId as TaskId);
      if (!task || task.status !== "doing" || task.archivedAt) continue;
      const stepCount = task.steps?.length ?? 0;
      const activeStep = validStep(task.currentStep, stepCount);
      const storedStepMs = normalizeStepMs(task.stepSeconds?.map((seconds) => seconds * 1000), stepCount);
      const persistedStepMs = normalizeStepMs(p.stepAccumulatedMs, stepCount);
      this.timers.set(task.id, {
        taskId: task.id,
        phase: p.phase,
        accumulatedMs: p.accumulatedMs,
        runningSince: p.phase === "running" ? (p.runningSince ?? this.now()) : null,
        stepAccumulatedMs: mergeStepMs(storedStepMs, persistedStepMs),
        activeStep,
        stepRunningSince: p.phase === "running" && activeStep != null
          ? (p.activeStep === activeStep ? (p.stepRunningSince ?? p.runningSince ?? this.now()) : this.now())
          : null,
        dismissed: p.dismissed,
        enteredDoingAt: p.enteredDoingAt,
        seq: this.seqCounter++,
      });
    }
    this.reconcile([...state.tasks.values()]);

    this.unsubscribe = this.events.subscribe((e) => this.onEvent(e));
    this.notify();
    this.persist();
  }

  /** EventBus 구독 해제. plugin onunload에서 호출. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
  }

  /**
   * Obsidian 종료·리로드 직전 체크포인트.
   *
   * running 구간을 현재 시각까지 누적값으로 확정한 뒤 `.timers.json`을 먼저 저장하고,
   * 단계별 초를 task frontmatter에도 반영한다. phase는 running으로 유지하므로 다음 로드에서
   * 기존 복원 규칙대로 이어지며, 사용자가 Stop을 누른 것처럼 DONE 처리되지는 않는다.
   */
  flushForShutdown(): Promise<void> {
    if (this.lifecycleFlush) return this.lifecycleFlush;
    const operation = this.performLifecycleFlush();
    this.lifecycleFlush = operation.finally(() => {
      this.lifecycleFlush = null;
    });
    return this.lifecycleFlush;
  }

  /** 타이머 목록 변경 알림 구독. dispose 함수를 반환한다. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** dismissed 포함 전체. 최신 DOING 진입이 먼저(= 스택 상단). */
  getTimers(): TaskTimerSnapshot[] {
    return [...this.timers.values()]
      .sort((a, b) =>
        b.enteredDoingAt !== a.enteredDoingAt
          ? b.enteredDoingAt - a.enteredDoingAt
          : b.seq - a.seq,
      )
      .map((t) => this.toSnapshot(t));
  }

  getTimer(taskId: TaskId): TaskTimerSnapshot | null {
    const t = this.timers.get(taskId);
    return t ? this.toSnapshot(t) : null;
  }

  /** idle·paused → running. running이면 no-op (앵커를 리셋하지 않는다). */
  start(taskId: TaskId): void {
    const t = this.timers.get(taskId);
    if (!t || t.phase === "running") return;
    t.phase = "running";
    const now = this.now();
    t.runningSince = now;
    const task = this.store.getState().tasks.get(taskId);
    t.activeStep = validStep(task?.currentStep, task?.steps?.length ?? 0);
    t.stepRunningSince = t.activeStep != null ? now : null;
    this.notify();
    this.persist();
  }

  /** running → paused (경과 동결). idle·paused면 no-op. */
  pause(taskId: TaskId): void {
    const t = this.timers.get(taskId);
    if (!t || t.phase !== "running") return;
    const now = this.now();
    t.accumulatedMs = this.elapsedOf(t, now);
    this.captureActiveStep(t, now);
    t.runningSince = null;
    t.phase = "paused";
    this.notify();
    this.persist();
    void this.saveStepSeconds(taskId);
  }

  /** 배너에서 단계를 고르면 task frontmatter의 currentStep도 즉시 갱신한다. */
  async selectStep(taskId: TaskId, step: number): Promise<void> {
    const timer = this.timers.get(taskId);
    const task = this.store.getState().tasks.get(taskId);
    const stepCount = task?.steps?.length ?? 0;
    if (!timer || !task || !Number.isInteger(step) || step < 1 || step > stepCount) return;
    if (task.currentStep === step) return;
    this.switchActiveStep(timer, step, this.now());
    this.notify();
    this.persist();
    await this.tasks.updateTask(taskId, {
      currentStep: step,
      stepSeconds: this.stepSecondsOf(timer, stepCount),
    });
  }

  /**
   * 추적 종료 + 측정 시간을 MD로 환산해 actualMd에 기록(기존 값에 합산)
   * + 태스크를 done으로 이동 + 타이머 제거. 측정 0이면 actualMd 미변경.
   */
  async stop(taskId: TaskId): Promise<void> {
    const t = this.timers.get(taskId);
    if (!t) return;
    const task = this.store.getState().tasks.get(taskId);
    if (!task) {
      this.remove(taskId);
      return;
    }

    const now = this.now();
    const elapsedMs = this.elapsedOf(t, now);
    if (t.phase === "running") this.captureActiveStep(t, now);
    const md = elapsedMsToMd(elapsedMs);
    const input: UpdateTaskInput = {
      status: "done",
      stepSeconds: this.stepSecondsOf(t, task.steps?.length ?? 0),
    };
    if (md > 0) {
      input.actualMd = Math.round(((task.actualMd ?? 0) + md) * 100) / 100;
    }
    // doing→done task:updated 이벤트가 onEvent에서 타이머를 제거한다.
    await this.tasks.updateTask(taskId, input);
    // 이벤트 경로가 막힌 경우(예: 이미 done이던 태스크)의 안전망.
    if (this.timers.has(taskId)) this.remove(taskId);
  }

  /** 스와이프 닫기: 배너만 숨기고(dismissed=true) 추적은 유지. */
  dismiss(taskId: TaskId): void {
    const t = this.timers.get(taskId);
    if (!t || t.dismissed) return;
    t.dismissed = true;
    this.notify();
    this.persist();
  }

  /** dismiss 취소: 숨긴 배너를 다시 표시한다 (메뉴바에서 사용). */
  restore(taskId: TaskId): void {
    const t = this.timers.get(taskId);
    if (!t || !t.dismissed) return;
    t.dismissed = false;
    this.notify();
    this.persist();
  }

  // ---------- internals ----------

  private onEvent(e: TaskMasterEvent): void {
    switch (e.type) {
      case "task:created":
        if (e.task.status === "doing") this.ensureTimer(e.task.id);
        break;
      case "task:updated": {
        const was = e.previous.status === "doing";
        const is = e.task.status === "doing";
        if (!was && is) this.ensureTimer(e.task.id);
        else if (was && !is) this.remove(e.task.id);
        else if (is) {
          const timer = this.timers.get(e.task.id);
          if (timer) {
            const stepCount = e.task.steps?.length ?? 0;
            timer.stepAccumulatedMs = mergeStepMs(
              normalizeStepMs(timer.stepAccumulatedMs, stepCount),
              normalizeStepMs(e.task.stepSeconds?.map((seconds) => seconds * 1000), stepCount),
            );
            const nextStep = validStep(e.task.currentStep, stepCount);
            const changedStep = timer.activeStep !== nextStep;
            if (changedStep) this.switchActiveStep(timer, nextStep, this.now());
            this.notify();
            this.persist();
            if (changedStep) void this.saveStepSeconds(e.task.id);
          }
        }
        break;
      }
      case "task:deleted":
      case "task:archived":
        this.remove(e.taskId);
        break;
      case "tasks:indexed":
        this.reconcile(e.tasks);
        this.notify();
        this.persist();
        break;
      default:
        break;
    }
  }

  /** doing 목록과 타이머 목록의 drift 보정. 있는 타이머는 건드리지 않는다. */
  private reconcile(tasks: Task[]): void {
    const doingIds = new Set(
      tasks.filter((t) => t.status === "doing" && !t.archivedAt).map((t) => t.id),
    );
    for (const id of [...this.timers.keys()]) {
      if (!doingIds.has(id)) this.timers.delete(id);
    }
    for (const id of doingIds) {
      if (!this.timers.has(id)) this.createTimer(id);
    }
  }

  private ensureTimer(taskId: TaskId): void {
    if (this.timers.has(taskId)) return;
    this.createTimer(taskId);
    this.notify();
    this.persist();
  }

  private createTimer(taskId: TaskId): void {
    const task = this.store.getState().tasks.get(taskId);
    const stepCount = task?.steps?.length ?? 0;
    this.timers.set(taskId, {
      taskId,
      phase: "idle",
      accumulatedMs: 0,
      runningSince: null,
      stepAccumulatedMs: normalizeStepMs(
        task?.stepSeconds?.map((seconds) => seconds * 1000),
        stepCount,
      ),
      activeStep: validStep(task?.currentStep, stepCount),
      stepRunningSince: null,
      dismissed: false,
      enteredDoingAt: this.now(),
      seq: this.seqCounter++,
    });
  }

  private remove(taskId: TaskId): void {
    if (!this.timers.delete(taskId)) return;
    this.notify();
    this.persist();
  }

  private elapsedOf(t: TimerInternal, now = this.now()): number {
    return (
      t.accumulatedMs +
      (t.phase === "running" && t.runningSince != null ? now - t.runningSince : 0)
    );
  }

  private captureActiveStep(t: TimerInternal, now: number): void {
    if (t.activeStep != null && t.stepRunningSince != null) {
      const index = t.activeStep - 1;
      t.stepAccumulatedMs[index] = (t.stepAccumulatedMs[index] ?? 0) +
        Math.max(0, now - t.stepRunningSince);
    }
    t.stepRunningSince = null;
  }

  private switchActiveStep(t: TimerInternal, nextStep: number | null, now: number): void {
    if (t.activeStep === nextStep) return;
    if (t.phase === "running") this.captureActiveStep(t, now);
    t.activeStep = nextStep;
    t.stepRunningSince = t.phase === "running" && nextStep != null ? now : null;
  }

  private stepElapsedOf(t: TimerInternal, stepCount: number, now = this.now()): number[] {
    const elapsed = normalizeStepMs(t.stepAccumulatedMs, stepCount);
    if (t.phase === "running" && t.activeStep != null && t.stepRunningSince != null) {
      const index = t.activeStep - 1;
      if (index >= 0 && index < elapsed.length) {
        elapsed[index] = (elapsed[index] ?? 0) + Math.max(0, now - t.stepRunningSince);
      }
    }
    return elapsed;
  }

  private stepSecondsOf(t: TimerInternal, stepCount: number): number[] {
    return this.stepElapsedOf(t, stepCount).map((ms) => ms <= 0 ? 0 : Math.max(1, Math.round(ms / 1000)));
  }

  private async saveStepSeconds(taskId: TaskId): Promise<void> {
    const timer = this.timers.get(taskId);
    const task = this.store.getState().tasks.get(taskId);
    if (!timer || !task) return;
    const stepSeconds = this.stepSecondsOf(timer, task.steps?.length ?? 0);
    if (stepSeconds.join("\u0000") === (task.stepSeconds ?? []).join("\u0000")) return;
    try {
      await this.tasks.updateTask(taskId, { stepSeconds });
    } catch (err) {
      console.error("[TaskMaster] step duration save failed", err);
    }
  }

  private async performLifecycleFlush(): Promise<void> {
    const now = this.now();
    for (const timer of this.timers.values()) {
      if (timer.phase !== "running") continue;
      timer.accumulatedMs = this.elapsedOf(timer, now);
      this.captureActiveStep(timer, now);
      // 실행 상태는 유지하면서 anchor만 체크포인트 시각으로 옮긴다.
      timer.runningSince = now;
      timer.stepRunningSince = timer.activeStep != null ? now : null;
    }

    // 태스크 Markdown 저장보다 복구용 timer checkpoint를 먼저 디스크에 남긴다.
    await this.enqueuePersist(this.serializeTimers());
    await Promise.all([...this.timers.keys()].map((taskId) => this.saveStepSeconds(taskId)));
    // frontmatter 갱신 중 발생한 이벤트 저장 뒤 최종 snapshot을 한 번 더 보장한다.
    await this.enqueuePersist(this.serializeTimers());
  }

  private toSnapshot(t: TimerInternal): TaskTimerSnapshot {
    const task = this.store.getState().tasks.get(t.taskId);
    return {
      taskId: t.taskId,
      title: task?.title ?? "",
      steps: task?.steps ?? [],
      currentStep: task?.currentStep ?? null,
      stepElapsedMs: this.stepElapsedOf(t, task?.steps?.length ?? 0),
      phase: t.phase,
      elapsedMs: this.elapsedOf(t),
      dismissed: t.dismissed,
      enteredDoingAt: t.enteredDoingAt,
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error("[TaskMaster] timer listener failed", err);
      }
    }
  }

  private persist(): void {
    void this.enqueuePersist(this.serializeTimers());
  }

  private serializeTimers(): PersistedTimer[] {
    return [...this.timers.values()].map((t) => ({
      taskId: t.taskId,
      phase: t.phase,
      accumulatedMs: t.accumulatedMs,
      runningSince: t.runningSince,
      stepAccumulatedMs: [...t.stepAccumulatedMs],
      activeStep: t.activeStep,
      stepRunningSince: t.stepRunningSince,
      dismissed: t.dismissed,
      enteredDoingAt: t.enteredDoingAt,
    }));
  }

  /** 저장 요청을 직렬화해 늦게 끝난 과거 write가 종료 checkpoint를 덮지 않게 한다. */
  private enqueuePersist(serialized: PersistedTimer[]): Promise<void> {
    const operation = this.persistQueue
      .catch(() => {})
      .then(() => this.persistence.save(serialized));
    this.persistQueue = operation.catch((err) => {
      console.error("[TaskMaster] timer state save failed", err);
    });
    return operation;
  }
}

function validStep(value: number | null | undefined, stepCount: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= stepCount
    ? value
    : null;
}

function normalizeStepMs(values: readonly number[] | null | undefined, stepCount: number): number[] {
  return Array.from({ length: stepCount }, (_, index) => {
    const value = values?.[index];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  });
}

function mergeStepMs(a: readonly number[], b: readonly number[]): number[] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, index) =>
    Math.max(a[index] ?? 0, b[index] ?? 0),
  );
}
