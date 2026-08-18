// T-901 (task_01KZN31H): DOING 타이머 — 맥 메뉴바(Tray) 요구사항 스펙.
//
// 배너 오버레이와 병행: 메뉴바에 아이콘 + 경과 시간 상시 표시, 클릭하면 타이머별
// 시작/일시정지/스탑 메뉴. Electron 없이 FakeTrayPort로 검증한다.
// 실제 Tray 생성·아이콘 모양·클릭 감각은 tests/manual/timer-notifications.md 체크리스트.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App as ObsidianApp } from "obsidian";
import {
  TimerMenuBar,
  buildPinItems,
  createElectronTrayPort,
  menuBarTitle,
  mountTimerMenuBar,
  type TrayHandle,
  type TrayMenuItem,
  type TrayPort,
} from "../../../src/ui/timer/TimerMenuBar";
import {
  TaskTimerService,
  type TaskTimerSnapshot,
  type TimerPersistencePort,
} from "../../../src/services/TaskTimerService";
import { createTaskMasterStore } from "../../../src/store/taskMasterStore";
import { EventBus } from "../../../src/core/eventBus";
import { DiagnosticsLog } from "../../../src/core/diagnostics";
import { TaskRepository, BoardRepository } from "../../../src/repositories";
import { BoardService, TaskService } from "../../../src/services";
import type { TaskId } from "../../../src/core/types";
import type {
  FloatingDisplay,
  TimerFloatingController,
} from "../../../src/ui/timer/TimerFloatingWindow";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

class FakeTray implements TrayHandle {
  title = "";
  tooltip = "";
  items: TrayMenuItem[] = [];
  destroyed = false;

  setTitle(v: string): void { this.title = v; }
  setToolTip(v: string): void { this.tooltip = v; }
  setContextMenu(items: TrayMenuItem[]): void { this.items = items; }
  destroy(): void { this.destroyed = true; }
}

function fakePort(tray: FakeTray | null): TrayPort {
  return { create: () => tray };
}

class FakeFloatingController implements TimerFloatingController {
  open = false;
  displays: FloatingDisplay[] = [];
  displayId: string | null = null;
  readonly listeners = new Set<() => void>();
  isSupported(): boolean { return true; }
  isOpen(): boolean { return this.open; }
  listDisplays(): FloatingDisplay[] { return this.displays; }
  getDisplayId(): string | null { return this.displayId; }
  setDisplay(displayId: string | null): void {
    this.displayId = displayId;
    for (const listener of this.listeners) listener();
  }
  toggle(): boolean {
    this.open = !this.open;
    for (const listener of this.listeners) listener();
    return this.open;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * 서비스 그래프. useFakeClock=true면 주입 시계(tick으로 전진),
 * false면 Date.now (vi.useFakeTimers와 함께 사용).
 */
function buildGraph(useFakeClock: boolean) {
  const app = new ObsidianApp();
  const events = new EventBus();
  const diagnostics = new DiagnosticsLog();
  const store = createTaskMasterStore();
  const taskRepo = new TaskRepository(app, diagnostics, 500, "TaskMaster/Tasks", "TaskMaster/Archive");
  const boardRepo = new BoardRepository(app, diagnostics, "TaskMaster/.board.json", 500);
  const boardService = new BoardService(boardRepo, store, events);
  const taskService = new TaskService(taskRepo, boardService, store, events);
  const port: TimerPersistencePort = { load: async () => [], save: async () => {} };

  let clock = 0;
  const timers = useFakeClock
    ? new TaskTimerService(events, store, taskService, port, () => clock)
    : new TaskTimerService(events, store, taskService, port);

  return { store, taskService, timers, tick: (ms: number) => { clock += ms; } };
}

async function setup(useFakeClock = true) {
  const g = buildGraph(useFakeClock);
  await g.timers.init();
  const tray = new FakeTray();
  const bar = new TimerMenuBar(g.timers, fakePort(tray));
  bar.mount();
  return { ...g, tray, bar };
}

function snap(partial: Partial<TaskTimerSnapshot>): TaskTimerSnapshot {
  return {
    taskId: "task_x" as TaskId,
    title: "테스트",
    steps: [],
    currentStep: null,
    stepElapsedMs: [],
    phase: "idle",
    elapsedMs: 0,
    dismissed: false,
    enteredDoingAt: 0,
    ...partial,
  };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("menuBarTitle — 메뉴바 타이틀 규칙", () => {
  it("타이머 없으면 빈 문자열(아이콘만), phase별 심볼 + 경과, 여러 개면 +n", () => {
    expect(menuBarTitle([])).toBe("");
    expect(menuBarTitle([snap({ phase: "idle" })])).toBe("⏱ 00:00");
    expect(menuBarTitle([snap({ phase: "running", elapsedMs: 153_000 })])).toBe("▶ 02:33");
    expect(menuBarTitle([snap({ phase: "paused", elapsedMs: 250_000 })])).toBe("⏸ 04:10");
    // running이 있으면 idle보다 우선, 나머지 개수는 +n
    expect(
      menuBarTitle([
        snap({ phase: "idle" }),
        snap({ phase: "running", elapsedMs: 61_000 }),
        snap({ phase: "paused", elapsedMs: 10_000 }),
      ]),
    ).toBe("▶ 01:01 +2");
  });
});

describe("TimerMenuBar — 메뉴바 표시 (배너와 병행)", () => {
  it("[M1] mount하면 tray가 생기고, 타이머 없으면 타이틀은 비고 메뉴엔 '없음' 항목만", async () => {
    const s = await setup();
    expect(s.tray.tooltip).toBe("TaskMaster");
    expect(s.tray.title).toBe("");
    expect(s.tray.items).toHaveLength(1);
    expect(s.tray.items[0]?.enabled).toBe(false);
  });

  it("[M2] DOING 진입 시 메뉴바에 '⏱ 00:00'과 타이머 메뉴 항목이 뜬다", async () => {
    const s = await setup();
    await s.taskService.createTask({ title: "메뉴바로 보기", status: "doing" });

    expect(s.tray.title).toBe("⏱ 00:00");
    expect(s.tray.items).toHaveLength(1);
    expect(s.tray.items[0]?.label).toContain("메뉴바로 보기");
    expect(s.tray.items[0]?.label).toContain("00:00");
  });

  it("[M3] running 타이머는 tick마다 메뉴바 경과가 갱신된다", async () => {
    vi.useFakeTimers();
    try {
      const s = await setup(false); // Date.now 경로 — advanceTimersByTime으로 전진
      const task = await s.taskService.createTask({ title: "실시간", status: "doing" });
      s.timers.start(task.id);

      vi.advanceTimersByTime(3_000);

      expect(s.tray.title).toBe("▶ 00:03");
    } finally {
      vi.useRealTimers();
    }
  });

  it("[M4] 일시정지하면 '⏸'로 바뀌고 경과가 동결 표시된다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "정지표시", status: "doing" });
    s.timers.start(task.id);
    s.tick(5_000);
    s.timers.pause(task.id);

    expect(s.tray.title).toBe("⏸ 00:05");
  });

  it("[M5] 메뉴의 스탑을 누르면 태스크가 DONE이 되고 메뉴바에서 사라진다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "메뉴스탑", status: "doing" });
    s.timers.start(task.id);
    s.tick(4 * 60 * 60 * 1000); // 4시간

    const stopItem = s.tray.items[0]?.submenu?.find((i) => /stop/i.test(i.label));
    expect(stopItem).toBeTruthy();
    stopItem?.click?.();
    await flushAsync();

    expect(s.store.getState().tasks.get(task.id)?.status).toBe("done");
    expect(s.store.getState().tasks.get(task.id)?.actualMd).toBe(0.5);
    expect(s.tray.title).toBe("");
  });

  it("[M6] 스와이프로 숨긴(dismissed) 타이머도 메뉴바엔 남고, '배너 다시 표시'로 되살린다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "숨김복구", status: "doing" });
    s.timers.dismiss(task.id);

    // 배너는 숨었지만 메뉴바에는 계속 표시
    expect(s.tray.title).toBe("⏱ 00:00");
    const restoreItem = s.tray.items[0]?.submenu?.find((i) => /banner|배너/i.test(i.label));
    expect(restoreItem).toBeTruthy();

    restoreItem?.click?.();
    expect(s.timers.getTimer(task.id)?.dismissed).toBe(false);
  });

  it("[M7] phase에 따라 메뉴 액션이 바뀐다: idle=시작, running=일시정지, paused=재개", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "액션", status: "doing" });

    const labels = () => (s.tray.items[0]?.submenu ?? []).map((i) => i.label).join("|");
    expect(labels()).toMatch(/start/i);

    s.timers.start(task.id);
    expect(labels()).toMatch(/pause/i);

    s.timers.pause(task.id);
    expect(labels()).toMatch(/resume/i);
  });

  it("[M8] dispose하면 tray가 제거되고, 미지원 환경이면 mount가 조용히 실패한다", async () => {
    const s = await setup();
    s.bar.dispose();
    expect(s.tray.destroyed).toBe(true);
    // dispose 후 서비스 이벤트가 와도 죽지 않는다
    await s.taskService.createTask({ title: "사후", status: "doing" });

    const g = buildGraph(true);
    await g.timers.init();
    const bar = new TimerMenuBar(g.timers, fakePort(null));
    expect(bar.mount()).toBe(false);

    // jsdom엔 window.require가 없으므로 실제 Electron 경로도 null로 안전하게 끝난다
    expect(mountTimerMenuBar(g.timers)).toBeNull();
  });

  it("[M9] 메뉴 최상단에서 컴퓨터 화면 고정을 켜고 끌 수 있다", async () => {
    const g = buildGraph(true);
    await g.timers.init();
    await g.taskService.createTask({ title: "고정 메뉴", status: "doing" });
    const tray = new FakeTray();
    const floating = new FakeFloatingController();
    const bar = new TimerMenuBar(g.timers, fakePort(tray), floating);
    bar.mount();

    expect(tray.items[0]?.label).toMatch(/pin|고정/i);
    tray.items[0]?.click?.();
    expect(floating.open).toBe(true);
    expect(tray.items[0]?.label).toMatch(/unpin|해제/i);

    bar.dispose();
    expect(floating.listeners.size).toBe(0);
  });

  it("[M11] 모니터가 하나여도 선택 메뉴는 남는다 (열거 실패와 구분되어야 한다)", () => {
    const floating = new FakeFloatingController();
    floating.displays = [{ id: "1", label: "내장 (1512×982)", primary: true }];

    expect(buildPinItems(floating)[1]?.submenu).toHaveLength(2); // 자동 + 내장

    // 열거 자체가 불가능한 환경에서만 조용히 빠진다
    floating.displays = [];
    const withoutDisplays = buildPinItems(floating);
    expect(withoutDisplays).toHaveLength(2); // 고정 토글 + separator
    expect(withoutDisplays.some((i) => i.submenu != null)).toBe(false);
  });

  it("[M12] 모니터가 둘 이상이면 라디오 서브메뉴로 고를 수 있고 선택이 controller에 전달된다", () => {
    const floating = new FakeFloatingController();
    floating.displays = [
      { id: "1", label: "내장 (1512×982)", primary: true },
      { id: "2", label: "LG HDR 4K (3840×2160)", primary: false },
    ];

    const submenu = buildPinItems(floating)[1]?.submenu ?? [];

    // 기본값은 "자동" — 그때그때의 주 모니터를 따라간다
    expect(submenu[0]?.checked).toBe(true);
    expect(submenu).toHaveLength(3);
    expect(submenu[1]?.label).toContain("내장");
    expect(submenu[1]?.label).toMatch(/primary|주 모니터/i); // primary 표식
    expect(submenu[2]?.label).toContain("LG HDR 4K");
    expect(submenu.every((i) => i.type === "radio")).toBe(true);

    submenu[2]?.click?.();
    expect(floating.displayId).toBe("2");

    // 다시 그리면 고른 모니터에 체크가 옮겨간다
    const redrawn = buildPinItems(floating)[1]?.submenu ?? [];
    expect(redrawn[0]?.checked).toBe(false);
    expect(redrawn[2]?.checked).toBe(true);
  });

  it("[M13] 모니터를 바꾸면 메뉴바가 즉시 다시 그려진다", async () => {
    const g = buildGraph(true);
    await g.timers.init();
    const tray = new FakeTray();
    const floating = new FakeFloatingController();
    floating.displays = [
      { id: "1", label: "내장", primary: true },
      { id: "2", label: "외장", primary: false },
    ];
    const bar = new TimerMenuBar(g.timers, fakePort(tray), floating);
    bar.mount();

    tray.items[1]?.submenu?.[2]?.click?.();

    expect(tray.items[1]?.submenu?.[2]?.checked).toBe(true);
    bar.dispose();
  });

  it("[M10] hot reload로 tray를 다시 만들면 이전 전역 인스턴스를 제거한다", () => {
    const created: Array<{ destroyed: boolean }> = [];
    class FakeElectronTray {
      destroyed = false;
      constructor(_image: unknown) { created.push(this); }
      setTitle(): void {}
      setToolTip(): void {}
      setContextMenu(): void {}
      destroy(): void { this.destroyed = true; }
    }
    const remote = {
      Tray: FakeElectronTray,
      Menu: { buildFromTemplate: (items: unknown[]) => items },
      nativeImage: {
        createEmpty: () => ({ addRepresentation: () => {}, setTemplateImage: () => {} }),
      },
    };
    const target = window as Window & { require?: (id: string) => unknown };
    const originalRequire = target.require;
    target.require = () => remote;
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    try {
      const first = createElectronTrayPort().create();
      const second = createElectronTrayPort().create();
      expect(created).toHaveLength(2);
      expect(created[0]?.destroyed).toBe(true);
      expect(created[1]?.destroyed).toBe(false);
      second?.destroy();
      first?.destroy();
    } finally {
      canvas.mockRestore();
      if (originalRequire) target.require = originalRequire;
      else delete target.require;
    }
  });
});
