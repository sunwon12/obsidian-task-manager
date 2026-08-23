import { beforeEach, describe, expect, it, vi } from "vitest";
import { App as ObsidianApp } from "obsidian";
import {
  TaskMenuPopover,
  createElectronTaskMenuPopoverPort,
  parseTaskMenuPopoverAction,
  parseTaskMenuPopoverConsoleAction,
  popoverBounds,
  renderTaskMenuPopover,
  type MenuBarAnchorRect,
  type TaskMenuPopoverAction,
  type TaskMenuPopoverCloseOptions,
  type TaskMenuPopoverHandle,
  type TaskMenuPopoverPort,
  type AiReportPanelState,
  type AiDraftPanelState,
  POPOVER_DOCUMENT,
} from "../../../src/ui/timer/TaskMenuPopover";
import { parseAiReport } from "../../../src/core/aiReport";
import type { AiReportController, AiReportState } from "../../../src/services/AiReportService";
import type { AiDraftController } from "../../../src/services/AiDraftService";
import { TaskTimerService, type TimerPersistencePort } from "../../../src/services/TaskTimerService";
import { createTaskMasterStore } from "../../../src/store/taskMasterStore";
import { EventBus } from "../../../src/core/eventBus";
import { DiagnosticsLog } from "../../../src/core/diagnostics";
import { TaskRepository, BoardRepository } from "../../../src/repositories";
import { BoardService, TaskService } from "../../../src/services";
import { __setLocaleForTest } from "../../../src/i18n";

beforeEach(() => {
  __setLocaleForTest("ko");
});

class FakePopoverHandle implements TaskMenuPopoverHandle {
  html = "";
  height = 0;
  closed = false;
  closeOptions: TaskMenuPopoverCloseOptions | undefined;
  setContent(html: string, height: number): void {
    this.html = html;
    this.height = height;
  }
  close(options?: TaskMenuPopoverCloseOptions): void {
    this.closed = true;
    this.closeOptions = options;
  }
}

const REPORT_MD = `## 2026-08-22 (토)

**스냅샷** — doing 2개, hold 1개.

- **레버리지 1위는 관측 공백이다** — 이펙티브 엔지니어.

**오늘의 하이라이트** — 보드를 현실과 맞추기 30분.
`;

function reportState(overrides: Partial<AiReportPanelState> = {}): AiReportPanelState {
  return {
    status: "idle",
    report: parseAiReport(REPORT_MD),
    error: null,
    collapsed: false,
    stale: false,
    runningSeconds: 0,
    ...overrides,
  };
}

class FakeReportController implements AiReportController {
  state: AiReportState = { status: "idle", report: parseAiReport(REPORT_MD), error: null, startedAt: null };
  runs = 0;
  private readonly listeners = new Set<() => void>();
  isSupported(): boolean { return true; }
  getState(): AiReportState { return this.state; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  run(): void {
    this.runs += 1;
    this.state = { ...this.state, status: "running", startedAt: 0 };
    for (const listener of this.listeners) listener();
  }
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
  const timers = new TaskTimerService(events, store, taskService, persistence);
  return { store, taskService, timers };
}

describe("TaskMenuPopover — 메뉴바 빠른 작업 패널", () => {
  it("타이머·단계·다음 할 일·빠른 입력을 안전한 HTML로 렌더링한다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const focus = await graph.taskService.createTask({
      title: "<집중 작업>",
      status: "doing",
      steps: ["분석", "구현"],
      currentStep: 2,
    });
    await graph.taskService.createTask({ title: "다음 작업", status: "todo", due: "2026-08-23" });

    const content = renderTaskMenuPopover(
      graph.timers.getTimers(),
      [...graph.store.getState().tasks.values()],
      new Date("2026-08-22T12:00:00+09:00"),
    );

    expect(content.html).toContain("오늘");
    expect(content.html).toContain("현재 작업에 단계 추가");
    expect(content.html).toContain("빠른 할 일 추가");
    expect(content.html).toContain("다음 작업");
    expect(content.html).toContain("08-23");
    expect(content.html).toContain("&lt;집중 작업&gt;");
    expect(content.html).not.toContain("<집중 작업>");
    expect(content.html).toContain(`taskId=${focus.id}`);
    expect(content.height).toBeGreaterThan(260);
  });

  it("잘린 제목은 가로 스크롤 대상으로 표시하고 재렌더 시 위치를 복원할 키를 붙인다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const focus = await graph.taskService.createTask({
      title: "[홈 커뮤니티] 오피셜 계정은 카테고리 PLP 뱃지 노출 제외",
      status: "doing",
      steps: ["프롬프트 주입"],
    });
    const next = await graph.taskService.createTask({ title: "다음 작업", status: "todo" });

    const content = renderTaskMenuPopover(
      graph.timers.getTimers(),
      [...graph.store.getState().tasks.values()],
      new Date("2026-08-22T12:00:00+09:00"),
    );

    expect(content.html).toContain(`data-scroll-key="focus:${focus.id}"`);
    expect(content.html).toContain(`data-scroll-key="step:${focus.id}:1"`);
    expect(content.html).toContain(`data-scroll-key="task:${next.id}"`);
    expect(content.html).toContain('class="task-title scroll-title task-open"');
  });

  it("메뉴바 재클릭·닫기는 이전 앱으로 포커스를 돌려주고, 보드 열기는 그대로 둔다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const handles: FakePopoverHandle[] = [];
    let dispatch!: (action: TaskMenuPopoverAction) => void;
    const port: TaskMenuPopoverPort = {
      isSupported: () => true,
      create: (_anchor, onAction) => {
        dispatch = onAction;
        const handle = new FakePopoverHandle();
        handles.push(handle);
        return handle;
      },
    };
    const popover = new TaskMenuPopover(
      graph.timers,
      graph.taskService,
      graph.store,
      port,
      vi.fn(),
      () => new Date("2026-08-22T12:00:00+09:00"),
    );
    const anchor = { x: 100, y: 0, width: 24, height: 24 };

    popover.toggle(anchor);
    popover.toggle(anchor);
    expect(handles[0]?.closeOptions).toEqual({ returnFocus: true });

    popover.toggle(anchor);
    dispatch({ kind: "close" });
    expect(handles[1]?.closeOptions).toEqual({ returnFocus: true });

    popover.toggle(anchor);
    dispatch({ kind: "open-board" });
    expect(handles[2]?.closeOptions).toEqual({});
  });

  it("허용된 custom protocol만 action으로 파싱하고 입력을 정규화한다", () => {
    expect(parseTaskMenuPopoverAction("taskmaster-menu://add-step?taskId=task_x&value=%20QA%20%20%ED%99%95%EC%9D%B8%20"))
      .toEqual({ kind: "add-step", taskId: "task_x", value: "QA 확인" });
    expect(parseTaskMenuPopoverAction("taskmaster-menu://select-step?taskId=task_x&step=2"))
      .toEqual({ kind: "select-step", taskId: "task_x", step: 2 });
    expect(parseTaskMenuPopoverAction("taskmaster-menu://create-task?value=%EC%83%88%20%EC%9E%91%EC%97%85"))
      .toEqual({ kind: "create-task", value: "새 작업" });
    expect(parseTaskMenuPopoverAction("https://example.com")).toBeNull();
    expect(parseTaskMenuPopoverConsoleAction(
      "__TASKMASTER_MENU_ACTION__taskmaster-menu://close",
    )).toEqual({ kind: "close" });
  });

  it("팝오버 입력이 기존 TaskService를 통해 단계와 할 일을 저장하고 작업을 시작한다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const focus = await graph.taskService.createTask({ title: "집중", status: "doing", steps: ["분석"] });
    const waiting = await graph.taskService.createTask({ title: "대기", status: "todo" });
    const handle = new FakePopoverHandle();
    let dispatch!: (action: TaskMenuPopoverAction) => void;
    let dismiss!: () => void;
    const port: TaskMenuPopoverPort = {
      isSupported: () => true,
      create: (_anchor, onAction, onDismiss) => {
        dispatch = onAction;
        dismiss = onDismiss;
        return handle;
      },
    };
    const openBoard = vi.fn();
    const popover = new TaskMenuPopover(
      graph.timers,
      graph.taskService,
      graph.store,
      port,
      openBoard,
      () => new Date("2026-08-22T12:00:00+09:00"),
    );

    expect(popover.toggle({ x: 100, y: 0, width: 24, height: 24 })).toBe(true);
    expect(handle.html).toContain("집중");

    dispatch({ kind: "add-step", taskId: focus.id, value: "  QA   확인  " });
    await vi.waitFor(() => {
      expect(graph.store.getState().tasks.get(focus.id)?.steps).toEqual(["분석", "QA 확인"]);
    });

    dispatch({ kind: "create-task", value: "새 할 일" });
    await vi.waitFor(() => {
      expect([...graph.store.getState().tasks.values()].some((task) => task.title === "새 할 일"))
        .toBe(true);
    });

    dispatch({ kind: "start-task", taskId: waiting.id });
    await vi.waitFor(() => {
      expect(graph.store.getState().tasks.get(waiting.id)?.status).toBe("doing");
      expect(graph.timers.getTimer(waiting.id)?.phase).toBe("running");
    });

    dispatch({ kind: "open-board" });
    expect(openBoard).toHaveBeenCalledOnce();
    expect(handle.closed).toBe(true);
    expect(popover.isOpen()).toBe(false);

    // Electron이 blur로 닫힌 경우에도 controller 상태만 안전하게 정리한다.
    dismiss();
    expect(popover.isOpen()).toBe(false);
  });

  it("메뉴바 아이콘 중앙 아래에 두되 화면 밖으로 넘지 않게 배치한다", () => {
    const area: MenuBarAnchorRect = { x: 0, y: 24, width: 1512, height: 958 };
    expect(popoverBounds({ x: 1400, y: 0, width: 24, height: 24 }, area, 600))
      .toEqual({ x: 1084, y: 30, width: 420, height: 600 });
    expect(popoverBounds({ x: 4, y: 0, width: 24, height: 24 }, area, 600).x).toBe(8);
  });

  it("명령 팔레트 진입은 port의 상단 우측 기준점으로 같은 패널을 연다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const anchor = { x: 1464, y: -6, width: 20, height: 24 };
    const create = vi.fn((_anchor: MenuBarAnchorRect) => new FakePopoverHandle());
    const port: TaskMenuPopoverPort = {
      isSupported: () => true,
      defaultAnchor: () => anchor,
      create: (actualAnchor) => create(actualAnchor),
    };
    const popover = new TaskMenuPopover(
      graph.timers,
      graph.taskService,
      graph.store,
      port,
      vi.fn(),
    );

    expect(popover.openDefault()).toBe(true);
    expect(create).toHaveBeenCalledWith(anchor);
    popover.dispose();
  });

  it("Tray 재클릭 중 이전 창의 closed 이벤트가 늦게 와도 새 패널을 닫지 않는다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const handles: FakePopoverHandle[] = [];
    const dismissals: Array<() => void> = [];
    const port: TaskMenuPopoverPort = {
      isSupported: () => true,
      create: (_anchor, _onAction, onDismiss) => {
        const handle = new FakePopoverHandle();
        handles.push(handle);
        dismissals.push(onDismiss);
        return handle;
      },
    };
    const popover = new TaskMenuPopover(
      graph.timers,
      graph.taskService,
      graph.store,
      port,
      vi.fn(),
    );
    const anchor = { x: 400, y: 0, width: 24, height: 24 };

    expect(popover.show(anchor)).toBe(true);
    expect(popover.show(anchor)).toBe(true);
    expect(handles[0]?.closed).toBe(true);
    expect(popover.isOpen()).toBe(true);

    dismissals[0]?.();
    expect(popover.isOpen()).toBe(true);

    dismissals[1]?.();
    expect(popover.isOpen()).toBe(false);
  });

  it("macOS 열기 blur는 무시하고 이후 blur는 Tray 재클릭이 toggle할 시간을 준 뒤 닫는다", () => {
    vi.useFakeTimers();
    const created: FakeBrowserWindow[] = [];
    class FakeBrowserWindow {
      static getAllWindows(): FakeBrowserWindow[] { return created; }
      readonly windowListeners = new Map<string, () => void>();
      readonly contentListeners = new Map<string, (...args: unknown[]) => void>();
      readonly webContents = {
        on: (event: string, listener: (...args: unknown[]) => void) => {
          this.contentListeners.set(event, listener);
        },
        executeJavaScript: async () => undefined,
      };
      readonly focus = vi.fn();
      readonly show = vi.fn();
      closed = false;
      constructor(_options: Record<string, unknown>) { created.push(this); }
      on(event: string, listener: () => void): void { this.windowListeners.set(event, listener); }
      async loadURL(_url: string): Promise<void> { this.contentListeners.get("did-finish-load")?.(); }
      setBounds(): void {}
      setAlwaysOnTop(): void {}
      close(): void {
        if (this.closed) return;
        this.closed = true;
        this.windowListeners.get("closed")?.();
      }
      isDestroyed(): boolean { return this.closed; }
      getTitle(): string { return "TaskMaster Quick Panel"; }
      emit(event: "blur"): void { this.windowListeners.get(event)?.(); }
    }
    const remote = {
      BrowserWindow: FakeBrowserWindow,
      screen: {
        getPrimaryDisplay: () => ({ workArea: { x: 0, y: 24, width: 1512, height: 958 } }),
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 24, width: 1512, height: 958 } }),
      },
    };
    const target = window as Window & { require?: (id: string) => unknown };
    const originalRequire = target.require;
    target.require = () => remote;
    try {
      const dismissed = vi.fn();
      const handle = createElectronTaskMenuPopoverPort().create(
        { x: 100, y: 0, width: 24, height: 24 },
        vi.fn(),
        dismissed,
      );
      const browser = created[0]!;

      expect(handle).not.toBeNull();
      expect(browser.show).toHaveBeenCalledOnce();
      expect(browser.focus).toHaveBeenCalledOnce();
      browser.emit("blur");
      expect(browser.closed).toBe(false);

      vi.advanceTimersByTime(250);
      expect(browser.focus).toHaveBeenCalledTimes(2);
      browser.emit("blur");
      expect(browser.closed).toBe(false);
      vi.advanceTimersByTime(119);
      expect(browser.closed).toBe(false);
      vi.advanceTimersByTime(1);
      expect(browser.closed).toBe(true);
      expect(dismissed).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      if (originalRequire) target.require = originalRequire;
      else delete target.require;
    }
  });

  it("고정 높이 스크롤 영역을 만들고 1초 갱신 뒤에도 스크롤 위치를 보존한다", () => {
    const created: FakeBrowserWindow[] = [];
    let loadedUrl = "";
    class FakeBrowserWindow {
      static getAllWindows(): FakeBrowserWindow[] { return created; }
      readonly listeners = new Map<string, (...args: unknown[]) => void>();
      readonly webContents = {
        on: (event: string, listener: (...args: unknown[]) => void) => this.listeners.set(event, listener),
        executeJavaScript: async () => undefined,
      };
      constructor(_options: Record<string, unknown>) { created.push(this); }
      on(event: string, listener: (...args: unknown[]) => void): void { this.listeners.set(event, listener); }
      async loadURL(url: string): Promise<void> { loadedUrl = url; }
      setBounds(): void {}
      setAlwaysOnTop(): void {}
      show(): void {}
      focus(): void {}
      close(): void {}
      isDestroyed(): boolean { return false; }
      getTitle(): string { return "TaskMaster Quick Panel"; }
    }
    const remote = {
      BrowserWindow: FakeBrowserWindow,
      screen: {
        getPrimaryDisplay: () => ({ workArea: { x: 0, y: 24, width: 1512, height: 958 } }),
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 24, width: 1512, height: 958 } }),
      },
    };
    const target = window as Window & { require?: (id: string) => unknown };
    const originalRequire = target.require;
    target.require = () => remote;
    try {
      createElectronTaskMenuPopoverPort().create(
        { x: 100, y: 0, width: 24, height: 24 },
        vi.fn(),
        vi.fn(),
      );
      const documentHtml = decodeURIComponent(loadedUrl.split(",", 2)[1] ?? "");
      expect(documentHtml).toContain("html, body, #app { width: 100%; height: 100%");
      expect(documentHtml).toContain("var scrollTop = previousMain ? previousMain.scrollTop : 0");
      expect(documentHtml).toContain("nextMain.scrollTop = scrollTop");
      expect(documentHtml).toContain("overscroll-behavior: contain");
    } finally {
      if (originalRequire) target.require = originalRequire;
      else delete target.require;
    }
  });
});

describe("TaskMenuPopover — AI 리포트 섹션", () => {
  it("리포트를 스냅샷·불릿·하이라이트로 렌더링하고 받기 버튼을 붙인다", async () => {
    const graph = buildGraph();
    await graph.timers.init();

    const content = renderTaskMenuPopover(
      graph.timers.getTimers(),
      [],
      new Date("2026-08-22T12:00:00+09:00"),
      reportState(),
    );

    expect(content.html).toContain("AI 리포트");
    expect(content.html).toContain("taskmaster-menu://run-report");
    expect(content.html).toContain("8월 22일 (토)");
    expect(content.html).toContain("doing 2개, hold 1개.");
    expect(content.html).toContain("레버리지 1위는 관측 공백이다");
    expect(content.html).toContain("보드를 현실과 맞추기 30분");
    expect(content.html).toContain("taskmaster-menu://open-report");
  });

  it("접으면 본문을 감추고 하이라이트만 남긴다", async () => {
    const graph = buildGraph();
    await graph.timers.init();

    const content = renderTaskMenuPopover(
      graph.timers.getTimers(),
      [],
      new Date("2026-08-22T12:00:00+09:00"),
      reportState({ collapsed: true }),
    );

    expect(content.html).toContain("리포트 펼치기");
    expect(content.html).not.toContain("doing 2개, hold 1개.");
    expect(content.html).toContain("보드를 현실과 맞추기 30분");
  });

  it("생성 중에는 경과 초를, 실패하면 사유를 보여준다", async () => {
    const graph = buildGraph();
    await graph.timers.init();

    const running = renderTaskMenuPopover(
      graph.timers.getTimers(), [], new Date("2026-08-22T12:00:00+09:00"),
      reportState({ status: "running", runningSeconds: 42 }),
    );
    expect(running.html).toContain("생성 중 · 42초");
    expect(running.html).not.toContain("taskmaster-menu://run-report");

    const failed = renderTaskMenuPopover(
      graph.timers.getTimers(), [], new Date("2026-08-22T12:00:00+09:00"),
      reportState({ status: "error", error: "claude 실행 파일을 찾지 못했습니다", report: null }),
    );
    expect(failed.html).toContain("claude 실행 파일을 찾지 못했습니다");
    expect(failed.html).toContain("아직 리포트가 없습니다");
  });

  it("오늘 리포트가 아니면 받기 버튼을 강조한다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const fresh = renderTaskMenuPopover(graph.timers.getTimers(), [], new Date(), reportState());
    const stale = renderTaskMenuPopover(graph.timers.getTimers(), [], new Date(), reportState({ stale: true }));
    expect(fresh.html).not.toContain('class="report-run wanted"');
    expect(stale.html).toContain('class="report-run wanted"');
  });

  it("리포트 컨트롤러가 없으면 섹션 자체를 그리지 않는다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const content = renderTaskMenuPopover(graph.timers.getTimers(), [], new Date());
    expect(content.html).not.toContain("AI 리포트");
  });

  it("받기 클릭은 컨트롤러를 실행하고, 접기 클릭은 패널만 다시 그린다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const reports = new FakeReportController();
    const openReport = vi.fn();
    const handle = new FakePopoverHandle();
    let dispatch!: (action: TaskMenuPopoverAction) => void;
    const port: TaskMenuPopoverPort = {
      isSupported: () => true,
      create: (_anchor, onAction) => { dispatch = onAction; return handle; },
      defaultAnchor: () => ({ x: 0, y: 0, width: 24, height: 24 }),
    };
    const popover = new TaskMenuPopover(
      graph.timers, graph.taskService, graph.store, port,
      vi.fn(), () => new Date("2026-08-22T12:00:00+09:00"), undefined,
      reports, openReport,
    );

    expect(popover.openDefault()).toBe(true);
    expect(handle.html).toContain("AI 리포트");
    // 기본은 접힘 — 작업 목록이 리포트에 밀리지 않게 한다.
    expect(handle.html).toContain("리포트 펼치기");

    dispatch({ kind: "run-report" });
    expect(reports.runs).toBe(1);

    dispatch({ kind: "toggle-report" });
    expect(handle.html).toContain("doing 2개, hold 1개.");
    dispatch({ kind: "toggle-report" });
    expect(handle.html).not.toContain("doing 2개, hold 1개.");

    dispatch({ kind: "open-report" });
    expect(openReport).toHaveBeenCalledTimes(1);
    expect(handle.closed).toBe(true);
    popover.dispose();
  });

  it("리포트 액션 URL을 파싱한다", () => {
    expect(parseTaskMenuPopoverAction("taskmaster-menu://run-report")).toEqual({ kind: "run-report" });
    expect(parseTaskMenuPopoverAction("taskmaster-menu://toggle-report")).toEqual({ kind: "toggle-report" });
    expect(parseTaskMenuPopoverAction("taskmaster-menu://open-report")).toEqual({ kind: "open-report" });
  });
});

describe("TaskMenuPopover — AI 카드 채우기", () => {
  const draftState = (overrides: Partial<AiDraftPanelState> = {}): AiDraftPanelState => ({
    running: false,
    error: null,
    runningSeconds: 0,
    critique: [],
    batch: null,
    fillableCount: 1,
    ...overrides,
  });

  it("집중 작업이 여러 개여도 카드마다 진입점을 건다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const first = await graph.taskService.createTask({ title: "첫 카드", status: "doing" });
    const second = await graph.taskService.createTask({ title: "둘째 카드", status: "doing" });

    const content = renderTaskMenuPopover(
      graph.timers.getTimers(),
      [...graph.store.getState().tasks.values()],
      new Date("2026-08-22T12:00:00+09:00"),
      null,
      draftState(),
    );

    expect(content.html).toContain("AI로 채우기");
    expect(content.html).toContain(`taskmaster-menu://draft-card?taskId=${first.id}`);
    expect(content.html).toContain(`taskmaster-menu://draft-card?taskId=${second.id}`);
  });

  it("빈 칸이 하나도 없는 카드에는 진입점을 그리지 않는다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const task = await graph.taskService.createTask({
      title: "다 채워진 카드",
      status: "doing",
      steps: ["[결정] 스키마 확정"],
      tags: ["업무"],
      priority: "high",
      remarks: "이미 적어 둔 비고",
      project: "project_01FILLED" as never,
    });

    const content = renderTaskMenuPopover(
      graph.timers.getTimers(),
      [...graph.store.getState().tasks.values()],
      new Date("2026-08-22T12:00:00+09:00"),
      null,
      draftState(),
    );

    expect(content.html).not.toContain(`draft-card?taskId=${task.id}`);
  });

  it("단계가 있어도 다른 칸이 비었으면 진입점을 남긴다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const task = await graph.taskService.createTask({
      title: "단계만 있는 카드",
      status: "doing",
      steps: ["[결정] 스키마 확정"],
    });

    const content = renderTaskMenuPopover(
      graph.timers.getTimers(),
      [...graph.store.getState().tasks.values()],
      new Date("2026-08-22T12:00:00+09:00"),
      null,
      draftState(),
    );

    expect(content.html).toContain(`draft-card?taskId=${task.id}`);
  });

  it("초안 서비스가 없으면 진입점도 없다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    await graph.taskService.createTask({ title: "오피셜 체크", status: "doing" });

    const content = renderTaskMenuPopover(
      graph.timers.getTimers(), [], new Date("2026-08-22T12:00:00+09:00"), null, null,
    );

    expect(content.html).not.toContain("draft-card");
  });

  it("생성 중·실패·비평을 같은 자리에 남긴다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    await graph.taskService.createTask({ title: "오피셜 체크", status: "doing" });
    const timers = graph.timers.getTimers();
    const tasks = [...graph.store.getState().tasks.values()];
    const now = new Date("2026-08-22T12:00:00+09:00");

    const running = renderTaskMenuPopover(timers, tasks, now, null, draftState({ running: true, runningSeconds: 42 }));
    expect(running.html).toContain("42");
    // 도는 동안에는 또 누르지 못하게 진입점을 감춘다.
    expect(running.html).not.toContain("draft-card");

    const failed = renderTaskMenuPopover(timers, tasks, now, null, draftState({ error: "시간 초과 (180초)" }));
    expect(failed.html).toContain("시간 초과 (180초)");
    expect(failed.html).toContain("draft-card");

    const critiqued = renderTaskMenuPopover(timers, tasks, now, null, draftState({
      critique: ["1번이 닫히기 전엔 3번이 불가능하다"],
    }));
    expect(critiqued.html).toContain("1번이 닫히기 전엔 3번이 불가능하다");
  });

  it("빈 칸만 채우고 이미 적어 둔 값은 건드리지 않는다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const task = await graph.taskService.createTask({
      title: "반쯤 채워진 카드",
      status: "doing",
      steps: ["[결정] 내가 직접 적은 단계"],
      remarks: "내가 적은 비고",
    });

    const drafts: AiDraftController = {
      isSupported: () => true,
      getState: () => ({
        status: "idle",
        suggestion: {
          priority: "high",
          projectTitle: null,
          tags: ["업무", "커뮤니티"],
          remarks: "AI가 지어낸 비고",
          steps: ["[실작업] AI가 지어낸 단계"],
          critique: [],
          rationale: null,
        },
        error: null,
        startedAt: null,
        mode: "critique",
        deep: true,
      }),
      subscribe: () => () => {},
      suggest: async () => true,
      reset: () => {},
    };

    const handle = new FakePopoverHandle();
    let dispatch!: (action: TaskMenuPopoverAction) => void;
    const port: TaskMenuPopoverPort = {
      isSupported: () => true,
      create: (_anchor, onAction) => { dispatch = onAction; return handle; },
      defaultAnchor: () => ({ x: 0, y: 0, width: 24, height: 24 }),
    };
    const popover = new TaskMenuPopover(
      graph.timers, graph.taskService, graph.store, port,
      vi.fn(), () => new Date("2026-08-22T12:00:00+09:00"),
      undefined, null, () => {}, drafts,
    );
    expect(popover.openDefault()).toBe(true);

    dispatch({ kind: "draft-card", taskId: task.id });
    await vi.waitFor(() => {
      expect(graph.store.getState().tasks.get(task.id)?.tags).toEqual(["업무", "커뮤니티"]);
    });

    const updated = graph.store.getState().tasks.get(task.id);
    // 비어 있던 칸만 들어간다.
    expect(updated?.priority).toBe("high");
    // 이미 있던 값은 그대로 — 초안이 조용히 밀어내면 안 된다.
    expect(updated?.remarks).toBe("내가 적은 비고");
    expect(updated?.steps).toEqual(["[결정] 내가 직접 적은 단계"]);
  });

  it("채울 카드가 둘 이상일 때만 모두 채우기를 띄운다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    await graph.taskService.createTask({ title: "첫 카드", status: "doing" });
    await graph.taskService.createTask({ title: "둘째 카드", status: "doing" });
    const timers = graph.timers.getTimers();
    const tasks = [...graph.store.getState().tasks.values()];
    const now = new Date("2026-08-22T12:00:00+09:00");

    const many = renderTaskMenuPopover(timers, tasks, now, null, draftState({ fillableCount: 2 }));
    expect(many.html).toContain("taskmaster-menu://draft-all");
    expect(many.html).toContain("모두 채우기");

    const one = renderTaskMenuPopover(timers, tasks, now, null, draftState({ fillableCount: 1 }));
    expect(one.html).not.toContain("draft-all");
  });

  it("실행 중에도 카드 버튼은 자리를 지키되 누를 수 없다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const task = await graph.taskService.createTask({ title: "빈 카드", status: "doing" });
    const content = renderTaskMenuPopover(
      graph.timers.getTimers(),
      [...graph.store.getState().tasks.values()],
      new Date("2026-08-22T12:00:00+09:00"),
      null,
      draftState({ running: true, runningSeconds: 7 }),
    );

    // 사라지면 레이아웃이 튀어 다른 버튼을 잘못 누르게 된다.
    expect(content.html).toContain("AI로 채우기");
    expect(content.html).toContain("draft-run busy");
    expect(content.html).not.toContain(`draft-card?taskId=${task.id}`);
  });

  it("일괄 실행은 진행률을 남긴다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    await graph.taskService.createTask({ title: "빈 카드", status: "doing" });
    const content = renderTaskMenuPopover(
      graph.timers.getTimers(),
      [...graph.store.getState().tasks.values()],
      new Date("2026-08-22T12:00:00+09:00"),
      null,
      draftState({ running: true, runningSeconds: 14, batch: { done: 1, total: 3 } }),
    );
    expect(content.html).toContain("2/3");
    expect(content.html).toContain("14");
  });

  it("draft-all 액션 URL을 파싱한다", () => {
    expect(parseTaskMenuPopoverAction("taskmaster-menu://draft-all"))
      .toEqual({ kind: "draft-all" });
  });

  it("draft-card 액션 URL을 파싱한다", () => {
    expect(parseTaskMenuPopoverAction("taskmaster-menu://draft-card?taskId=task_x"))
      .toEqual({ kind: "draft-card", taskId: "task_x" });
    expect(parseTaskMenuPopoverAction("taskmaster-menu://draft-card")).toBeNull();
  });
});

describe("TaskMenuPopover — 현재 작업 ↔ 다음 할 일 드래그", () => {
  it("두 목록의 카드에 드래그 소스와 드롭 존을 표시한다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const focus = await graph.taskService.createTask({ title: "집중 중", status: "doing" });
    const next = await graph.taskService.createTask({ title: "다음 작업", status: "todo" });

    const content = renderTaskMenuPopover(
      graph.timers.getTimers(),
      [...graph.store.getState().tasks.values()],
      new Date("2026-08-22T12:00:00+09:00"),
    );

    expect(content.html).toContain(`draggable="true" data-drag="focus" data-task-id="${focus.id}"`);
    expect(content.html).toContain(`draggable="true" data-drag="next" data-task-id="${next.id}"`);
    expect(content.html).toContain('data-drop="focus"');
    expect(content.html).toContain('data-drop="next"');
  });

  it("park-task 액션 URL을 파싱한다", () => {
    expect(parseTaskMenuPopoverAction("taskmaster-menu://park-task?taskId=task_x"))
      .toEqual({ kind: "park-task", taskId: "task_x" });
    expect(parseTaskMenuPopoverAction("taskmaster-menu://park-task")).toBeNull();
  });

  it("다음 할 일로 끌어내면 done이 아니라 todo로 돌아가고 actualMd를 적지 않는다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const task = await graph.taskService.createTask({
      title: "집중 중",
      status: "doing",
      steps: ["[실작업] 구현"],
    });
    const handle = new FakePopoverHandle();
    let dispatch!: (action: TaskMenuPopoverAction) => void;
    const port: TaskMenuPopoverPort = {
      isSupported: () => true,
      create: (_anchor, onAction) => { dispatch = onAction; return handle; },
      defaultAnchor: () => ({ x: 0, y: 0, width: 24, height: 24 }),
    };
    const popover = new TaskMenuPopover(
      graph.timers, graph.taskService, graph.store, port,
      vi.fn(), () => new Date("2026-08-22T12:00:00+09:00"),
    );
    expect(popover.openDefault()).toBe(true);
    graph.timers.start(task.id);
    expect(graph.timers.getTimers()).toHaveLength(1);

    dispatch({ kind: "park-task", taskId: task.id });
    await vi.waitFor(() => {
      expect(graph.store.getState().tasks.get(task.id)?.status).toBe("todo");
    });

    // stop()과 다르다 — 완료로 처리하거나 실적 공수를 적지 않는다.
    expect(graph.store.getState().tasks.get(task.id)?.actualMd ?? null).toBeNull();
    expect(graph.timers.getTimers()).toHaveLength(0);
  });

  it("이미 doing이 아닌 카드는 park-task로 건드리지 않는다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const task = await graph.taskService.createTask({ title: "대기 중", status: "todo" });
    const handle = new FakePopoverHandle();
    let dispatch!: (action: TaskMenuPopoverAction) => void;
    const port: TaskMenuPopoverPort = {
      isSupported: () => true,
      create: (_anchor, onAction) => { dispatch = onAction; return handle; },
      defaultAnchor: () => ({ x: 0, y: 0, width: 24, height: 24 }),
    };
    const popover = new TaskMenuPopover(
      graph.timers, graph.taskService, graph.store, port,
      vi.fn(), () => new Date("2026-08-22T12:00:00+09:00"),
    );
    expect(popover.openDefault()).toBe(true);

    dispatch({ kind: "park-task", taskId: task.id });
    await Promise.resolve();
    expect(graph.store.getState().tasks.get(task.id)?.status).toBe("todo");
  });

  it("끌고 있는 동안에는 패널을 다시 그리지 않는다 (주입 스크립트 계약)", () => {
    // innerHTML 교체가 드래그 중인 노드를 날리면 드롭이 취소된다. 이 한 줄이
    // 빠지면 타이머가 도는 동안 드래그가 매 초 끊기고, 그 실패는 테스트로만 잡힌다.
    expect(POPOVER_DOCUMENT).toContain("if (dragging) { pendingHtml = html; return; }");
    expect(POPOVER_DOCUMENT).toContain('var kind = to === "focus" ? "start-task" : "park-task";');
  });
});

describe("TaskMenuPopover — 카드에서 노트 열기", () => {
  it("현재 작업과 다음 할 일의 제목이 노트를 여는 링크다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const focus = await graph.taskService.createTask({ title: "집중 중", status: "doing" });
    const next = await graph.taskService.createTask({ title: "다음 작업", status: "todo" });

    const content = renderTaskMenuPopover(
      graph.timers.getTimers(),
      [...graph.store.getState().tasks.values()],
      new Date("2026-08-22T12:00:00+09:00"),
    );

    expect(content.html).toContain(`taskmaster-menu://open-task?taskId=${focus.id}`);
    expect(content.html).toContain(`taskmaster-menu://open-task?taskId=${next.id}`);
    // 링크가 드래그를 가로채면 카드 이동이 깨진다.
    expect(content.html).toContain('draggable="false"');
  });

  it("open-task는 그 카드로 열고 패널을 비켜 준다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const task = await graph.taskService.createTask({ title: "집중 중", status: "doing" });
    const opened: string[] = [];
    const handle = new FakePopoverHandle();
    let dispatch!: (action: TaskMenuPopoverAction) => void;
    const port: TaskMenuPopoverPort = {
      isSupported: () => true,
      create: (_anchor, onAction) => { dispatch = onAction; return handle; },
      defaultAnchor: () => ({ x: 0, y: 0, width: 24, height: 24 }),
    };
    const popover = new TaskMenuPopover(
      graph.timers, graph.taskService, graph.store, port,
      vi.fn(), () => new Date("2026-08-22T12:00:00+09:00"),
      undefined, null, () => {}, null,
      (taskId) => opened.push(taskId),
    );
    expect(popover.openDefault()).toBe(true);

    dispatch({ kind: "open-task", taskId: task.id });
    await vi.waitFor(() => expect(opened).toEqual([task.id]));
    expect(handle.closed).toBe(true);
  });

  it("없는 카드면 아무것도 열지 않는다", async () => {
    const graph = buildGraph();
    await graph.timers.init();
    const opened: string[] = [];
    const handle = new FakePopoverHandle();
    let dispatch!: (action: TaskMenuPopoverAction) => void;
    const port: TaskMenuPopoverPort = {
      isSupported: () => true,
      create: (_anchor, onAction) => { dispatch = onAction; return handle; },
      defaultAnchor: () => ({ x: 0, y: 0, width: 24, height: 24 }),
    };
    const popover = new TaskMenuPopover(
      graph.timers, graph.taskService, graph.store, port,
      vi.fn(), () => new Date("2026-08-22T12:00:00+09:00"),
      undefined, null, () => {}, null,
      (taskId) => opened.push(taskId),
    );
    expect(popover.openDefault()).toBe(true);

    dispatch({ kind: "open-task", taskId: "task_missing" as never });
    await Promise.resolve();
    expect(opened).toEqual([]);
    expect(handle.closed).toBe(false);
  });

  it("open-task 액션 URL을 파싱한다", () => {
    expect(parseTaskMenuPopoverAction("taskmaster-menu://open-task?taskId=task_x"))
      .toEqual({ kind: "open-task", taskId: "task_x" });
    expect(parseTaskMenuPopoverAction("taskmaster-menu://open-task")).toBeNull();
  });
});
