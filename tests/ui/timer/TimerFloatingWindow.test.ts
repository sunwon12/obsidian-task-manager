import { describe, expect, it, vi } from "vitest";
import { App as ObsidianApp } from "obsidian";
import {
  TimerFloatingWindow,
  createElectronFloatingWindowPort,
  parseFloatingAction,
  parseFloatingConsoleAction,
  renderFloatingTimers,
  type FloatingWindowHandle,
  type FloatingWindowPort,
} from "../../../src/ui/timer/TimerFloatingWindow";
import { TaskTimerService, type TimerPersistencePort } from "../../../src/services/TaskTimerService";
import { createTaskMasterStore } from "../../../src/store/taskMasterStore";
import { EventBus } from "../../../src/core/eventBus";
import { DiagnosticsLog } from "../../../src/core/diagnostics";
import { TaskRepository, BoardRepository } from "../../../src/repositories";
import { BoardService, TaskService } from "../../../src/services";
import type { TaskId } from "../../../src/core/types";

class FakeFloatingHandle implements FloatingWindowHandle {
  html = "";
  height = 0;
  closed = false;
  setContent(html: string, height: number): void {
    this.html = html;
    this.height = height;
  }
  close(): void { this.closed = true; }
}

function buildGraph() {
  const app = new ObsidianApp();
  const events = new EventBus();
  const diagnostics = new DiagnosticsLog();
  const store = createTaskMasterStore();
  const taskRepo = new TaskRepository(app, diagnostics, 500, "TaskMaster/Tasks", "TaskMaster/Archive");
  const boardRepo = new BoardRepository(app, diagnostics, "TaskMaster/.board.json", 500);
  const boardService = new BoardService(boardRepo, store, events);
  const taskService = new TaskService(taskRepo, boardService, store, events);
  const persistence: TimerPersistencePort = { load: async () => [], save: async () => {} };
  let now = 0;
  const timers = new TaskTimerService(events, store, taskService, persistence, () => now);
  return { taskService, timers, tick: (ms: number) => { now += ms; } };
}

describe("TimerFloatingWindow — 컴퓨터 화면 상단 고정", () => {
  it("타이머와 현재 단계/단계 시간을 외부 창용 HTML로 안전하게 렌더링한다", () => {
    const rendered = renderFloatingTimers([{
      taskId: "task_x" as TaskId,
      title: "<외부 창>",
      steps: ["조사", "긴 URL https://example.com/path"],
      currentStep: 2,
      stepElapsedMs: [5_000, 61_000],
      phase: "running",
      elapsedMs: 66_000,
      dismissed: false,
      enteredDoingAt: 0,
    }]);

    expect(rendered.html).toContain("&lt;외부 창&gt;");
    expect(rendered.html).not.toContain("<외부 창>");
    expect(rendered.html).toContain('class="step current"');
    expect(rendered.html).toContain("taskmaster-timer://select-step");
    expect(rendered.html).toContain("taskmaster-timer://pause");
    expect(rendered.html).toContain("taskmaster-timer://stop");
    expect(rendered.html).toContain("01:01");
    expect(rendered.height).toBeGreaterThan(76);
  });

  it("외부 창 action URL만 허용하고 단계/컨트롤 동작으로 파싱한다", () => {
    expect(parseFloatingAction("taskmaster-timer://select-step?taskId=task_x&step=2"))
      .toEqual({ kind: "select-step", taskId: "task_x", step: 2 });
    expect(parseFloatingAction("taskmaster-timer://pause?taskId=task_x"))
      .toEqual({ kind: "pause", taskId: "task_x" });
    expect(parseFloatingAction("taskmaster-timer://close")).toEqual({ kind: "close" });
    expect(parseFloatingAction("https://example.com")).toBeNull();
    expect(parseFloatingConsoleAction(
      "__TASKMASTER_TIMER_ACTION__taskmaster-timer://close/",
    )).toEqual({ kind: "close" });
    expect(parseFloatingConsoleAction("taskmaster-timer://close/")).toBeNull();
  });

  it("토글하면 외부 창을 열어 즉시 갱신하고, 다시 누르면 닫는다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const task = await graph.taskService.createTask({
      title: "고정할 태스크",
      status: "doing",
      steps: ["분석", "검증"],
    });
    const handle = new FakeFloatingHandle();
    let dispatch!: Parameters<FloatingWindowPort["create"]>[0];
    const port: FloatingWindowPort = {
      isSupported: () => true,
      create: (onAction) => {
        dispatch = onAction;
        return handle;
      },
    };
    const floating = new TimerFloatingWindow(graph.timers, port);
    const listener = vi.fn();
    floating.subscribe(listener);

    expect(floating.toggle()).toBe(true);
    expect(handle.html).toContain("고정할 태스크");
    graph.timers.start(task.id);
    graph.tick(3_000);
    graph.timers.pause(task.id);
    expect(handle.html).toContain("00:03");

    dispatch({ kind: "select-step", taskId: task.id, step: 2 });
    await vi.waitFor(() => {
      expect(graph.timers.getTimer(task.id)?.currentStep).toBe(2);
    });
    dispatch({ kind: "start", taskId: task.id });
    expect(graph.timers.getTimer(task.id)?.phase).toBe("running");

    dispatch({ kind: "close" });
    expect(floating.isOpen()).toBe(false);
    expect(handle.closed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("Electron 미지원 환경에서는 열지 않고 조용히 실패한다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const port: FloatingWindowPort = { isSupported: () => false, create: () => null };
    const floating = new TimerFloatingWindow(graph.timers, port);
    expect(floating.isSupported()).toBe(false);
    expect(floating.toggle()).toBe(false);
    expect(floating.isOpen()).toBe(false);
  });

  it("port 초기화 시 hot reload에서 남은 구버전 고정 창을 찾아 닫는다", () => {
    const stale = {
      closed: false,
      close(): void { this.closed = true; },
      getTitle: () => "",
      getBounds: () => ({ width: 380, height: 500, x: 0, y: 0 }),
      isAlwaysOnTop: () => true,
      webContents: {
        getURL: () => "data:text/html;charset=utf-8," + encodeURIComponent(
          '<style>.timer { color: black; }</style><main id="app"></main>',
        ),
      },
    };
    class FakeBrowserWindow {
      static getAllWindows(): unknown[] { return [stale]; }
    }
    const remote = {
      BrowserWindow: FakeBrowserWindow,
      screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) },
    };
    const target = window as Window & { require?: (id: string) => unknown };
    const originalRequire = target.require;
    target.require = () => remote;
    try {
      createElectronFloatingWindowPort();
      expect(stale.closed).toBe(true);
    } finally {
      if (originalRequire) target.require = originalRequire;
      else delete target.require;
    }
  });
});
