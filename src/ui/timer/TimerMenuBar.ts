// T-901 (task_01KZN31H): DOING 타이머 — 맥 메뉴바(Tray) 표시.
//
// 배너 오버레이(TimerNotificationStack)와 병행: 배너는 Obsidian 창 안에서만 보이므로,
// 다른 앱을 쓰는 동안에도 보이도록 메뉴바에 아이콘 + 경과 시간을 상시 표시한다.
// 클릭하면 타이머별 시작/일시정지/스탑(→DONE + actualMd 기록) 메뉴가 뜬다.
// 스펙: tests/ui/timer/TimerMenuBar.test.ts (M1~M8).
//
// Electron 접근:
// - Obsidian 데스크톱은 renderer에 @electron/remote를 노출한다 (obsidian-tray 플러그인과
//   동일 경로). Tray/Menu/nativeImage는 main-process API라 remote로만 접근 가능.
// - 공식 보장 API가 아니므로 전부 런타임 가드: 미지원 환경(모바일, remote 제거)이면
//   TrayPort.create()가 null을 반환하고 메뉴바 기능만 조용히 꺼진다. 배너는 영향 없음.
// - 테스트는 FakeTrayPort를 주입해 Electron 없이 검증한다.

import { t } from "../../i18n";
import {
  TIMER_TICK_MS,
  formatElapsed,
  type TaskTimerService,
  type TaskTimerSnapshot,
} from "../../services/TaskTimerService";
import type { TimerFloatingController } from "./TimerFloatingWindow";

const GLOBAL_TRAY_KEY = "__taskmasterTimerTray";

// ---------- Port (테스트 주입 지점) ----------

export interface TrayMenuItem {
  label: string;
  enabled?: boolean;
  click?: () => void;
  submenu?: TrayMenuItem[];
}

export interface TrayHandle {
  setTitle(title: string): void;
  setToolTip(tip: string): void;
  setContextMenu(items: TrayMenuItem[]): void;
  destroy(): void;
}

export interface TrayPort {
  /** 미지원 환경(모바일, remote 미노출)이면 null. */
  create(): TrayHandle | null;
}

// ---------- 표시 규칙 ----------

/**
 * 메뉴바 타이틀. 타이머 없으면 빈 문자열(아이콘만).
 * running이 있으면 그중 최신(입력 순서 = getTimers 순서) 기준,
 * 없으면 맨 앞 타이머 기준. 여러 개면 " +n"을 붙인다.
 * 예: "▶ 25:31", "⏸ 04:10 +2", "⏱ 00:00".
 */
export function menuBarTitle(timers: TaskTimerSnapshot[]): string {
  const primary = timers.find((timer) => timer.phase === "running") ?? timers[0];
  if (!primary) return "";
  const symbol = primary.phase === "running" ? "▶" : primary.phase === "paused" ? "⏸" : "⏱";
  const extra = timers.length > 1 ? ` +${timers.length - 1}` : "";
  return `${symbol} ${formatElapsed(primary.elapsedMs)}${extra}`;
}

/** dismissed 배너도 메뉴바에는 계속 나온다 — 되살리기(restore) 입구를 겸한다. */
function buildMenuItems(
  service: TaskTimerService,
  timers: TaskTimerSnapshot[],
  floatingWindow?: TimerFloatingController,
): TrayMenuItem[] {
  const pinItems: TrayMenuItem[] = floatingWindow?.isSupported()
    ? [{
        label: floatingWindow.isOpen() ? t("timer.floating.unpin") : t("timer.floating.pin"),
        click: () => floatingWindow.toggle(),
      }]
    : [];
  if (timers.length === 0) {
    return [...pinItems, { label: t("timer.menu.empty"), enabled: false }];
  }
  return [...pinItems, ...timers.map((timer) => ({
    label: `${truncate(timer.title, 28)} — ${formatElapsed(timer.elapsedMs)}`,
    submenu: [
      timer.phase === "running"
        ? { label: t("timer.pause"), click: () => service.pause(timer.taskId) }
        : {
            label: timer.phase === "paused" ? t("timer.resume") : t("timer.start"),
            click: () => service.start(timer.taskId),
          },
      { label: t("timer.stop"), click: () => void service.stop(timer.taskId) },
      ...(timer.dismissed
        ? [{ label: t("timer.restoreBanner"), click: () => service.restore(timer.taskId) }]
        : []),
    ],
  }))];
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ---------- Presenter ----------

export class TimerMenuBar {
  private handle: TrayHandle | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeFloating: (() => void) | null = null;
  private intervalId: number | null = null;

  constructor(
    private readonly service: TaskTimerService,
    private readonly port: TrayPort,
    private readonly floatingWindow?: TimerFloatingController,
    private readonly tickMs: number = TIMER_TICK_MS,
  ) {}

  /** @returns tray가 만들어졌으면 true. 미지원 환경이면 false (no-op). */
  mount(): boolean {
    if (this.handle) return true;
    const handle = this.port.create();
    if (!handle) return false;
    this.handle = handle;
    handle.setToolTip("TaskMaster");
    this.unsubscribe = this.service.subscribe(() => this.update());
    this.unsubscribeFloating = this.floatingWindow?.subscribe(() => this.update()) ?? null;
    // running 타이머가 있을 때만 초 단위 갱신. 시간 자체는 서비스가 wall-clock으로 계산.
    this.intervalId = window.setInterval(() => {
      if (this.service.getTimers().some((timer) => timer.phase === "running")) this.update();
    }, this.tickMs);
    this.update();
    return true;
  }

  /** tray 제거 + 구독 해제. plugin onunload에서 호출 (안 하면 아이콘이 고아로 남는다). */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeFloating?.();
    this.unsubscribeFloating = null;
    if (this.intervalId != null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.handle?.destroy();
    this.handle = null;
  }

  private update(): void {
    if (!this.handle) return;
    const timers = this.service.getTimers();
    this.handle.setTitle(menuBarTitle(timers));
    this.handle.setContextMenu(buildMenuItems(this.service, timers, this.floatingWindow));
  }
}

/** main.ts 진입점. 미지원 환경이면 null을 반환하고 아무것도 하지 않는다. */
export function mountTimerMenuBar(
  service: TaskTimerService,
  floatingWindow?: TimerFloatingController,
): (() => void) | null {
  const bar = new TimerMenuBar(service, createElectronTrayPort(), floatingWindow);
  return bar.mount() ? () => bar.dispose() : null;
}

// ---------- Electron 어댑터 ----------

interface NativeImageLike {
  addRepresentation(rep: { scaleFactor: number; dataURL: string }): void;
  setTemplateImage(flag: boolean): void;
}

interface ElectronTrayLike {
  setTitle(title: string): void;
  setToolTip(tip: string): void;
  setContextMenu(menu: unknown): void;
  destroy(): void;
}

interface ElectronRemoteLike {
  Tray: new (image: unknown) => ElectronTrayLike;
  Menu: { buildFromTemplate(template: unknown[]): unknown };
  nativeImage: { createEmpty(): NativeImageLike };
}

function resolveElectronRemote(): ElectronRemoteLike | null {
  const req = (window as Window & { require?: (id: string) => unknown }).require;
  if (typeof req !== "function") return null;
  for (const id of ["@electron/remote", "electron"]) {
    try {
      const mod = req(id) as { remote?: unknown } | undefined;
      const candidate = (id === "electron" ? mod?.remote : mod) as
        | ElectronRemoteLike
        | undefined;
      if (
        candidate &&
        typeof candidate.Tray === "function" &&
        candidate.Menu != null &&
        candidate.nativeImage != null
      ) {
        return candidate;
      }
    } catch {
      // 다음 후보 시도
    }
  }
  return null;
}

export function createElectronTrayPort(): TrayPort {
  return {
    create(): TrayHandle | null {
      const remote = resolveElectronRemote();
      if (!remote) return null;
      const globalWindow = window as Window & { [GLOBAL_TRAY_KEY]?: TrayHandle };
      // hot reload가 이전 dispose를 놓쳐도 renderer마다 status item은 하나만 유지한다.
      globalWindow[GLOBAL_TRAY_KEY]?.destroy();
      delete globalWindow[GLOBAL_TRAY_KEY];
      let tray: ElectronTrayLike;
      try {
        tray = new remote.Tray(createTrayImage(remote));
      } catch (err) {
        console.error("[TaskMaster] tray create failed", err);
        return null;
      }
      let handle!: TrayHandle;
      handle = {
        setTitle: (title) => tray.setTitle(title),
        setToolTip: (tip) => tray.setToolTip(tip),
        setContextMenu: (items) =>
          tray.setContextMenu(remote.Menu.buildFromTemplate(toElectronTemplate(items))),
        destroy: () => {
          tray.destroy();
          if (globalWindow[GLOBAL_TRAY_KEY] === handle) delete globalWindow[GLOBAL_TRAY_KEY];
        },
      };
      globalWindow[GLOBAL_TRAY_KEY] = handle;
      return handle;
    },
  };
}

function toElectronTemplate(items: TrayMenuItem[]): unknown[] {
  return items.map((item) => ({
    label: item.label,
    enabled: item.enabled ?? true,
    ...(item.click ? { click: item.click } : {}),
    ...(item.submenu ? { submenu: toElectronTemplate(item.submenu) } : {}),
  }));
}

/** 메뉴바용 template 이미지(라이트/다크 자동 반전). 그리기 실패 시 빈 이미지 → 텍스트만 표시. */
function createTrayImage(remote: ElectronRemoteLike): NativeImageLike {
  const image = remote.nativeImage.createEmpty();
  try {
    image.addRepresentation({ scaleFactor: 1, dataURL: drawStopwatch(16) });
    image.addRepresentation({ scaleFactor: 2, dataURL: drawStopwatch(32) });
    image.setTemplateImage(true);
  } catch {
    // canvas 미지원 환경 — 타이틀 텍스트만으로 동작
  }
  return image;
}

/** 검정 + 알파만 쓰는 스톱워치 글리프 (macOS template image 규칙). */
function drawStopwatch(px: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const u = px / 16;
  ctx.strokeStyle = "#000000";
  ctx.lineCap = "round";
  ctx.lineWidth = 1.5 * u;
  // 몸통
  ctx.beginPath();
  ctx.arc(8 * u, 9 * u, 5.2 * u, 0, Math.PI * 2);
  ctx.stroke();
  // 용두
  ctx.beginPath();
  ctx.moveTo(8 * u, 1.2 * u);
  ctx.lineTo(8 * u, 3.6 * u);
  ctx.stroke();
  // 바늘 (12시 + 3시 방향)
  ctx.beginPath();
  ctx.moveTo(8 * u, 9 * u);
  ctx.lineTo(8 * u, 5.8 * u);
  ctx.moveTo(8 * u, 9 * u);
  ctx.lineTo(10.4 * u, 9 * u);
  ctx.stroke();
  return canvas.toDataURL("image/png");
}
