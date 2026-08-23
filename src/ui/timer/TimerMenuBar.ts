// T-901 (task_01KZN31H): DOING 타이머 — 맥 메뉴바(Tray) 표시.
//
// Obsidian 내부 자동 배너 없이 메뉴바에 아이콘 + 경과 시간을 상시 표시한다.
// 좌클릭하면 빠른 작업 패널, 우클릭하면 타이머/화면 고정 네이티브 메뉴가 뜬다.
// 스펙: tests/ui/timer/TimerMenuBar.test.ts (M1~M8).
//
// Electron 접근:
// - Obsidian 데스크톱은 renderer에 @electron/remote를 노출한다 (obsidian-tray 플러그인과
//   동일 경로). Tray/Menu/nativeImage는 main-process API라 remote로만 접근 가능.
// - 공식 보장 API가 아니므로 전부 런타임 가드: 미지원 환경(모바일, remote 제거)이면
//   TrayPort.create()가 null을 반환하고 메뉴바 기능만 조용히 꺼진다. 배너는 영향 없음.
// - 테스트는 FakeTrayPort를 주입해 Electron 없이 검증한다.

import { t } from "../../i18n";
import { debugLog } from "./debugLog";
import {
  TIMER_TICK_MS,
  formatElapsed,
  type TaskTimerService,
  type TaskTimerSnapshot,
} from "../../services/TaskTimerService";
import type { TimerFloatingController } from "./TimerFloatingWindow";
import type {
  MenuBarAnchorRect,
  TaskMenuPopoverController,
} from "./TaskMenuPopover";
import taskmasterMenuBarIcon1x from "../../assets/taskmaster-menubar-16.png";
import taskmasterMenuBarIcon2x from "../../assets/taskmaster-menubar-32.png";

const GLOBAL_TRAY_KEY = "__taskmasterTimerTray";
const GLOBAL_TRAY_OWNER_KEY = "__taskmasterTimerTrayOwner";
// 사용자 제공 랏코에서 배경을 제거한 자산의 내장 fallback 표현.
// 실제 빌드는 src/assets의 투명 1x/2x PNG를 우선하고, 컬러 보존을 위해 자동 반전하지 않는다.
const TASKMASTER_ICON_1X = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAA0VXHyAAAB4ElEQVQoFZVSMU/bQBg9+86AbQkbJ7giiASJkYWh7VB1qUQjFVExMlb9If0NzEwsjCxdOiEhBiQQG0ultqrSVBShmAQTBzv2+a7vYgeBWODJts73vfe++77vCHkmtPt8Xdc17cEOolJKIcQdrQxTSqvVqmmaY4EcMVQUgjiOgyDI8xy/tJD6vu86DjIA8MuyPBcS+RhjlOowopRFUQQywwuSZZlwgmHG+WK99vHDO9Oc3D84Pvv+iwiBEDSFl8qAleO4cOJ53qjXtre+rG+8f/l6ZX31TTJh//jZSuNb0MIwhFLHqoQkaZatrb7tda/Pf/+9uQxM23q1vGS7rhRFSYqojgSo3uCRpDb3YmFmrtsLL8879ao/78+mNyE6Ae+CWQrwg6N6nndxlZDKbEU6VCMpJ3s7u73gijIqOC8Ed0fS0jRtNpufP23ak0KnRipolvP9wyOJvPdQFu26rsFYu91OkqwybVgT0vesk5PTr98ORmQNvS6KVqNBlxqNhmEwnAp5bNuyrSlvxvl3ESTDIaaB+jjPWq0/kKkMKGhKwcQak8LM4mQYdK8RLgYPx0EU9ft9EMpJY/jYpboOMQCPwgjXCDdiMBh0Oh21P+olviWgGd+l8dajy4cJqDKeCo38B7755pjAl1e1AAAAAElFTkSuQmCC";
const TASKMASTER_ICON_2X = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAFP0lEQVRIDe1WS2wbRRjet3fXXq8fiRonDkmUlAYEUaO2VJSGckGVCgdOcOFUiRMXDogLp3LiXh5SWglx4iFxQBVIwAFCiyLRhkKqopQGKWmDSZwmXj/WXj92l29m1rs2scSJAxLTaDr7zz/f9//f/DNjjvu//YMC/MB5URQVRUHPo3G8j39c4On7PrFFDQbOdd1Wq9XpdCJzd9TrSmwAzWQyhpHAgOuCMme4+t1lgYXnCTxpvut6tVptb3/P7bhslvVAiRpAc7lcMpkkUTN4ngsQAnQ/+oYlnOM4gec1TdM13bZtz/NC0D6C4eFhI5HwusuYEr05EqG6+hDtunMsOfDJsowokUpIIIUjzBmGAScsAwVdSxfSdJAQJIYOcBAEQZJEURB6nOgQinlePB5XFLnVajPkPgKsZFaBhcYi9Lm22wHekcOTD89MJuL65r3CnfWN3b2SIstA5DEXKslzIFaU2AACpMZiBweUxhZgFcatdmd87NAbr51/6uTRdCYFc6vhbNwrXPrwsyvfXMvkcnt/bHGgCTachBYGinG0B6qqJhIGTLQRP6yBJrmRocsXL5xaOKEpsud6wEIoQ0OZM0/Ox9PZmqDVLKtRqYa1i0G9XncchwFFBLFYLJFI0GKh6JQB9fDWm68eOz63sb6hq6osSyQpUj8e9mx2Or9lNXw1Xvh9vVtRZAttOyIIRKerog4MCKTdbmuq/MzpE19e+er6jRUtrsMuCLxANMd++ook/br8A6D1JKqDlSbww8NBAA8SAITUKf6gz6mT85IiPzQxrhrZL76+ZlWqxd39zfvbOLWoG0mWzyw80Wo1m/UGz+MksLIKehbvQQLYiUSExvenJvLxtDljju6tFrx22+l09q3KpQ8+v/ntqt/meIE7NjeXEUXHtoFO1nT/yAdtAwnYFMpPXLu72ajWjFT85Zeee/7swvLyT7quvn7+Rb3G10s16LV5f2f1xgpP6hvKBKAsQPYRnYNgkpYmvLG9zWYjmT60vlGOxzqprCZ2OueePS0KIpRJvTBfdRprt9dv/3KrXLbIoaOJg4Kk0sNwkIA4AN00zcMzMz/fXOGkV+qe5DeknVLVd5s+StX3my1XN7JFS/j4k08bDgpXIIJ2Y+xl6CMIiFH+njuSG1lcvLxf3DRlq1RzW5yp6mZMjUuS7Hnugwe7uDveef+9rV0rnTJpWRD4AKGHq48AHiRHettYloXPqekjorM1no85TtO2S/XKttNxkWM2JptDqdnpse+vkqcCDwaTliQRDDEire+g4Rlg3Kj1aqW6dmftkUcfkyQ+oUkIXE/oZiqZNhPptGGYyUqpcnHxo3q9SSS+GSHVUq123ERAj6M8gVBF3liQuLS01m82x0dzxxyfOnX260XDwak1OT+BetfZLF95+97e7G7GYQoHISpxNshGEK+KLRsmkkRvJ9T0GPm66Np5DPJ9H52a3t4vTU/nxfC4/lvvu6vUfV27htmBhksIgTxHJHxls7+yUy+Vgiv2HHvf46Oho+EmXhF8+iICCGEslC+9WTME1ITEfEmPXGwRwKxT+DN+cSCK82qhOIihNk6pF1rKNxzXHxsPDWbZPbCLoqYneFHggOEBRZ9JFJxlXG2jphcJw2VpWE5SOGjyPaBHWJcFgdeNzkBc3km3XegmiKoIjLnFV06AsxAwSRwlSDKIyWkjdM+ySk3em6TjYAChBvUnXRwBc/CaAHzjQQ/GBjRCxRlzo80rrp1at7hSLf/t11BNSSMpx2MDwh1ePefAQYaHSoDDaYI//uBUq/osZ8NxfecVdhVEu9/cAAAAASUVORK5CYII=";

// ---------- Port (테스트 주입 지점) ----------

export interface TrayMenuItem {
  /** separator면 무시된다 — "" 를 넣는다. */
  label: string;
  type?: "normal" | "separator" | "radio";
  checked?: boolean;
  enabled?: boolean;
  click?: () => void;
  submenu?: TrayMenuItem[];
}

export interface TrayHandle {
  setTitle(title: string): void;
  setToolTip(tip: string): void;
  setContextMenu(items: TrayMenuItem[]): void;
  /** 좌클릭은 빠른 작업 팝오버, 우클릭은 기존 네이티브 메뉴를 연다. */
  setClickHandler?(listener: () => void): void;
  getBounds?(): MenuBarAnchorRect;
  destroy(): void;
}

export interface TrayPort {
  /** 미지원 환경(모바일, remote 미노출)이면 null. */
  create(): TrayHandle | null;
}

// ---------- 표시 규칙 ----------

/** 메뉴바에는 랏코 아이콘만 둔다. 타이머 시간·상태는 클릭한 빠른 패널에서 본다. */
export function menuBarTitle(_timers: TaskTimerSnapshot[]): string {
  return "";
}

/**
 * 화면 고정 토글 + 어느 모니터에 띄울지 고르는 서브메뉴.
 *
 * 모니터가 하나여도 메뉴를 남긴다: "2개 이상일 때만" 숨기면 모니터 열거가 실패했을 때
 * 사용자에게 아무 신호도 안 남아 기능이 없는 것과 구분되지 않는다.
 * 열거 자체가 불가능한 환경(구버전 remote)에서만 조용히 빠진다.
 */
export function buildPinItems(floatingWindow?: TimerFloatingController): TrayMenuItem[] {
  if (!floatingWindow?.isSupported()) return [];
  const items: TrayMenuItem[] = [{
    label: floatingWindow.isOpen() ? t("timer.floating.unpin") : t("timer.floating.pin"),
    click: () => floatingWindow.toggle(),
  }];
  const displays = floatingWindow.listDisplays();
  if (displays.length > 0) {
    const selected = floatingWindow.getDisplayId();
    items.push({
      label: t("timer.floating.displayMenu"),
      submenu: [
        {
          label: t("timer.floating.displayAuto"),
          type: "radio",
          checked: selected == null,
          click: () => floatingWindow.setDisplay(null),
        },
        ...displays.map((display): TrayMenuItem => ({
          label: display.primary
            ? `${display.label} — ${t("timer.floating.displayPrimary")}`
            : display.label,
          type: "radio",
          checked: selected === display.id,
          click: () => floatingWindow.setDisplay(display.id),
        })),
      ],
    });
  }
  items.push({ label: "", type: "separator" });
  return items;
}

/** dismissed 배너도 메뉴바에는 계속 나온다 — 되살리기(restore) 입구를 겸한다. */
function buildMenuItems(
  service: TaskTimerService,
  timers: TaskTimerSnapshot[],
  floatingWindow?: TimerFloatingController,
): TrayMenuItem[] {
  const pinItems = buildPinItems(floatingWindow);
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
    private readonly popover?: TaskMenuPopoverController,
    private readonly tickMs: number = TIMER_TICK_MS,
  ) {}

  /** @returns tray가 만들어졌으면 true. 미지원 환경이면 false (no-op). */
  mount(): boolean {
    if (this.handle) return true;
    const handle = this.port.create();
    if (!handle) return false;
    this.handle = handle;
    handle.setToolTip("TaskMaster");
    handle.setClickHandler?.(() => {
      const bounds = handle.getBounds?.() ?? null;
      this.popover?.toggle(bounds);
    });
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
  popover?: TaskMenuPopoverController,
): (() => void) | null {
  const bar = new TimerMenuBar(service, createElectronTrayPort(), floatingWindow, popover);
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
  on?(event: "click" | "right-click", listener: () => void): void;
  popUpContextMenu?(menu: unknown): void;
  getBounds?(): MenuBarAnchorRect;
  destroy(): void;
}

interface ElectronRemoteLike {
  Tray: new (image: unknown) => ElectronTrayLike;
  Menu: { buildFromTemplate(template: unknown[]): unknown };
  nativeImage: { createEmpty(): NativeImageLike };
  /** Electron main process의 global. 여러 Obsidian renderer가 같은 Tray 소유권을 공유한다. */
  getGlobal?(name: string): unknown;
}

interface SharedTrayRegistry {
  [GLOBAL_TRAY_KEY]?: ElectronTrayLike;
  [GLOBAL_TRAY_OWNER_KEY]?: string;
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
      // 같은 renderer의 hot reload뿐 아니라 다른 renderer/창이 만든 Tray도 먼저 제거한다.
      // window 전역만 쓰면 이전 renderer가 남긴 status item을 새 renderer가 볼 수 없어
      // 아이콘과 오래된 click handler가 함께 복제된다.
      globalWindow[GLOBAL_TRAY_KEY]?.destroy();
      delete globalWindow[GLOBAL_TRAY_KEY];
      const sharedRegistry = resolveSharedTrayRegistry(remote);
      debugLog(`tray mount: registry=${sharedRegistry != null} hadShared=${
        sharedRegistry ? String(sharedRegistry[GLOBAL_TRAY_KEY] != null) : "n/a"}`);
      destroySharedTray(sharedRegistry);
      let tray: ElectronTrayLike;
      try {
        tray = new remote.Tray(createTrayImage(remote));
      } catch (err) {
        console.error("[TaskMaster] tray create failed", err);
        return null;
      }
      const owner = `taskmaster-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (sharedRegistry) {
        try {
          sharedRegistry[GLOBAL_TRAY_KEY] = tray;
          sharedRegistry[GLOBAL_TRAY_OWNER_KEY] = owner;
          // 쓰기가 실제로 메인 프로세스까지 갔는지 되읽어 확인한다. 여기가 조용히 실패하면
          // 리로드마다 Tray가 하나씩 쌓이고, 사용자가 누르는 아이콘이 죽은 것이 된다.
          debugLog(`tray registry write: readback=${String(sharedRegistry[GLOBAL_TRAY_KEY] != null)} owner=${
            String(sharedRegistry[GLOBAL_TRAY_OWNER_KEY] === owner)}`);
        } catch (err) {
          debugLog(`tray registry write failed: ${String(err)}`);
          console.warn("[TaskMaster] main-process tray registry unavailable", err);
        }
      }
      // 메인 프로세스 전역에 둔 Tray 참조는 renderer 리로드를 넘어가지 못한다(새 renderer는
      // hadShared=false로 본다). 그래서 사라지는 renderer가 죽기 전에 자기 Tray를 직접 치운다.
      // 이게 없으면 리로드마다 메뉴바 아이콘이 하나씩 쌓이고, 화면에 보이는 아이콘이
      // 죽은 것이 되어 눌러도 아무 일도 일어나지 않는다.
      const releaseOnUnload = (): void => {
        try {
          tray.destroy();
          debugLog("tray destroyed on renderer unload");
        } catch (err) {
          debugLog(`tray unload destroy failed: ${String(err)}`);
        }
      };
      window.addEventListener("beforeunload", releaseOnUnload);
      window.addEventListener("pagehide", releaseOnUnload);

      let handle!: TrayHandle;
      let clickHandler: (() => void) | null = null;
      let contextMenu: unknown = null;
      const supportsClickEvents = typeof tray.on === "function";
      if (supportsClickEvents) {
        tray.on?.("click", () => clickHandler?.());
        tray.on?.("right-click", () => {
          if (contextMenu != null) tray.popUpContextMenu?.(contextMenu);
        });
      }
      handle = {
        setTitle: (title) => tray.setTitle(title),
        setToolTip: (tip) => tray.setToolTip(tip),
        setContextMenu: (items) => {
          contextMenu = remote.Menu.buildFromTemplate(toElectronTemplate(items));
          // event API가 없는 구버전 Electron은 예전 네이티브 메뉴 동작을 유지한다.
          if (!supportsClickEvents) tray.setContextMenu(contextMenu);
        },
        setClickHandler: (listener) => { clickHandler = listener; },
        getBounds: () => tray.getBounds?.() ?? { x: 0, y: 0, width: 24, height: 24 },
        destroy: () => {
          window.removeEventListener("beforeunload", releaseOnUnload);
          window.removeEventListener("pagehide", releaseOnUnload);
          try {
            tray.destroy();
          } catch {
            // 이미 다른 renderer가 교체하며 제거한 Tray는 no-op으로 취급한다.
          }
          if (sharedRegistry) {
            try {
              if (sharedRegistry[GLOBAL_TRAY_OWNER_KEY] === owner) {
                delete sharedRegistry[GLOBAL_TRAY_KEY];
                delete sharedRegistry[GLOBAL_TRAY_OWNER_KEY];
              }
            } catch {
              // renderer 종료 중 remote bridge가 먼저 사라질 수 있다.
            }
          }
          if (globalWindow[GLOBAL_TRAY_KEY] === handle) delete globalWindow[GLOBAL_TRAY_KEY];
        },
      };
      globalWindow[GLOBAL_TRAY_KEY] = handle;
      return handle;
    },
  };
}

function resolveSharedTrayRegistry(remote: ElectronRemoteLike): SharedTrayRegistry | null {
  if (typeof remote.getGlobal !== "function") return null;
  try {
    const registry = remote.getGlobal("global");
    return registry && typeof registry === "object" ? registry as SharedTrayRegistry : null;
  } catch {
    return null;
  }
}

function destroySharedTray(registry: SharedTrayRegistry | null): void {
  if (!registry) return;
  try {
    registry[GLOBAL_TRAY_KEY]?.destroy();
    debugLog("tray registry: previous tray destroyed");
  } catch (err) {
    // 이전 renderer가 이미 종료한 remote object여도 새 Tray 생성은 계속한다.
    debugLog(`tray registry destroy failed: ${String(err)}`);
  }
  try {
    delete registry[GLOBAL_TRAY_KEY];
    delete registry[GLOBAL_TRAY_OWNER_KEY];
  } catch {
    // main-process registry 쓰기가 막힌 구버전 Electron에서는 renderer 방어만 사용한다.
  }
}

function toElectronTemplate(items: TrayMenuItem[]): unknown[] {
  return items.map((item) => item.type === "separator"
    ? { type: "separator" }
    : {
        label: item.label,
        enabled: item.enabled ?? true,
        ...(item.type ? { type: item.type } : {}),
        ...(item.checked == null ? {} : { checked: item.checked }),
        ...(item.click ? { click: item.click } : {}),
        ...(item.submenu ? { submenu: toElectronTemplate(item.submenu) } : {}),
      });
}

/** 투명 배경 랏코를 1x/2x로 넣은 메뉴바 이미지. 실패 시 빈 이미지 → 텍스트만 표시. */
function createTrayImage(remote: ElectronRemoteLike): NativeImageLike {
  const image = remote.nativeImage.createEmpty();
  try {
    image.addRepresentation({
      scaleFactor: 1,
      dataURL: taskmasterMenuBarIcon1x || TASKMASTER_ICON_1X,
    });
    image.addRepresentation({
      scaleFactor: 2,
      dataURL: taskmasterMenuBarIcon2x || TASKMASTER_ICON_2X,
    });
    image.setTemplateImage(false);
  } catch {
    // nativeImage representation 미지원 환경 — 타이틀 텍스트만으로 동작
  }
  return image;
}
