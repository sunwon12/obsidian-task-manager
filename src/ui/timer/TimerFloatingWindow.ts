// 데스크톱 화면 위에 고정하는 TaskMaster 타이머 창.
//
// Obsidian renderer 내부 오버레이와 달리 Electron BrowserWindow를 별도로 만들어
// 다른 앱이 활성화되어도 항상 위에 표시한다. Electron remote가 없는 모바일/웹 환경은
// 지원 여부를 false로 보고 UI 토글 자체를 숨긴다.

import { t } from "../../i18n";
import {
  TIMER_TICK_MS,
  formatElapsed,
  type TaskTimerService,
  type TaskTimerSnapshot,
} from "../../services/TaskTimerService";
import type { TaskId } from "../../core/types";

const FLOATING_WIDTH = 380;
const FLOATING_MARGIN = 16;
const ACTION_LOG_PREFIX = "__TASKMASTER_TIMER_ACTION__";
const FLOATING_TITLE = "TaskMaster Timer";

export interface FloatingWindowHandle {
  setContent(html: string, height: number): void;
  close(): void;
}

export interface FloatingWindowPort {
  isSupported(): boolean;
  create(onAction: (action: FloatingWindowAction) => void): FloatingWindowHandle | null;
  closeExisting?(): void;
}

export type FloatingWindowAction =
  | { kind: "select-step"; taskId: TaskId; step: number }
  | { kind: "start" | "pause" | "stop"; taskId: TaskId }
  | { kind: "close" };

/** React 토글이 Electron 구현을 직접 알지 않도록 하는 최소 인터페이스. */
export interface TimerFloatingController {
  isSupported(): boolean;
  isOpen(): boolean;
  toggle(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface FloatingTimerContent {
  html: string;
  height: number;
}

export class TimerFloatingWindow implements TimerFloatingController {
  private handle: FloatingWindowHandle | null = null;
  private unsubscribeService: (() => void) | null = null;
  private intervalId: number | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly service: TaskTimerService,
    private readonly port: FloatingWindowPort,
    private readonly tickMs: number = TIMER_TICK_MS,
  ) {}

  isSupported(): boolean {
    return this.port.isSupported();
  }

  isOpen(): boolean {
    return this.handle != null;
  }

  toggle(): boolean {
    if (this.handle) {
      this.close();
      return false;
    }
    return this.open();
  }

  open(): boolean {
    if (this.handle) return true;
    const handle = this.port.create((action) => this.handleAction(action));
    if (!handle) return false;
    this.handle = handle;
    this.unsubscribeService = this.service.subscribe(() => this.update());
    this.intervalId = window.setInterval(() => {
      if (this.service.getTimers().some((timer) => timer.phase === "running")) this.update();
    }, this.tickMs);
    this.update();
    this.emit();
    return true;
  }

  close(): void {
    this.unsubscribeService?.();
    this.unsubscribeService = null;
    if (this.intervalId != null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.handle?.close();
    this.handle = null;
    // 이전 plugin instance가 만든 겹친 창까지 함께 정리한다.
    this.port.closeExisting?.();
    this.emit();
  }

  dispose(): void {
    this.close();
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(): void {
    if (!this.handle) return;
    const content = renderFloatingTimers(this.service.getTimers());
    this.handle.setContent(content.html, content.height);
  }

  private handleAction(action: FloatingWindowAction): void {
    switch (action.kind) {
      case "select-step":
        void this.service.selectStep(action.taskId, action.step);
        break;
      case "start":
        this.service.start(action.taskId);
        break;
      case "pause":
        this.service.pause(action.taskId);
        break;
      case "stop":
        void this.service.stop(action.taskId);
        break;
      case "close":
        this.close();
        break;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 외부 창 본문. 모든 vault 문자열을 escape해 HTML로 삽입한다. */
export function renderFloatingTimers(timers: TaskTimerSnapshot[]): FloatingTimerContent {
  const html = timers.length === 0
    ? `<div class="empty">${escapeHtml(t("timer.menu.empty"))}</div>`
    : timers.map(renderTimer).join("");
  const rowCount = timers.reduce((sum, timer) => sum + Math.max(timer.steps.length, 1), 0);
  return {
    html,
    height: Math.min(760, Math.max(76, timers.length * 64 + rowCount * 29 + 20)),
  };
}

function renderTimer(timer: TaskTimerSnapshot): string {
  const steps = timer.steps.map((step, index) => {
    const number = index + 1;
    const state = timer.currentStep == null
      ? "pending"
      : number < timer.currentStep
        ? "completed"
        : number === timer.currentStep
          ? "current"
          : "pending";
    const mark = state === "completed" ? "✓" : state === "current" ? "→" : String(number);
    return `<li><a class="step ${state}" href="${actionUrl("select-step", timer.taskId, number)}">
        <span class="mark">${mark}</span>
        <span class="label" title="${escapeHtml(step)}">${escapeHtml(step)}</span>
        <span class="elapsed">${formatElapsed(timer.stepElapsedMs[index] ?? 0)}</span>
      </a></li>`;
  }).join("");
  const phase = timer.phase === "running" ? "▶" : timer.phase === "paused" ? "⏸" : "⏱";
  const primaryAction = timer.phase === "running" ? "pause" : "start";
  const primaryLabel = timer.phase === "running"
    ? t("timer.pause")
    : timer.phase === "paused"
      ? t("timer.resume")
      : t("timer.start");
  return `<section class="timer">
    <header>
      <span class="title" title="${escapeHtml(timer.title)}">${escapeHtml(timer.title)}</span>
      <span class="total">${phase} ${formatElapsed(timer.elapsedMs)}</span>
      <nav>
        <a class="control" href="${actionUrl(primaryAction, timer.taskId)}" title="${escapeHtml(primaryLabel)}">${timer.phase === "running" ? "Ⅱ" : "▶"}</a>
        <a class="control" href="${actionUrl("stop", timer.taskId)}" title="${escapeHtml(t("timer.stop"))}">■</a>
        <a class="control close" href="taskmaster-timer://close" title="${escapeHtml(t("timer.floating.unpin"))}">×</a>
      </nav>
    </header>
    ${steps ? `<ol>${steps}</ol>` : ""}
  </section>`;
}

function actionUrl(kind: string, taskId: TaskId, step?: number): string {
  const query = `taskId=${encodeURIComponent(taskId)}` + (step == null ? "" : `&step=${step}`);
  return `taskmaster-timer://${kind}?${query}`;
}

export function parseFloatingAction(url: string): FloatingWindowAction | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "taskmaster-timer:") return null;
    if (parsed.hostname === "close") return { kind: "close" };
    const taskId = parsed.searchParams.get("taskId") as TaskId | null;
    if (!taskId) return null;
    if (parsed.hostname === "select-step") {
      const step = Number(parsed.searchParams.get("step"));
      return Number.isInteger(step) && step > 0
        ? { kind: "select-step", taskId, step }
        : null;
    }
    if (["start", "pause", "stop"].includes(parsed.hostname)) {
      return { kind: parsed.hostname as "start" | "pause" | "stop", taskId };
    }
    return null;
  } catch {
    return null;
  }
}

/** sandboxed floating page가 console bridge로 보낸 action만 해석한다. */
export function parseFloatingConsoleAction(message: string): FloatingWindowAction | null {
  return message.startsWith(ACTION_LOG_PREFIX)
    ? parseFloatingAction(message.slice(ACTION_LOG_PREFIX.length))
    : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------- Electron 어댑터 ----------

interface BrowserWindowLike {
  webContents: {
    on(event: "did-finish-load", listener: () => void): void;
    on(
      event: "will-navigate",
      listener: (event: { preventDefault(): void }, url: string) => void,
    ): void;
    on(
      event: "console-message",
      listener: (event: unknown, ...args: unknown[]) => void,
    ): void;
    executeJavaScript(script: string): Promise<unknown>;
    getURL?(): string;
  };
  loadURL(url: string): Promise<void>;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  setVisibleOnAllWorkspaces?(flag: boolean, options?: { visibleOnFullScreen?: boolean }): void;
  showInactive?(): void;
  show(): void;
  close(): void;
  getTitle?(): string;
  getBounds?(): { width: number; height: number; x: number; y: number };
  isAlwaysOnTop?(): boolean;
}

interface ElectronRemoteLike {
  BrowserWindow: {
    new (options: Record<string, unknown>): BrowserWindowLike;
    getAllWindows?(): BrowserWindowLike[];
  };
  screen: {
    getPrimaryDisplay(): { workArea: { x: number; y: number; width: number; height: number } };
  };
}

function resolveElectronRemote(): ElectronRemoteLike | null {
  const req = (window as Window & { require?: (id: string) => unknown }).require;
  if (typeof req !== "function") return null;
  for (const id of ["@electron/remote", "electron"]) {
    try {
      const mod = req(id) as { remote?: unknown } | undefined;
      const candidate = (id === "electron" ? mod?.remote : mod) as ElectronRemoteLike | undefined;
      if (
        candidate &&
        typeof candidate.BrowserWindow === "function" &&
        candidate.screen != null
      ) return candidate;
    } catch {
      // 다음 후보 시도
    }
  }
  return null;
}

export function createElectronFloatingWindowPort(): FloatingWindowPort {
  const initialRemote = resolveElectronRemote();
  // hot reload 전에 생성된 구버전 창은 새 controller가 handle을 갖고 있지 않으므로
  // port가 만들어지는 즉시 process의 BrowserWindow 목록에서 찾아 제거한다.
  if (initialRemote) closeExistingFloatingWindows(initialRemote);
  return {
    isSupported: () => resolveElectronRemote() != null,
    closeExisting(): void {
      const remote = resolveElectronRemote();
      if (remote) closeExistingFloatingWindows(remote);
    },
    create(onAction: (action: FloatingWindowAction) => void): FloatingWindowHandle | null {
      const remote = resolveElectronRemote();
      if (!remote) return null;
      closeExistingFloatingWindows(remote);
      const area = remote.screen.getPrimaryDisplay().workArea;
      let browser: BrowserWindowLike;
      try {
        browser = new remote.BrowserWindow({
          width: FLOATING_WIDTH,
          height: 120,
          title: FLOATING_TITLE,
          x: area.x + area.width - FLOATING_WIDTH - FLOATING_MARGIN,
          y: area.y + FLOATING_MARGIN,
          frame: false,
          transparent: true,
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
        console.error("[TaskMaster] floating timer window create failed", err);
        return null;
      }

      let ready = false;
      let latest = "";
      let latestHeight = 120;
      const commit = (): void => {
        const height = Math.min(latestHeight, area.height - FLOATING_MARGIN * 2);
        browser.setBounds({
          x: area.x + area.width - FLOATING_WIDTH - FLOATING_MARGIN,
          y: area.y + FLOATING_MARGIN,
          width: FLOATING_WIDTH,
          height,
        });
        if (ready) {
          const script = `document.getElementById("app").innerHTML = ${JSON.stringify(latest)}`;
          void browser.webContents.executeJavaScript(script).catch((err: unknown) => {
            console.error("[TaskMaster] floating timer window update failed", err);
          });
        }
      };
      browser.webContents.on("did-finish-load", () => {
        ready = true;
        commit();
        browser.showInactive?.();
        if (!browser.showInactive) browser.show();
      });
      browser.webContents.on("will-navigate", (event, url) => {
        const action = parseFloatingAction(url);
        if (!action) return;
        event.preventDefault();
        onAction(action);
      });
      // Obsidian/Electron 버전에 따라 custom protocol의 will-navigate가 생략될 수 있어
      // sandbox page의 click bridge를 기본 경로로 함께 사용한다.
      browser.webContents.on("console-message", (_event, ...args) => {
        const legacyMessage = args.find((value): value is string => typeof value === "string");
        const details = args.find((value): value is { message: string } =>
          typeof value === "object" && value != null &&
          "message" in value && typeof value.message === "string",
        );
        const message = legacyMessage ?? details?.message ?? "";
        const action = parseFloatingConsoleAction(message);
        if (action) onAction(action);
      });
      browser.setAlwaysOnTop(true, "floating");
      browser.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
      void browser.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(FLOATING_DOCUMENT)}`);

      return {
        setContent(html, height): void {
          latest = html;
          latestHeight = height;
          commit();
        },
        close: () => browser.close(),
      };
    },
  };
}

function closeExistingFloatingWindows(remote: ElectronRemoteLike): void {
  for (const candidate of remote.BrowserWindow.getAllWindows?.() ?? []) {
    try {
      if (!isTaskMasterFloatingWindow(candidate)) continue;
      candidate.close();
    } catch (err) {
      console.error("[TaskMaster] stale floating timer cleanup failed", err);
    }
  }
}

function isTaskMasterFloatingWindow(candidate: BrowserWindowLike): boolean {
  if (candidate.getTitle?.() === FLOATING_TITLE) return true;
  const bounds = candidate.getBounds?.();
  const url = candidate.webContents.getURL?.() ?? "";
  if (bounds?.width !== FLOATING_WIDTH || candidate.isAlwaysOnTop?.() !== true) return false;
  if (!url.startsWith("data:text/html;charset=utf-8,")) return false;
  try {
    const documentSource = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    return documentSource.includes('<main id="app"></main>') &&
      documentSource.includes(".timer {");
  } catch {
    return false;
  }
}

const FLOATING_DOCUMENT = `<!doctype html>
<html><head><meta charset="utf-8"><title>${FLOATING_TITLE}</title><style>
  :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  #app { max-height: 100vh; overflow-y: auto; padding: 6px; }
  .timer { margin-bottom: 7px; padding: 10px 11px; color: #202124; background: rgba(250,250,250,.96); border: 1px solid rgba(0,0,0,.12); border-radius: 12px; box-shadow: 0 5px 18px rgba(0,0,0,.2); }
  .timer:last-child { margin-bottom: 0; }
  header { display: flex; gap: 8px; align-items: center; min-width: 0; }
  .title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 650; }
  .total, .elapsed { flex: none; font-variant-numeric: tabular-nums; font-size: 12px; }
  nav { display: flex; flex: none; gap: 3px; }
  .control { display: grid; place-items: center; width: 22px; height: 22px; color: inherit; background: rgba(0,0,0,.08); border-radius: 50%; text-decoration: none; font-size: 11px; cursor: pointer; }
  .control:hover { background: rgba(124,58,237,.2); }
  .control.close { font-size: 17px; }
  ol { margin: 8px 0 0; padding: 7px 0 0; border-top: 1px solid rgba(0,0,0,.1); list-style: none; }
  .step { display: flex; align-items: center; gap: 7px; min-width: 0; height: 25px; margin-top: 3px; padding: 2px 7px; color: inherit; border-radius: 6px; background: rgba(0,0,0,.07); text-decoration: none; font-size: 12px; cursor: pointer; }
  .step:hover { background: rgba(124,58,237,.18); }
  .step.current { color: white; background: #7c3aed; font-weight: 650; }
  .step.completed { color: #6b7280; text-decoration: line-through; }
  .mark { width: 15px; flex: none; text-align: center; }
  .label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { padding: 18px; color: #4b5563; background: rgba(250,250,250,.96); border-radius: 12px; box-shadow: 0 5px 18px rgba(0,0,0,.2); text-align: center; font-size: 13px; }
  @media (prefers-color-scheme: dark) {
    .timer { color: #f4f4f5; background: rgba(35,35,38,.96); border-color: rgba(255,255,255,.13); }
    ol { border-color: rgba(255,255,255,.11); }
    .step { background: rgba(255,255,255,.09); }
    .step.current { background: #7c3aed; }
    .control { background: rgba(255,255,255,.1); }
    .step.completed { color: #a1a1aa; }
    .empty { color: #d4d4d8; background: rgba(35,35,38,.96); }
  }
</style></head><body><main id="app"></main><script>
  document.addEventListener("click", function (event) {
    var target = event.target instanceof Element
      ? event.target.closest('a[href^="taskmaster-timer://"]')
      : null;
    if (!target) return;
    event.preventDefault();
    console.log("${ACTION_LOG_PREFIX}" + target.href);
  });
</script></body></html>`;
