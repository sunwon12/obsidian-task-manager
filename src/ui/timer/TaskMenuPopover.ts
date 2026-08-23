// macOS 메뉴바의 TaskMaster 아이콘을 눌렀을 때 여는 빠른 작업 팝오버.
//
// 네이티브 Tray 메뉴는 정보 위계와 텍스트 입력을 표현할 수 없어서, 작은 Electron
// BrowserWindow를 메뉴바 아이콘 바로 아래에 붙인다. 저장은 별도 IPC가 아니라 기존
// TaskService/TaskTimerService만 통과하므로 Obsidian 보드와 Markdown이 같은 정본을 쓴다.

import { t } from "../../i18n";
import type { AiDraftController } from "../../services/AiDraftService";
import { debugLog } from "./debugLog";
import type { Task, TaskId, UpdateTaskInput } from "../../core/types";
import type { TaskMasterStore } from "../../store/taskMasterStore";
import type { TaskService } from "../../services/TaskService";
import type { AiReport, AiReportBullet } from "../../core/aiReport";
import { isReportForDay } from "../../core/aiReport";
import type { AiReportController } from "../../services/AiReportService";
import {
  TIMER_TICK_MS,
  formatElapsed,
  type TaskTimerService,
  type TaskTimerSnapshot,
} from "../../services/TaskTimerService";

const POPOVER_WIDTH = 420;
const POPOVER_MIN_HEIGHT = 260;
const POPOVER_MAX_HEIGHT = 720;
const POPOVER_MARGIN = 8;
const POPOVER_TITLE = "TaskMaster Quick Panel";
const POPOVER_BACKGROUND = "#191b21";
const POPOVER_FOCUS_SETTLE_MS = 250;
const POPOVER_VISIBILITY_CHECK_MS = 300;
// Tray를 다시 누르면 열린 팝오버가 먼저 blur된 뒤 Tray의 click 이벤트가 온다.
// 닫기를 한 박자 미뤄 controller가 아직 열린 상태에서 toggle을 처리하게 한다.
const POPOVER_BLUR_CLOSE_DELAY_MS = 120;
/** 펼친 리포트가 패널 한 화면을 다 먹지 않도록 카드 본문에 주는 상한(px). */
const REPORT_BODY_MAX_HEIGHT = 260;
const ACTION_LOG_PREFIX = "__TASKMASTER_MENU_ACTION__";

export interface MenuBarAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TaskMenuPopoverCloseOptions {
  /**
   * 닫은 뒤 포커스를 패널을 열기 직전의 앱으로 돌려준다.
   * 메뉴바에서 연 패널을 그냥 닫으면 macOS가 같은 앱의 다음 창(Obsidian 본창)을
   * 최상단으로 올린다. 사용자는 메뉴바 패널만 접길 원하므로, 패널을 열 때 Obsidian이
   * 비활성이었다면 닫을 때 앱을 다시 숨겨 원래 쓰던 앱이 앞으로 오게 한다.
   */
  returnFocus?: boolean;
}

export interface TaskMenuPopoverHandle {
  setContent(html: string, height: number): void;
  close(options?: TaskMenuPopoverCloseOptions): void;
}

export interface TaskMenuPopoverPort {
  isSupported(): boolean;
  /** 메뉴바가 가려진 환경에서 명령 팔레트로 열 때 쓰는 상단 우측 기준점. */
  defaultAnchor?(): MenuBarAnchorRect | null;
  create(
    anchor: MenuBarAnchorRect,
    onAction: (action: TaskMenuPopoverAction) => void,
    onDismiss: () => void,
  ): TaskMenuPopoverHandle | null;
  closeExisting?(): void;
}

export type TaskMenuPopoverAction =
  | { kind: "close" | "open-board" | "run-report" | "toggle-report" | "open-report" }
  | { kind: "start" | "pause" | "stop"; taskId: TaskId }
  | { kind: "select-step"; taskId: TaskId; step: number }
  | { kind: "add-step"; taskId: TaskId; value: string }
  | { kind: "draft-card"; taskId: TaskId }
  | { kind: "park-task"; taskId: TaskId }
  | { kind: "start-task"; taskId: TaskId }
  | { kind: "create-task"; value: string };

export interface TaskMenuPopoverController {
  isSupported(): boolean;
  isOpen(): boolean;
  /** 명령 팔레트처럼 열기 전용 진입점에서 새 패널을 확실히 연다. */
  show(anchor: MenuBarAnchorRect | null): boolean;
  toggle(anchor: MenuBarAnchorRect | null): boolean;
  openDefault?(): boolean;
  /** 메뉴바 아이콘 없이(전역 단축키 등) 열고 닫는 진입점. */
  toggleDefault?(): boolean;
  close(options?: TaskMenuPopoverCloseOptions): void;
}

export class TaskMenuPopover implements TaskMenuPopoverController {
  private handle: TaskMenuPopoverHandle | null = null;
  private unsubscribeTimers: (() => void) | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeReports: (() => void) | null = null;
  private intervalId: number | null = null;
  private session = 0;
  /**
   * 리포트 카드 접힘. 기본은 접어 둔다 — 펼친 리포트는 패널 한 화면을 다 먹어
   * 작업 목록을 밀어낸다. 하이라이트 한 줄은 접힌 상태에서도 보인다.
   * 패널을 닫아도 유지해 매번 다시 접지 않는다.
   */
  private reportCollapsed = true;
  private unsubscribeDrafts: (() => void) | null = null;

  constructor(
    private readonly timers: TaskTimerService,
    private readonly tasks: TaskService,
    private readonly store: TaskMasterStore,
    private readonly port: TaskMenuPopoverPort,
    private readonly openBoard: () => void,
    private readonly now: () => Date = () => new Date(),
    private readonly tickMs: number = TIMER_TICK_MS,
    private readonly reports: AiReportController | null = null,
    private readonly openReport: () => void = () => {},
    private readonly drafts: AiDraftController | null = null,
  ) {}

  isSupported(): boolean {
    return this.port.isSupported();
  }

  isOpen(): boolean {
    return this.handle != null;
  }

  show(anchor: MenuBarAnchorRect | null): boolean {
    if (!anchor) return false;
    // BrowserWindow의 blur -> closed는 비동기다. 그 사이 Tray를 다시 누르면 이전
    // handle만 보고 "열려 있음"으로 오판할 수 있으므로, Tray 진입은 항상 새 세션으로 연다.
    if (this.handle) this.close();
    return this.open(anchor);
  }

  toggle(anchor: MenuBarAnchorRect | null): boolean {
    if (this.handle) {
      // 메뉴바 아이콘 재클릭은 "패널만 접기"다. Obsidian 본창을 앞으로 끌어오지 않는다.
      this.close({ returnFocus: true });
      return false;
    }
    if (!anchor) return false;
    return this.open(anchor);
  }

  /**
   * 메뉴바가 꽉 차면 새 상태 아이콘이 화면 밖에 배치돼 클릭 자체가 불가능해진다.
   * 전역 단축키는 아이콘 위치와 무관한 진입점이라 그 상황에서도 패널을 열고 닫는다.
   */
  toggleDefault(): boolean {
    if (this.handle) {
      this.close({ returnFocus: true });
      return false;
    }
    return this.openDefault();
  }

  openDefault(): boolean {
    if (this.handle) return true;
    const anchor = this.port.defaultAnchor?.() ?? null;
    return anchor ? this.open(anchor) : false;
  }

  open(anchor: MenuBarAnchorRect): boolean {
    if (this.handle) return true;
    const session = ++this.session;
    const handle = this.port.create(
      anchor,
      (action) => void this.handleAction(action),
      () => this.didDismiss(session),
    );
    if (!handle) return false;
    this.handle = handle;
    this.unsubscribeTimers = this.timers.subscribe(() => this.update());
    this.unsubscribeStore = this.store.subscribe(() => this.update());
    this.unsubscribeReports = this.reports?.subscribe(() => this.update()) ?? null;
    this.unsubscribeDrafts = this.drafts?.subscribe(() => this.update()) ?? null;
    this.intervalId = window.setInterval(() => {
      // 리포트 생성 중에는 경과 초를 보여줘야 하므로 타이머가 없어도 갱신한다.
      if (
        this.timers.getTimers().some((timer) => timer.phase === "running") ||
        this.reports?.getState().status === "running" ||
        this.drafts?.getState().status === "running"
      ) this.update();
    }, this.tickMs);
    this.update();
    return true;
  }

  close(options: TaskMenuPopoverCloseOptions = {}): void {
    const handle = this.handle;
    // close() 뒤 늦게 도착한 이전 BrowserWindow의 closed 이벤트가 새 패널 세션을
    // teardown하지 못하게 먼저 세션을 무효화한다.
    this.session += 1;
    this.teardown();
    handle?.close(options);
    this.port.closeExisting?.();
  }

  dispose(): void {
    this.close();
  }

  private didDismiss(session: number): void {
    if (session !== this.session) return;
    this.teardown();
  }

  private teardown(): void {
    this.unsubscribeTimers?.();
    this.unsubscribeTimers = null;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeReports?.();
    this.unsubscribeReports = null;
    this.unsubscribeDrafts?.();
    this.unsubscribeDrafts = null;
    if (this.intervalId != null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.handle = null;
  }

  private update(): void {
    if (!this.handle) return;
    const now = this.now();
    const content = renderTaskMenuPopover(
      this.timers.getTimers(),
      [...this.store.getState().tasks.values()],
      now,
      this.reportPanelState(now),
      this.draftPanelState(now),
    );
    this.handle.setContent(content.html, content.height);
  }

  private reportPanelState(now: Date): AiReportPanelState | null {
    const reports = this.reports;
    if (!reports?.isSupported()) {
      // 섹션이 통째로 사라지는 실패는 화면에 아무 흔적을 남기지 않는다. 이유를 남긴다.
      debugLog(`ai report section skipped: wired=${String(reports != null)}`);
      return null;
    }
    const state = reports.getState();
    return {
      status: state.status,
      report: state.report,
      error: state.error,
      collapsed: this.reportCollapsed,
      stale: !isReportForDay(state.report, now),
      runningSeconds: state.startedAt == null
        ? 0
        : Math.max(0, Math.floor((now.getTime() - state.startedAt) / 1000)),
    };
  }

  /**
   * 단계 초안은 **비어 있는 카드에만** 건다. 이미 적어 둔 단계를 좁은 패널에서
   * 덮어쓰면 되돌릴 방법이 없다 — 비평 모드는 읽을 자리가 있는 보드 모달이 소유한다.
   */
  private draftPanelState(now: Date): AiDraftPanelState | null {
    const drafts = this.drafts;
    if (!drafts?.isSupported()) {
      debugLog(`ai draft section skipped: wired=${String(drafts != null)}`);
      return null;
    }
    const state = drafts.getState();
    return {
      running: state.status === "running",
      error: state.status === "error" ? state.error : null,
      runningSeconds: state.startedAt == null
        ? 0
        : Math.max(0, Math.floor((now.getTime() - state.startedAt) / 1000)),
      critique: state.suggestion?.critique ?? [],
    };
  }

  private async handleAction(action: TaskMenuPopoverAction): Promise<void> {
    try {
      switch (action.kind) {
        case "close":
          this.close({ returnFocus: true });
          return;
        case "open-board":
          this.openBoard();
          this.close();
          return;
        case "run-report":
          this.reports?.run();
          return;
        case "toggle-report":
          this.reportCollapsed = !this.reportCollapsed;
          this.update();
          return;
        case "open-report":
          this.openReport();
          this.close();
          return;
        case "start":
          this.timers.start(action.taskId);
          return;
        case "pause":
          this.timers.pause(action.taskId);
          return;
        case "stop":
          await this.timers.stop(action.taskId);
          return;
        case "select-step":
          await this.timers.selectStep(action.taskId, action.step);
          return;
        case "add-step": {
          const value = normalizeInput(action.value);
          const task = this.store.getState().tasks.get(action.taskId);
          if (!value || !task || task.archivedAt) return;
          const steps = [...(task.steps ?? []), value];
          await this.tasks.updateTask(task.id, {
            steps,
            currentStep: task.currentStep ?? 1,
          });
          return;
        }
        case "draft-card": {
          const task = this.store.getState().tasks.get(action.taskId);
          if (!task || task.archivedAt) return;
          const projects = [...this.store.getState().projects.values()];
          const ok = await this.drafts?.suggest({
            title: task.title,
            body: task.bodySummary ?? "",
            jiraKey: task.jiraKey,
            // 단계가 이미 있으면 서비스가 비평 모드로 돈다 — steps는 비어서 오고 덮어쓸 일이 없다.
            existingSteps: task.steps ?? [],
            existingTags: task.tags ?? [],
            existingRemarks: task.remarks,
            projectTitles: projects.map((project) => project.title),
            deep: true,
          });
          if (!ok) return;
          const suggestion = this.drafts?.getState().suggestion;
          if (!suggestion) return;
          // 좁은 패널에는 필드별 수락/거절 UI를 놓을 자리가 없다. 그래서 **비어 있는 칸만**
          // 채운다 — 내가 적어 둔 값을 초안이 조용히 밀어내는 일이 없어야 한다 (ADR-0012 §2).
          const input: UpdateTaskInput = {};
          if ((task.steps?.length ?? 0) === 0 && suggestion.steps.length > 0) {
            input.steps = suggestion.steps;
            input.currentStep = 1;
          }
          if (task.priority == null && suggestion.priority != null) input.priority = suggestion.priority;
          if ((task.tags?.length ?? 0) === 0 && suggestion.tags.length > 0) input.tags = suggestion.tags;
          if (!task.remarks && suggestion.remarks) input.remarks = suggestion.remarks;
          if (task.project == null && suggestion.projectTitle) {
            const matched = projects.find((project) => project.title.trim() === suggestion.projectTitle?.trim());
            if (matched) input.project = matched.id;
          }
          if (Object.keys(input).length === 0) return;
          await this.tasks.updateTask(task.id, input);
          return;
        }
        case "park-task": {
          const task = this.store.getState().tasks.get(action.taskId);
          if (!task || task.archivedAt || task.status !== "doing") return;
          // stop()은 카드를 done으로 보내고 actualMd까지 적는다 — 여기서는 "잠시 내려놓기"라
          // pause로 경과와 단계 시간만 얼린 뒤 상태만 되돌린다. doing에서 빠지면
          // TaskTimerService.onEvent가 타이머를 제거한다.
          this.timers.pause(action.taskId);
          await this.tasks.moveTask(action.taskId, "todo");
          return;
        }
        case "start-task": {
          const task = this.store.getState().tasks.get(action.taskId);
          if (!task || task.archivedAt) return;
          if (task.status !== "doing") await this.tasks.moveTask(task.id, "doing");
          this.timers.start(task.id);
          return;
        }
        case "create-task": {
          const value = normalizeInput(action.value);
          if (!value) return;
          await this.tasks.createTask({ title: value, status: "todo" });
          return;
        }
      }
    } catch (err) {
      console.error("[TaskMaster] menu bar action failed", action.kind, err);
    }
  }
}

export interface TaskMenuPopoverContent {
  html: string;
  height: number;
}

/** 패널이 그릴 AI 리포트 스냅샷. null이면 섹션 자체를 그리지 않는다. */
export interface AiReportPanelState {
  status: "idle" | "running" | "error";
  report: AiReport | null;
  error: string | null;
  collapsed: boolean;
  /** 오늘 날짜 리포트가 아니면 true — "받기" 버튼을 강조한다. */
  stale: boolean;
  runningSeconds: number;
}

/** 패널이 그릴 AI 초안 상태. null이면 초안 진입점을 그리지 않는다. */
export interface AiDraftPanelState {
  running: boolean;
  error: string | null;
  runningSeconds: number;
  /** 단계가 이미 있는 카드에 돌리면 초안 대신 비평이 온다. 버리지 않고 보여준다. */
  critique: string[];
}

/** 모든 vault 문자열은 escape한 뒤 외부 BrowserWindow에 넣는다. */
export function renderTaskMenuPopover(
  timers: TaskTimerSnapshot[],
  tasks: Task[],
  now = new Date(),
  report: AiReportPanelState | null = null,
  draft: AiDraftPanelState | null = null,
): TaskMenuPopoverContent {
  const activeTaskIds = new Set(timers.map((timer) => timer.taskId));
  const nextTasks = tasks
    .filter((task) => !task.archivedAt && task.status !== "done" && !activeTaskIds.has(task.id))
    .sort(compareTasks)
    .slice(0, 6);
  const doneToday = tasks.filter((task) =>
    !task.archivedAt && task.status === "done" && isSameLocalDay(task.updatedAt, now),
  ).length;
  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(now);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const focusHtml = timers.length > 0
    ? timers.map((timer) => renderFocusCard(timer, taskById.get(timer.taskId) ?? null, draft)).join("")
    : `<div class="empty-state">
        <span class="empty-mark">✓</span>
        <strong>${escapeHtml(t("timer.popover.noFocus"))}</strong>
        <span>${escapeHtml(t("timer.popover.noFocusHint"))}</span>
      </div>`;
  const nextHtml = nextTasks.length > 0
    ? nextTasks.map(renderNextTask).join("")
    : `<div class="list-empty">${escapeHtml(t("timer.popover.noNext"))}</div>`;
  const stepForm = timers.length > 0 ? renderStepForm(timers, draft) : "";
  const rowCount = timers.reduce((sum, timer) => sum + Math.max(1, timer.steps.length), 0);
  const reportSection = report ? renderAiReportSection(report) : { html: "", height: 0 };
  const estimatedHeight =
    250 + timers.length * 94 + rowCount * 35 + nextTasks.length * 48 + reportSection.height;

  return {
    html: `<div class="panel-shell">
      <header class="panel-header">
        <div class="brand-mark" aria-hidden="true">✓</div>
        <div class="heading">
          <h1>${escapeHtml(t("timer.popover.today"))}</h1>
          <p>${escapeHtml(dateLabel)} · ${timers.length}${escapeHtml(t("timer.popover.activeSuffix"))} · ${doneToday}${escapeHtml(t("timer.popover.doneSuffix"))}</p>
        </div>
        <a class="icon-button" href="taskmaster-menu://close" aria-label="${escapeHtml(t("timer.popover.close"))}">×</a>
      </header>

      <main>
        ${reportSection.html}
        <section class="section focus-section" data-drop="focus">
          <div class="section-heading">
            <h2>${escapeHtml(t("timer.popover.focus"))}</h2>
            <span>${timers.length}</span>
          </div>
          ${focusHtml}
          ${stepForm}
        </section>

        <section class="section next-section" data-drop="next">
          <div class="section-heading">
            <h2>${escapeHtml(t("timer.popover.next"))}</h2>
            <span>${nextTasks.length}</span>
          </div>
          <div class="task-list">${nextHtml}</div>
          <form class="quick-form" data-action="taskmaster-menu://create-task">
            <input data-preserve="new-task" name="value" maxlength="240" autocomplete="off" placeholder="${escapeHtml(t("timer.popover.taskPlaceholder"))}" aria-label="${escapeHtml(t("timer.popover.taskPlaceholder"))}">
            <button type="submit" aria-label="${escapeHtml(t("timer.popover.addTask"))}">＋</button>
          </form>
        </section>
      </main>

      <footer>
        <a class="open-board" href="taskmaster-menu://open-board">
          <span>${escapeHtml(t("timer.popover.openBoard"))}</span><span aria-hidden="true">↗</span>
        </a>
      </footer>
    </div>`,
    height: Math.min(POPOVER_MAX_HEIGHT, Math.max(POPOVER_MIN_HEIGHT, estimatedHeight)),
  };
}

/**
 * AI 리포트 섹션. 리포트가 오늘 것이 아니면 "받기"를 눈에 띄게 두고,
 * 생성 중에는 경과 초를 보여줘 프로세스가 살아 있음을 알린다.
 */
function renderAiReportSection(state: AiReportPanelState): TaskMenuPopoverContent {
  const running = state.status === "running";
  const button = running
    ? `<span class="report-run busy">${escapeHtml(t("timer.popover.reportRunning"))} · ${state.runningSeconds}${escapeHtml(t("timer.popover.reportSeconds"))}</span>`
    : `<a class="report-run${state.stale ? " wanted" : ""}" href="taskmaster-menu://run-report">↻ ${escapeHtml(t("timer.popover.reportRun"))}</a>`;
  const error = state.status === "error" && state.error
    ? `<p class="report-error">${escapeHtml(state.error)}</p>`
    : "";

  if (!state.report) {
    return {
      html: `<section class="section report-section">
        <div class="section-heading">
          <h2>${escapeHtml(t("timer.popover.report"))}</h2>
          <span></span>
          ${button}
        </div>
        <div class="list-empty">${escapeHtml(t("timer.popover.reportEmpty"))}</div>
        ${error}
      </section>`,
      height: 96 + (error ? 26 : 0),
    };
  }

  const report = state.report;
  const [, month = "", day = ""] = report.date.split("-");
  const dateLabel = `${Number(month)}월 ${Number(day)}일${report.weekday ? ` (${report.weekday})` : ""}`;
  const body = state.collapsed
    ? ""
    : `<div class="report-body" data-scroll-key="report:${escapeHtml(report.date)}">
         ${report.snapshot ? `<p class="report-snapshot">${escapeHtml(report.snapshot)}</p>` : ""}
         ${report.bullets.length > 0
           ? `<ul class="report-bullets">${report.bullets.map(renderReportBullet).join("")}</ul>`
           : ""}
       </div>
       <a class="report-open" href="taskmaster-menu://open-report">
         <span>${escapeHtml(t("timer.popover.reportOpen"))}</span><span aria-hidden="true">↗</span>
       </a>`;
  // 접힌 상태의 하이라이트는 CSS line-clamp만 믿지 않는다(실측: 세 번째 줄이 새어
  // 카드 밖으로 잘려 보였다). 글자 수로 먼저 자르고 clamp는 보조로만 쓴다.
  const highlightText = state.collapsed ? truncate(report.highlight, 88) : report.highlight;
  const highlight = report.highlight
    ? `<p class="report-highlight${state.collapsed ? " clamp" : ""}">🎯 ${escapeHtml(highlightText)}</p>`
    : "";

  const bulletHeight = report.bullets.reduce(
    (sum, bullet) => sum + 34 + Math.ceil((bullet.lead.length + bullet.body.length) / 34) * 16, 0,
  );
  const snapshotHeight = Math.ceil(report.snapshot.length / 34) * 16;
  const bodyHeight = state.collapsed
    ? 0
    : Math.min(REPORT_BODY_MAX_HEIGHT, snapshotHeight + bulletHeight);

  return {
    html: `<section class="section report-section">
      <div class="section-heading">
        <h2>${escapeHtml(t("timer.popover.report"))}</h2>
        <span${state.stale ? ' class="stale"' : ""}>${escapeHtml(dateLabel)}</span>
        ${button}
      </div>
      <article class="report-card${running ? " busy" : ""}">
        <a class="report-toggle" href="taskmaster-menu://toggle-report">
          <span class="report-caret" aria-hidden="true">${state.collapsed ? "▸" : "▾"}</span>
          <span>${escapeHtml(state.collapsed ? t("timer.popover.reportExpand") : t("timer.popover.reportCollapse"))}</span>
        </a>
        ${body}
        ${highlight}
      </article>
      ${error}
    </section>`,
    height: 92 + bodyHeight + (highlight ? 34 : 0) + (state.collapsed ? 0 : 34) + (error ? 26 : 0),
  };
}

function renderReportBullet(bullet: AiReportBullet): string {
  const lead = bullet.lead ? `<strong>${escapeHtml(bullet.lead)}</strong> ` : "";
  return `<li>${lead}${escapeHtml(bullet.body)}</li>`;
}

/** 이 카드에 AI가 채울 빈 칸이 하나라도 있는가. 없으면 버튼을 그리지 않는다. */
function hasBlankToFill(task: Task | null): boolean {
  if (!task) return false;
  return (task.steps?.length ?? 0) === 0
    || task.priority == null
    || (task.tags?.length ?? 0) === 0
    || !task.remarks
    || task.project == null;
}

function renderFocusCard(
  timer: TaskTimerSnapshot,
  task: Task | null,
  draft: AiDraftPanelState | null,
): string {
  const phaseClass = timer.phase === "running" ? "running" : timer.phase === "paused" ? "paused" : "idle";
  const phaseLabel = timer.phase === "running"
    ? t("timer.popover.running")
    : timer.phase === "paused"
      ? t("timer.popover.paused")
      : t("timer.popover.ready");
  const primaryAction = timer.phase === "running" ? "pause" : "start";
  const primaryGlyph = timer.phase === "running" ? "Ⅱ" : "▶";
  const steps = timer.steps.length > 0
    ? `<ol class="step-list">${timer.steps.map((step, index) => renderStep(timer, step, index)).join("")}</ol>`
    : `<p class="step-empty">${escapeHtml(t("timer.popover.firstStepHint"))}</p>`;
  return `<article class="focus-card ${phaseClass}" draggable="true" data-drag="focus" data-task-id="${escapeHtml(timer.taskId)}">
    <div class="focus-topline">
      <span class="phase-dot" aria-hidden="true"></span>
      <span class="phase-label">${escapeHtml(phaseLabel)}</span>
      <span class="timer-value">${formatElapsed(timer.elapsedMs)}</span>
    </div>
    <div class="focus-title-row">
      <h3 class="scroll-title" data-scroll-key="focus:${escapeHtml(timer.taskId)}" title="${escapeHtml(timer.title)}">${escapeHtml(timer.title)}</h3>
      <nav class="focus-controls">
        <a href="${actionUrl(primaryAction, timer.taskId)}" title="${escapeHtml(timer.phase === "running" ? t("timer.pause") : t("timer.start"))}">${primaryGlyph}</a>
        <a class="stop" href="${actionUrl("stop", timer.taskId)}" title="${escapeHtml(t("timer.stop"))}">■</a>
      </nav>
    </div>
    ${steps}
    ${draft && !draft.running && hasBlankToFill(task)
      ? `<a class="draft-run" href="${actionUrl("draft-card", timer.taskId)}">✨ ${escapeHtml(t("timer.popover.draftCard"))}</a>`
      : ""}
  </article>`;
}

function renderStep(timer: TaskTimerSnapshot, value: string, index: number): string {
  const number = index + 1;
  const state = timer.currentStep == null
    ? "pending"
    : number < timer.currentStep
      ? "completed"
      : number === timer.currentStep
        ? "current"
        : "pending";
  const mark = state === "completed" ? "✓" : state === "current" ? "●" : String(number);
  return `<li>
    <a class="step-row ${state}" href="${actionUrl("select-step", timer.taskId, { step: number })}">
      <span class="step-mark">${mark}</span>
      <span class="step-label scroll-title" data-scroll-key="step:${escapeHtml(timer.taskId)}:${number}" title="${escapeHtml(value)}">${escapeHtml(value)}</span>
      <span class="step-time">${formatElapsed(timer.stepElapsedMs[index] ?? 0)}</span>
    </a>
  </li>`;
}

function renderStepForm(timers: TaskTimerSnapshot[], draft: AiDraftPanelState | null): string {
  const options = timers.map((timer) =>
    `<option value="${escapeHtml(timer.taskId)}">${escapeHtml(truncate(timer.title, 34))}</option>`,
  ).join("");
  return `${renderDraftRow(timers, draft)}<form class="quick-form step-form" data-action="taskmaster-menu://add-step">
    ${timers.length > 1
      ? `<select data-preserve="step-task" name="taskId" aria-label="${escapeHtml(t("timer.popover.chooseTask"))}">${options}</select>`
      : `<input type="hidden" name="taskId" value="${escapeHtml(timers[0]?.taskId ?? "")}">`}
    <input data-preserve="new-step" name="value" maxlength="240" autocomplete="off" autofocus placeholder="${escapeHtml(t("timer.popover.stepPlaceholder"))}" aria-label="${escapeHtml(t("timer.popover.stepPlaceholder"))}">
    <button type="submit" aria-label="${escapeHtml(t("timer.popover.addStep"))}">＋</button>
  </form>`;
}

/**
 * 초안 실행 상태만 담는 줄. 진입점은 카드마다 따로 있으므로 여기에는 버튼을 두지 않는다.
 * 단계가 이미 있는 카드에 돌리면 초안 대신 비평이 오는데, 안 보여주면 그대로 버려진다.
 */
function renderDraftRow(_timers: TaskTimerSnapshot[], draft: AiDraftPanelState | null): string {
  if (!draft) return "";
  if (draft.running) {
    return `<div class="draft-row running">${escapeHtml(
      t("timer.popover.draftRunning").replace("{seconds}", String(draft.runningSeconds)),
    )}</div>`;
  }
  const error = draft.error
    ? `<div class="draft-row error">${escapeHtml(draft.error)}</div>`
    : "";
  const critique = draft.critique.length > 0
    ? `<ul class="draft-critique">${draft.critique.slice(0, 3).map(
        (line) => `<li>${escapeHtml(line)}</li>`,
      ).join("")}</ul>`
    : "";
  return `${error}${critique}`;
}

function renderNextTask(task: Task): string {
  const status = task.status === "in-review"
    ? t("timer.popover.review")
    : task.status === "hold"
      ? t("timer.popover.hold")
      : task.status === "backlog"
        ? t("timer.popover.backlog")
        : t("timer.popover.todo");
  const due = task.due ? `<span class="task-due">${escapeHtml(task.due.slice(5))}</span>` : "";
  return `<div class="task-row" draggable="true" data-drag="next" data-task-id="${escapeHtml(task.id)}">
    <span class="task-status">${escapeHtml(status)}</span>
    <span class="task-title scroll-title" data-scroll-key="task:${escapeHtml(task.id)}" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
    ${due}
    <a class="start-task" href="${actionUrl("start-task", task.id)}" title="${escapeHtml(t("timer.popover.startTask"))}">▶</a>
  </div>`;
}

function compareTasks(a: Task, b: Task): number {
  const order: Record<Task["status"], number> = {
    "in-review": 0,
    todo: 1,
    hold: 2,
    backlog: 3,
    doing: 4,
    done: 5,
  };
  return order[a.status] - order[b.status] || b.updatedAt.localeCompare(a.updatedAt);
}

function isSameLocalDay(iso: string, now: Date): boolean {
  const value = new Date(iso);
  return !Number.isNaN(value.getTime()) &&
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate();
}

function normalizeInput(value: string): string {
  return value.trim().replace(/\s+/gu, " ").slice(0, 240);
}

function actionUrl(kind: string, taskId?: TaskId, extra?: Record<string, string | number>): string {
  const params = new URLSearchParams();
  if (taskId) params.set("taskId", taskId);
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, String(value));
  const query = params.toString();
  return `taskmaster-menu://${kind}${query ? `?${query}` : ""}`;
}

export function parseTaskMenuPopoverAction(url: string): TaskMenuPopoverAction | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "taskmaster-menu:") return null;
    const kind = parsed.hostname;
    if (
      kind === "close" || kind === "open-board" ||
      kind === "run-report" || kind === "toggle-report" || kind === "open-report"
    ) return { kind };
    if (kind === "create-task") {
      const value = parsed.searchParams.get("value") ?? "";
      const normalized = normalizeInput(value);
      return normalized ? { kind, value: normalized } : null;
    }
    const taskId = parsed.searchParams.get("taskId") as TaskId | null;
    if (!taskId) return null;
    if (["start", "pause", "stop", "start-task", "draft-card", "park-task"].includes(kind)) {
      return { kind: kind as "start" | "pause" | "stop" | "start-task" | "draft-card" | "park-task", taskId };
    }
    if (kind === "select-step") {
      const step = Number(parsed.searchParams.get("step"));
      return Number.isInteger(step) && step > 0 ? { kind, taskId, step } : null;
    }
    if (kind === "add-step") {
      const value = parsed.searchParams.get("value") ?? "";
      const normalized = normalizeInput(value);
      return normalized ? { kind, taskId, value: normalized } : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseTaskMenuPopoverConsoleAction(message: string): TaskMenuPopoverAction | null {
  return message.startsWith(ACTION_LOG_PREFIX)
    ? parseTaskMenuPopoverAction(message.slice(ACTION_LOG_PREFIX.length))
    : null;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------- Electron adapter ----------

interface BrowserWindowLike {
  webContents: {
    on(event: "did-finish-load", listener: () => void): void;
    on(event: "will-navigate", listener: (event: { preventDefault(): void }, url: string) => void): void;
    on(event: "console-message", listener: (event: unknown, ...args: unknown[]) => void): void;
    executeJavaScript(script: string): Promise<unknown>;
    getURL?(): string;
  };
  on(event: "blur" | "closed", listener: () => void): void;
  loadURL(url: string): Promise<void>;
  setBounds(bounds: MenuBarAnchorRect): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  show(): void;
  focus?(): void;
  close(): void;
  isDestroyed?(): boolean;
  isVisible?(): boolean;
  getTitle?(): string;
}

interface ElectronDisplayLike {
  workArea: MenuBarAnchorRect;
}

interface ElectronRemoteLike {
  BrowserWindow: {
    new (options: Record<string, unknown>): BrowserWindowLike;
    getAllWindows?(): BrowserWindowLike[];
    getFocusedWindow?(): BrowserWindowLike | null;
  };
  /** macOS 전용. 패널을 닫을 때 Obsidian을 다시 뒤로 보내는 데만 쓴다. */
  app?: { hide?(): void };
  globalShortcut?: {
    register(accelerator: string, callback: () => void): boolean;
    unregister?(accelerator: string): void;
  };
  screen: {
    getPrimaryDisplay(): ElectronDisplayLike;
    getDisplayNearestPoint?(point: { x: number; y: number }): ElectronDisplayLike;
    getCursorScreenPoint?(): { x: number; y: number };
  };
}

function resolveElectronRemote(): ElectronRemoteLike | null {
  const req = (window as Window & { require?: (id: string) => unknown }).require;
  if (typeof req !== "function") return null;
  for (const id of ["@electron/remote", "electron"]) {
    try {
      const mod = req(id) as { remote?: unknown } | undefined;
      const candidate = (id === "electron" ? mod?.remote : mod) as ElectronRemoteLike | undefined;
      if (candidate && typeof candidate.BrowserWindow === "function" && candidate.screen) return candidate;
    } catch {
      // 다음 후보 시도
    }
  }
  return null;
}

export function createElectronTaskMenuPopoverPort(): TaskMenuPopoverPort {
  // panel 창이 이 Electron에서 안 보이는 것으로 확인되면 세션 내내 일반 창을 쓴다.
  let panelModeBroken = false;
  const initialRemote = resolveElectronRemote();
  if (initialRemote) closeExistingPopovers(initialRemote);
  return {
    isSupported: () => resolveElectronRemote() != null,
    defaultAnchor(): MenuBarAnchorRect | null {
      const remote = resolveElectronRemote();
      if (!remote) return null;
      const cursor = remote.screen.getCursorScreenPoint?.();
      const area = cursor && remote.screen.getDisplayNearestPoint
        ? remote.screen.getDisplayNearestPoint(cursor).workArea
        : remote.screen.getPrimaryDisplay().workArea;
      return {
        x: area.x + area.width - 28,
        y: area.y - 30,
        width: 20,
        height: 24,
      };
    },
    closeExisting(): void {
      const remote = resolveElectronRemote();
      if (remote) closeExistingPopovers(remote);
    },
    create(rawAnchor, onAction, onDismiss): TaskMenuPopoverHandle | null {
      const remote = resolveElectronRemote();
      if (!remote) return null;
      // 메뉴바가 꽉 차면 상태 아이콘이 화면 밖(x가 큰 음수)에 배치된다. 그 좌표를 그대로 쓰면
      // 패널이 화면 왼쪽 구석에 붙으므로, 화면 밖 기준점은 우상단 기본 위치로 바꾼다.
      const anchor = onScreenAnchor(remote, rawAnchor) ?? this.defaultAnchor?.() ?? rawAnchor;
      // 패널이 앱을 활성화하기 전에 원래 상태를 기록한다. 메뉴바에서 열었다면 Obsidian은
      // 보통 비활성이고, 그때만 닫으면서 앱을 다시 숨겨 이전 앱으로 돌려준다.
      const appWasActive = isObsidianActive(remote);
      closeExistingPopovers(remote);
      const area = remote.screen.getDisplayNearestPoint?.({
        x: anchor.x + anchor.width / 2,
        y: anchor.y + anchor.height,
      }).workArea ?? remote.screen.getPrimaryDisplay().workArea;

      // macOS non-activating 패널(NSPanel)로 열면 Obsidian 앱이 활성화되지 않는다. 일반 창은
      // key가 되는 순간 앱이 최상단으로 올라와 뒤에 있던 Obsidian 본창까지 끌고 나온다.
      // 다만 이 경로가 환경에 따라 창을 안 보여주는 경우가 있어, 안 뜨면 즉시 일반 창으로
      // 다시 만든다 — 사용자에게는 "안 열림" 대신 "예전처럼 열림"으로 떨어진다.
      let panelMode = supportsNonActivatingPanel() && !panelModeBroken;
      let browser: BrowserWindowLike | null = null;
      let ready = false;
      let latest = "";
      let latestHeight = POPOVER_MIN_HEIGHT;
      let dismissed = false;
      let canDismissOnBlur = false;
      let focusSettleId: number | null = null;
      let blurCloseId: number | null = null;
      let panelCheckId: number | null = null;

      const clearTimers = (): void => {
        for (const id of [focusSettleId, blurCloseId, panelCheckId]) {
          if (id != null) window.clearTimeout(id);
        }
        focusSettleId = null;
        blurCloseId = null;
        panelCheckId = null;
      };
      const dismissOnce = (): void => {
        if (dismissed) return;
        dismissed = true;
        clearTimers();
        onDismiss();
      };
      const commit = (): void => {
        const win = browser;
        if (!win) return;
        const height = Math.min(latestHeight, area.height - POPOVER_MARGIN * 2);
        win.setBounds(popoverBounds(anchor, area, height));
        if (!ready) return;
        const script = `window.__taskmasterSetContent(${JSON.stringify(latest)})`;
        void win.webContents.executeJavaScript(script).catch((err: unknown) => {
          console.error("[TaskMaster] menu popover update failed", err);
        });
      };

      function build(usePanel: boolean): boolean {
        const win = createPopoverWindow(remote!, usePanel);
        if (!win) {
          debugLog(`create failed panel=${usePanel}`);
          return false;
        }
        browser = win;
        ready = false;
        canDismissOnBlur = false;
        const isCurrent = (): boolean => browser === win;
        win.webContents.on("did-finish-load", () => {
          if (!isCurrent()) return;
          ready = true;
          commit();
          win.show();
          win.focus?.();
          debugLog(`shown panel=${usePanel} visible=${String(win.isVisible?.())}`);
          // Tray/명령 팔레트의 원래 클릭이 끝나면서 Obsidian이 포커스를 한 번 되가져가는
          // macOS 경합이 있다. 그 첫 blur로 즉시 닫지 않고, 입력 이벤트가 정리된 뒤 한 번 더
          // focus한 다음부터 바깥 클릭 닫기를 활성화한다.
          focusSettleId = window.setTimeout(() => {
            focusSettleId = null;
            if (!isCurrent() || win.isDestroyed?.()) return;
            win.focus?.();
            canDismissOnBlur = true;
          }, POPOVER_FOCUS_SETTLE_MS);
          if (usePanel) {
            panelCheckId = window.setTimeout(() => {
              panelCheckId = null;
              if (!isCurrent() || win.isDestroyed?.()) return;
              if (win.isVisible?.() === false) recover("panel stayed hidden");
            }, POPOVER_VISIBILITY_CHECK_MS);
          }
        });
        win.webContents.on("will-navigate", (event, url) => {
          const action = parseTaskMenuPopoverAction(url);
          if (!action) return;
          event.preventDefault();
          onAction(action);
        });
        win.webContents.on("console-message", (_event, ...args) => {
          const legacyMessage = args.find((value): value is string => typeof value === "string");
          const details = args.find((value): value is { message: string } =>
            typeof value === "object" && value != null &&
            "message" in value && typeof value.message === "string",
          );
          const action = parseTaskMenuPopoverConsoleAction(legacyMessage ?? details?.message ?? "");
          if (action) onAction(action);
        });
        win.on("blur", () => {
          if (!isCurrent() || !canDismissOnBlur || win.isDestroyed?.() || blurCloseId != null) return;
          blurCloseId = window.setTimeout(() => {
            blurCloseId = null;
            if (!isCurrent() || win.isDestroyed?.()) return;
            debugLog("closing on blur");
            win.close();
          }, POPOVER_BLUR_CLOSE_DELAY_MS);
        });
        win.on("closed", () => {
          // 복구 과정에서 버린 창의 늦은 closed는 새 세션을 정리하면 안 된다.
          if (!isCurrent()) return;
          debugLog(`closed panel=${usePanel}`);
          dismissOnce();
        });
        try {
          win.setAlwaysOnTop(true, "pop-up-menu");
        } catch (err) {
          debugLog(`setAlwaysOnTop failed ${String(err)}`);
        }
        void win.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(POPOVER_DOCUMENT)}${usePanel ? "#opaque" : ""}`,
        );
        return true;
      }

      function recover(reason: string): void {
        if (!panelMode) return;
        panelMode = false;
        panelModeBroken = true;
        debugLog(`recovering to a normal window: ${reason}`);
        const stale = browser;
        browser = null;
        clearTimers();
        try {
          if (stale && !stale.isDestroyed?.()) stale.close();
        } catch {
          // 이미 사라진 창이면 그대로 진행한다.
        }
        if (build(false)) commit();
        else dismissOnce();
      }

      debugLog(`open panel=${panelMode} appWasActive=${appWasActive}`);
      let started = build(panelMode);
      if (!started && panelMode) {
        panelMode = false;
        panelModeBroken = true;
        started = build(false);
      }
      if (!started) return null;

      return {
        setContent(html, height): void {
          latest = html;
          latestHeight = height;
          commit();
        },
        close(options): void {
          const win = browser;
          browser = null;
          clearTimers();
          debugLog(`explicit close returnFocus=${String(options?.returnFocus)} panel=${panelMode}`);
          try {
            if (win && !win.isDestroyed?.()) win.close();
          } catch {
            // 이미 닫힌 창은 무시한다.
          }
          dismissOnce();
          // 일반 창으로 열렸을 때만 필요하다. 창을 닫으면 macOS가 같은 앱의 다음 창
          // (Obsidian 본창)을 최상단으로 올리므로, 열기 전 비활성이었다면 앱을 숨겨
          // 원래 앱을 앞으로 돌려준다. panel 모드는 앱을 활성화한 적이 없어 숨기면 안 된다.
          if (options?.returnFocus && !panelMode && !appWasActive) hideObsidian(remote);
        },
      };
    },
  };
}

/** 기본 전역 단축키 — 다른 앱과 겹치지 않게 4개 조합을 쓴다. */
export const QUICK_PANEL_SHORTCUT = "Control+Alt+Command+T";

/**
 * 메뉴바 아이콘과 무관하게 패널을 여는 전역 단축키를 등록한다.
 * 등록 실패(다른 앱이 선점, 미지원 환경)는 조용히 넘기고 해제 함수만 돌려준다.
 */
export function registerQuickPanelShortcut(
  controller: TaskMenuPopoverController,
  accelerator: string = QUICK_PANEL_SHORTCUT,
): (() => void) | null {
  const remote = resolveElectronRemote();
  const shortcuts = remote?.globalShortcut;
  if (!shortcuts) return null;
  try {
    shortcuts.unregister?.(accelerator);
    const ok = shortcuts.register(accelerator, () => {
      if (controller.toggleDefault) controller.toggleDefault();
      else controller.openDefault?.();
    });
    debugLog(`global shortcut ${accelerator} registered=${String(ok)}`);
    if (!ok) return null;
  } catch (err) {
    debugLog(`global shortcut register failed: ${String(err)}`);
    return null;
  }
  return () => {
    try {
      shortcuts.unregister?.(accelerator);
    } catch {
      // 종료 중 remote bridge가 먼저 사라질 수 있다.
    }
  };
}

export function popoverBounds(
  anchor: MenuBarAnchorRect,
  area: MenuBarAnchorRect,
  height: number,
): MenuBarAnchorRect {
  const centeredX = Math.round(anchor.x + anchor.width / 2 - POPOVER_WIDTH / 2);
  const x = Math.min(
    area.x + area.width - POPOVER_WIDTH - POPOVER_MARGIN,
    Math.max(area.x + POPOVER_MARGIN, centeredX),
  );
  const below = anchor.y + anchor.height + 6;
  const y = Math.min(area.y + area.height - height - POPOVER_MARGIN, Math.max(area.y, below));
  return { x, y, width: POPOVER_WIDTH, height };
}

/**
 * macOS non-activating 패널을 쓸 수 있는 환경인지.
 *
 * Electron 26+가 `type: "panel"`을 NSWindowStyleMaskNonactivatingPanel로 매핑한다.
 * 확인할 수 없는 환경에서는 쓰지 않고 일반 창으로 연다.
 */
function supportsNonActivatingPanel(): boolean {
  const runtime = (globalThis as {
    process?: { platform?: string; versions?: { electron?: string } };
  }).process;
  if (!runtime || runtime.platform !== "darwin") return false;
  const major = Number.parseInt(runtime.versions?.electron ?? "", 10);
  return Number.isFinite(major) && major >= 26;
}

function createPopoverWindow(
  remote: ElectronRemoteLike,
  panelMode: boolean,
): BrowserWindowLike | null {
  try {
    return new remote.BrowserWindow({
      // NSPanel은 투명 + vibrancy 조합에서 아무것도 그리지 않는 경우가 있어, panel 모드는
      // 창을 불투명하게 만들고 둥근 모서리를 창 자체에 맡긴다. 문서도 여백 없이 꽉 채운다.
      ...(panelMode
        ? { type: "panel", backgroundColor: POPOVER_BACKGROUND }
        : {
            transparent: true,
            backgroundColor: "#00000000",
            vibrancy: "popover",
            visualEffectState: "active",
          }),
      width: POPOVER_WIDTH,
      height: POPOVER_MIN_HEIGHT,
      title: POPOVER_TITLE,
      frame: false,
      roundedCorners: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      focusable: true,
      acceptFirstMouse: true,
      hasShadow: true,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
  } catch (err) {
    console.error("[TaskMaster] menu popover create failed", panelMode ? "(panel)" : "", err);
    return null;
  }
}

/** 화면 안에 있는 기준점이면 그대로, 화면 밖이면 null. */
function onScreenAnchor(
  remote: ElectronRemoteLike,
  anchor: MenuBarAnchorRect,
): MenuBarAnchorRect | null {
  try {
    const area = remote.screen.getDisplayNearestPoint?.({ x: anchor.x, y: anchor.y }).workArea
      ?? remote.screen.getPrimaryDisplay().workArea;
    const inside = anchor.x + anchor.width > area.x && anchor.x < area.x + area.width;
    return inside ? anchor : null;
  } catch {
    return anchor;
  }
}

/** 패널을 열기 직전 Obsidian이 최상단 앱이었는지. 판단 불가한 환경이면 "활성"으로 본다. */
function isObsidianActive(remote: ElectronRemoteLike): boolean {
  const getFocusedWindow = remote.BrowserWindow.getFocusedWindow;
  if (typeof getFocusedWindow !== "function") return true;
  try {
    const focused = getFocusedWindow.call(remote.BrowserWindow);
    // 이전 패널이 아직 살아 있는 경우는 "Obsidian 창이 활성"이 아니다.
    return focused != null && focused.getTitle?.() !== POPOVER_TITLE;
  } catch {
    return true;
  }
}

function hideObsidian(remote: ElectronRemoteLike): void {
  try {
    remote.app?.hide?.();
  } catch (err) {
    console.error("[TaskMaster] menu popover focus return failed", err);
  }
}

function closeExistingPopovers(remote: ElectronRemoteLike): void {
  for (const candidate of remote.BrowserWindow.getAllWindows?.() ?? []) {
    try {
      if (candidate.getTitle?.() === POPOVER_TITLE) candidate.close();
    } catch (err) {
      console.error("[TaskMaster] stale menu popover cleanup failed", err);
    }
  }
}

/** 패널 문서 전문. 주입 스크립트의 계약(드래그 중 갱신 보류 등)을 테스트가 대조한다. */
export const POPOVER_DOCUMENT = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${POPOVER_TITLE}</title><style>
  :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  html, body, #app { width: 100%; height: 100%; margin: 0; background: transparent; overflow: hidden; }
  body { padding: 7px; color: #f4f5f7; }
  /* 불투명 창(NSPanel)으로 열린 경우 — 창 자체가 둥근 모서리와 그림자를 그리므로 문서는 꽉 채운다. */
  html.opaque body { padding: 0; }
  html.opaque .panel-shell { border-radius: 12px; box-shadow: none; }
  a, button, input, select { font: inherit; }
  a { color: inherit; text-decoration: none; }
  button { color: inherit; }
  .panel-shell { height: 100%; display: flex; flex-direction: column; overflow: hidden; background: rgba(25,27,33,.985); border: 1px solid rgba(255,255,255,.12); border-radius: 19px; box-shadow: 0 18px 54px rgba(0,0,0,.48), 0 2px 10px rgba(0,0,0,.28); }
  .panel-header { display: flex; align-items: center; gap: 11px; padding: 16px 16px 13px; border-bottom: 1px solid rgba(255,255,255,.07); }
  .brand-mark { display: grid; place-items: center; width: 35px; height: 35px; flex: none; color: #181b22; background: #85bfff; border-radius: 11px; font-size: 20px; font-weight: 900; box-shadow: inset 0 0 0 1px rgba(255,255,255,.3); }
  .heading { min-width: 0; flex: 1; }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: 18px; line-height: 1.15; letter-spacing: -.02em; }
  .heading p { margin-top: 4px; color: #969ba6; font-size: 11.5px; }
  .icon-button { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; color: #9ca1ac; background: rgba(255,255,255,.055); font-size: 20px; }
  .icon-button:hover { color: #fff; background: rgba(255,255,255,.1); }
  main { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 14px 16px 8px; scrollbar-width: thin; scrollbar-color: #555b67 transparent; }
  .section + .section { margin-top: 19px; }
  .section-heading { display: flex; align-items: center; gap: 7px; margin-bottom: 9px; }
  .section-heading h2 { flex: 1; color: #d8dbe1; font-size: 12px; font-weight: 700; letter-spacing: .01em; }
  .section-heading span { color: #7f8590; font-size: 11px; font-variant-numeric: tabular-nums; }
  /* 드래그로 현재 작업 ↔ 다음 할 일 이동. 끌 수 있다는 신호를 커서로 준다. */
  [data-drag] { cursor: grab; }
  [data-drag]:active { cursor: grabbing; }
  .dragging { opacity: .45; }
  [data-drop].drop-target { outline: 1px dashed rgba(117,180,255,.75); outline-offset: 2px; border-radius: 10px; background: rgba(117,180,255,.08); }

  /* AI 단계 초안 — 단계 입력 폼 바로 위 한 줄. 실패도 같은 자리에 남긴다. */
  .draft-row { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 10.5px; }
  .draft-row.running { color: #8ec5ff; font-variant-numeric: tabular-nums; }
  .draft-row.error { color: #e08c8c; }
  .draft-critique { margin: 0 0 6px; padding-left: 16px; font-size: 10.5px; color: #b6c0cc; }
  .draft-critique li { margin: 2px 0; }
  .focus-card .draft-run { display: inline-block; margin-top: 8px; }
  .draft-run { padding: 3px 8px; border-radius: 8px; color: #9aa1ad; background: rgba(255,255,255,.06); font-weight: 650; }
  .draft-run:hover { color: #eaf2ff; background: rgba(117,180,255,.18); }

  /* AI 리포트 — 하루 한 번 읽는 블록이라 카드 하나로 묶고 접을 수 있게 둔다. */
  .section-heading .stale { color: #e0a561; }
  .report-run { flex: none; padding: 4px 9px; border-radius: 8px; color: #9aa1ad; background: rgba(255,255,255,.06); font-size: 10.5px; font-weight: 650; }
  .report-run:hover { color: #eaf2ff; background: rgba(117,180,255,.18); }
  .report-run.wanted { color: #10151b; background: #74b5fa; }
  .report-run.wanted:hover { background: #91c8ff; }
  .report-run.busy { color: #8ec5ff; background: rgba(117,180,255,.13); font-variant-numeric: tabular-nums; }
  .report-card { padding: 11px 13px 12px; background: #20232a; border: 1px solid rgba(255,255,255,.07); border-radius: 14px; }
  .report-card.busy { opacity: .55; }
  .report-toggle { display: flex; align-items: center; gap: 6px; color: #7f8590; font-size: 10.5px; font-weight: 650; }
  .report-toggle:hover { color: #cdd4de; }
  .report-caret { font-size: 8px; }
  .report-body { max-height: 260px; margin-top: 2px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #4c525d transparent; }
  .report-snapshot { margin-top: 8px; color: #aeb4be; font-size: 11px; line-height: 1.55; }
  .report-bullets { margin: 9px 0 0; padding: 9px 0 0; border-top: 1px solid rgba(255,255,255,.07); list-style: none; }
  .report-bullets li { position: relative; padding-left: 11px; color: #c3c9d2; font-size: 11px; line-height: 1.6; }
  .report-bullets li + li { margin-top: 8px; }
  .report-bullets li::before { position: absolute; left: 0; top: 0; color: #5f6673; content: "·"; }
  .report-bullets strong { color: #eef3fa; font-weight: 700; }
  .report-highlight { margin-top: 10px; padding: 8px 10px; color: #dfe7f2; background: rgba(117,180,255,.1); border-radius: 10px; font-size: 11px; line-height: 1.55; }
  .report-highlight.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .report-open { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; height: 28px; padding: 0 9px; border-radius: 8px; color: #8b929e; background: rgba(255,255,255,.045); font-size: 10.5px; }
  .report-open:hover { color: #dce7f5; background: rgba(255,255,255,.08); }
  .report-error { margin-top: 8px; color: #e79a8f; font-size: 10.5px; line-height: 1.5; }
  .focus-card { position: relative; padding: 13px; overflow: hidden; background: #22252c; border: 1px solid rgba(255,255,255,.075); border-radius: 14px; }
  .focus-card + .focus-card { margin-top: 8px; }
  .focus-card.running { border-color: rgba(87,164,255,.45); box-shadow: inset 3px 0 #74b4ff; }
  .focus-topline { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .phase-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: #747a86; }
  .running .phase-dot { background: #79bdff; box-shadow: 0 0 0 4px rgba(121,189,255,.1); }
  .paused .phase-dot { background: #f3b968; }
  .phase-label { color: #949aa5; font-size: 10.5px; font-weight: 650; }
  .timer-value { margin-left: auto; color: #b9cfe9; font-size: 11px; font-variant-numeric: tabular-nums; }
  .focus-title-row { display: flex; align-items: center; gap: 10px; margin-top: 7px; }
  .focus-title-row h3 { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; font-weight: 720; letter-spacing: -.01em; }
  .focus-controls { display: flex; flex: none; gap: 5px; }
  .focus-controls a { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 8px; background: rgba(117,180,255,.13); color: #8ec5ff; font-size: 10px; }
  .focus-controls a:hover { background: rgba(117,180,255,.23); }
  .focus-controls .stop { color: #b3b7bf; background: rgba(255,255,255,.06); font-size: 8px; }
  .step-list { margin: 10px 0 0; padding: 8px 0 0; border-top: 1px solid rgba(255,255,255,.07); list-style: none; }
  .step-list li + li { margin-top: 3px; }
  .step-row { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 28px; padding: 4px 7px; border-radius: 8px; color: #aeb3bd; font-size: 11.5px; }
  .step-row:hover { color: #ecf4ff; background: rgba(117,180,255,.09); }
  .step-row.current { color: #f6f9fd; background: rgba(117,180,255,.16); font-weight: 650; }
  .step-row.completed { color: #6f7580; }
  .step-row.completed .step-label { text-decoration: line-through; }
  .step-mark { width: 15px; flex: none; color: #7bbcff; text-align: center; font-size: 9px; }
  .completed .step-mark { color: #737a85; font-size: 12px; }
  .step-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .step-time { flex: none; color: #6f7580; font-size: 10px; font-variant-numeric: tabular-nums; }
  .step-empty { margin-top: 9px; color: #747a85; font-size: 11px; }
  .quick-form { display: flex; align-items: stretch; gap: 6px; margin-top: 9px; }
  .quick-form input, .quick-form select { min-width: 0; height: 36px; border: 1px solid rgba(255,255,255,.09); outline: none; color: #f3f5f8; background: #1d2026; border-radius: 10px; }
  .quick-form input { flex: 1; padding: 0 11px; }
  .quick-form select { max-width: 130px; padding: 0 8px; color: #adb3bd; font-size: 11px; }
  .quick-form input::placeholder { color: #696f7a; }
  .quick-form input:focus, .quick-form select:focus { border-color: rgba(122,187,255,.58); box-shadow: 0 0 0 3px rgba(88,160,238,.1); }
  .quick-form button { width: 38px; flex: none; border: 0; border-radius: 10px; background: #74b5fa; color: #10151b; cursor: pointer; font-size: 20px; font-weight: 500; }
  .quick-form button:hover { background: #91c8ff; }
  .task-list { overflow: hidden; background: #20232a; border: 1px solid rgba(255,255,255,.07); border-radius: 13px; }
  .task-row { display: flex; align-items: center; gap: 8px; min-height: 43px; padding: 7px 9px 7px 11px; }
  .task-row + .task-row { border-top: 1px solid rgba(255,255,255,.055); }
  .task-row:hover { background: rgba(255,255,255,.025); }
  .task-status { width: 47px; flex: none; color: #747b87; font-size: 9px; font-weight: 720; letter-spacing: .03em; }
  .task-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cfd3da; font-size: 11.5px; }
  .task-due { flex: none; color: #888f9a; font-size: 9.5px; font-variant-numeric: tabular-nums; }
  .start-task { display: grid; place-items: center; width: 25px; height: 25px; flex: none; border-radius: 8px; color: #83beff; background: rgba(117,180,255,.1); font-size: 9px; }
  .start-task:hover { background: rgba(117,180,255,.2); }
  .empty-state { display: flex; flex-direction: column; align-items: center; padding: 22px 12px; color: #777e89; background: #20232a; border: 1px solid rgba(255,255,255,.07); border-radius: 14px; text-align: center; font-size: 11px; }
  .empty-state strong { margin: 8px 0 3px; color: #cbd0d8; font-size: 12px; }
  .empty-mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; color: #151920; background: #6e7785; font-size: 15px; font-weight: 900; }
  .list-empty { padding: 17px; color: #737984; background: #20232a; border: 1px solid rgba(255,255,255,.07); border-radius: 13px; text-align: center; font-size: 11px; }
  footer { padding: 8px 16px 14px; }
  .open-board { display: flex; justify-content: space-between; align-items: center; height: 34px; padding: 0 10px; border-radius: 9px; color: #9299a5; font-size: 11px; }
  .open-board:hover { color: #dce7f5; background: rgba(255,255,255,.045); }
  /* 잘린 제목은 마우스를 올린 동안 가로로 밀어서 끝까지 읽는다.
     tooltip보다 빠르고, 제목으로 작업을 구분하는 사용 방식에 맞다. */
  .scroll-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; scrollbar-width: none; }
  .scroll-title:hover { overflow-x: auto; overflow-y: hidden; text-overflow: clip; }
  /* macOS 오버레이 스크롤바는 제목 글자 위에 그려져 읽으려는 내용을 가린다. 완전히 없앤다. */
  .scroll-title::-webkit-scrollbar { display: none; height: 0; width: 0; }
</style></head><body><div id="app"></div><script>
  if (location.hash === "#opaque") document.documentElement.classList.add("opaque");
  // 타이머가 돌면 패널은 매 초 innerHTML을 통째로 갈아끼운다. 드래그 도중 그러면
  // 잡고 있던 노드가 사라져 드롭이 취소된다 — 끌고 있는 동안은 갱신을 미룬다.
  var dragging = null;
  var pendingHtml = null;
  window.__taskmasterSetContent = function (html) {
    if (dragging) { pendingHtml = html; return; }
    var app = document.getElementById("app");
    var previousMain = app.querySelector("main");
    var scrollTop = previousMain ? previousMain.scrollTop : 0;
    var scrolls = {};
    app.querySelectorAll("[data-scroll-key]").forEach(function (element) {
      if (element.scrollLeft) scrolls[element.getAttribute("data-scroll-key")] = element.scrollLeft;
    });
    var values = {};
    app.querySelectorAll("[data-preserve]").forEach(function (element) {
      values[element.getAttribute("data-preserve")] = element.value;
    });
    var activeKey = document.activeElement && document.activeElement.getAttribute
      ? document.activeElement.getAttribute("data-preserve")
      : null;
    app.innerHTML = html;
    var nextMain = app.querySelector("main");
    app.querySelectorAll("[data-scroll-key]").forEach(function (element) {
      var scrollLeft = scrolls[element.getAttribute("data-scroll-key")];
      if (scrollLeft) element.scrollLeft = scrollLeft;
    });
    app.querySelectorAll("[data-preserve]").forEach(function (element) {
      var key = element.getAttribute("data-preserve");
      if (Object.prototype.hasOwnProperty.call(values, key)) element.value = values[key];
    });
    // 포커스는 스크롤을 끌고 온다 — 단계 입력이 보이도록 컨테이너를 밀어버리면
    // 그 위의 AI 리포트가 화면 밖으로 나간다. 포커스는 스크롤 없이 주고 위치는 따로 복원한다.
    var focusTarget = activeKey ? app.querySelector('[data-preserve="' + activeKey + '"]') : null;
    if (!focusTarget) focusTarget = app.querySelector("[autofocus]");
    if (focusTarget) focusTarget.focus({ preventScroll: true });
    if (nextMain) nextMain.scrollTop = scrollTop;
  };
  function dispatch(url) { console.log("${ACTION_LOG_PREFIX}" + url); }
  document.addEventListener("click", function (event) {
    var target = event.target instanceof Element
      ? event.target.closest('a[href^="taskmaster-menu://"]')
      : null;
    if (!target) return;
    event.preventDefault();
    dispatch(target.href);
  });
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.action) return;
    event.preventDefault();
    var url = new URL(form.dataset.action);
    new FormData(form).forEach(function (value, key) { url.searchParams.set(key, String(value)); });
    var textInput = form.querySelector('input[name="value"]');
    if (!textInput || !textInput.value.trim()) return;
    textInput.value = "";
    dispatch(url.toString());
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") dispatch("taskmaster-menu://close");
  });

  function clearDropHints() {
    var marked = document.querySelectorAll(".drop-target, .dragging");
    for (var i = 0; i < marked.length; i += 1) {
      marked[i].classList.remove("drop-target");
      marked[i].classList.remove("dragging");
    }
  }
  function dropZoneOf(target) {
    return target instanceof Element ? target.closest("[data-drop]") : null;
  }
  document.addEventListener("dragstart", function (event) {
    var source = event.target instanceof Element ? event.target.closest("[data-drag]") : null;
    if (!source) return;
    dragging = { id: source.getAttribute("data-task-id"), from: source.getAttribute("data-drag") };
    source.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      try { event.dataTransfer.setData("text/plain", dragging.id); } catch (err) { /* 일부 환경은 거부한다 */ }
    }
  });
  document.addEventListener("dragend", function () {
    dragging = null;
    clearDropHints();
    if (pendingHtml != null) { var html = pendingHtml; pendingHtml = null; window.__taskmasterSetContent(html); }
  });
  document.addEventListener("dragover", function (event) {
    if (!dragging) return;
    var zone = dropZoneOf(event.target);
    if (!zone || zone.getAttribute("data-drop") === dragging.from) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    zone.classList.add("drop-target");
  });
  document.addEventListener("dragleave", function (event) {
    var zone = dropZoneOf(event.target);
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("drop-target");
  });
  document.addEventListener("drop", function (event) {
    if (!dragging) return;
    var zone = dropZoneOf(event.target);
    if (!zone) return;
    var to = zone.getAttribute("data-drop");
    if (to === dragging.from) return;
    event.preventDefault();
    var kind = to === "focus" ? "start-task" : "park-task";
    var id = dragging.id;
    dragging = null;
    clearDropHints();
    dispatch("taskmaster-menu://" + kind + "?taskId=" + encodeURIComponent(id));
  });
</script></body></html>`;
