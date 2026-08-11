// T-901 (task_01KZN31H): DOING 타이머 — 맥 메뉴바(Tray) 요구사항 스펙.
//
// 배너 오버레이와 병행: 메뉴바에 아이콘 + 경과 시간 상시 표시, 클릭하면 타이머별
// 시작/일시정지/스탑 메뉴. Electron 없이 FakeTrayPort로 검증한다.
// 실제 Tray 생성·아이콘 모양·클릭 감각은 tests/manual/timer-notifications.md 체크리스트.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App as ObsidianApp } from "obsidian";
import {
  TimerMenuBar,
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
});
