// T-901 (task_01KZN31H): DOING 타이머 알림 배너 — UI 요구사항 스펙.
//
// "맥북 슬랙 알림창처럼": 화면 상단에 직사각형 배너가 태스크별로 하나씩 스택으로 뜨고,
// 밀어서(스와이프) 닫을 수 있고, 정지/스탑 버튼이 있다.
//
// 서비스 레이어 스펙은 tests/services/TaskTimerService.test.ts 에 있다.
// jsdom으로 검증 불가한 항목(실제 화면 위치·애니메이션·트랙패드 제스처 감각)은
// tests/manual/timer-notifications.md 체크리스트로 보완한다.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, fireEvent, act, within, cleanup, waitFor } from "@testing-library/react";
import { App as ObsidianApp } from "obsidian";
import {
  TimerNotificationStack,
  mountTimerOverlay,
} from "../../../src/ui/timer/TimerNotificationStack";
import {
  TaskTimerService,
  TIMER_TICK_MS,
  SWIPE_DISMISS_THRESHOLD_PX,
  type TimerPersistencePort,
} from "../../../src/services/TaskTimerService";
import { createTaskMasterStore } from "../../../src/store/taskMasterStore";
import { EventBus } from "../../../src/core/eventBus";
import { DiagnosticsLog } from "../../../src/core/diagnostics";
import { TaskRepository, BoardRepository } from "../../../src/repositories";
import { BoardService, TaskService } from "../../../src/services";
import type { CreateTaskInput, Task } from "../../../src/core/types";
import type { TimerFloatingController } from "../../../src/ui/timer/TimerFloatingWindow";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function buildServices() {
  const app = new ObsidianApp();
  const events = new EventBus();
  const diagnostics = new DiagnosticsLog();
  const store = createTaskMasterStore();
  const taskRepo = new TaskRepository(app, diagnostics, 500, "TaskMaster/Tasks", "TaskMaster/Archive");
  const boardRepo = new BoardRepository(app, diagnostics, "TaskMaster/.board.json", 500);
  const boardService = new BoardService(boardRepo, store, events);
  const taskService = new TaskService(taskRepo, boardService, store, events);
  const port: TimerPersistencePort = {
    load: async () => [],
    save: async () => {},
  };
  // 기본 now(Date.now) 사용 — vi.useFakeTimers()가 Date까지 fake하므로
  // advanceTimersByTime으로 표시 tick과 경과 시간이 함께 전진한다.
  const timers = new TaskTimerService(events, store, taskService, port);
  return { taskService, timers, store };
}

async function setup(floatingWindow?: TimerFloatingController) {
  const services = buildServices();
  await services.timers.init();
  const ui = render(
    <TimerNotificationStack service={services.timers} floatingWindow={floatingWindow} />,
  );

  /** act로 감싼 태스크 생성 — EventBus → 배너 갱신까지 flush. */
  async function create(input: CreateTaskInput): Promise<Task> {
    let task!: Task;
    await act(async () => {
      task = await services.taskService.createTask(input);
    });
    return task;
  }

  return { ...services, ui, create };
}

class FakeFloatingController implements TimerFloatingController {
  open = false;
  readonly listeners = new Set<() => void>();

  isSupported(): boolean { return true; }
  isOpen(): boolean { return this.open; }
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

function banners(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="tm-timer-banner"]'));
}

/**
 * 오른쪽 스와이프 제스처. deltaX만큼 민 뒤 손을 뗀다.
 * jsdom의 PointerEvent 구현 여부에 의존하지 않도록 MouseEvent 기반으로 dispatch한다
 * (React는 event.type으로 pointer 핸들러를 찾으므로 동작 동일).
 */
function swipeRight(el: HTMLElement, deltaX: number): void {
  const opts = { bubbles: true, cancelable: true, buttons: 1 };
  el.dispatchEvent(new MouseEvent("pointerdown", { ...opts, clientX: 100, clientY: 10 }));
  el.dispatchEvent(new MouseEvent("pointermove", { ...opts, clientX: 100 + deltaX, clientY: 10 }));
  el.dispatchEvent(new MouseEvent("pointerup", { ...opts, clientX: 100 + deltaX, clientY: 10 }));
}

describe("TimerNotificationStack — 배너 스택 (슬랙 알림창 스타일)", () => {
  it("[U1] DOING 태스크마다 직사각형 배너가 하나씩 뜨고, 최신이 맨 위다", async () => {
    const s = await setup();
    await s.create({ title: "먼저 온 일", status: "doing" });
    await s.create({ title: "나중 온 일", status: "doing" });

    const stack = s.ui.getByTestId("tm-timer-stack");
    const items = banners(stack);
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("나중 온 일");
    expect(items[1]?.textContent).toContain("먼저 온 일");
  });

  it("[U2] 배너는 role=status로 노출되고 태스크 제목과 경과 시간을 보여준다", async () => {
    const s = await setup();
    await s.create({ title: "지금 하는 일", status: "doing" });

    const banner = s.ui.getAllByRole("status")[0]!;
    expect(banner.textContent).toContain("지금 하는 일");
    expect(within(banner).getByTestId("tm-timer-elapsed").textContent).toBe("00:00");
  });

  it("[U3] DOING에서 빠지면 배너도 사라진다", async () => {
    const s = await setup();
    const task = await s.create({ title: "빠질 일", status: "doing" });
    expect(s.ui.getByTestId("tm-timer-banner")).toBeTruthy();

    await act(async () => {
      await s.taskService.moveTask(task.id, "in-review");
    });
    expect(s.ui.queryByTestId("tm-timer-banner")).toBeNull();
  });

  it("[U3b] 작업 계획을 시간 아래에 보여주고 이전/현재/대기 단계를 구분한다", async () => {
    const s = await setup();
    await s.create({
      title: "단계 확인",
      status: "doing",
      steps: ["서버 프롬프트", "문서 작성", "QA 환경 검증"],
      currentStep: 2,
    });

    const plan = s.ui.getByTestId("tm-timer-steps");
    const items = within(plan).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "✓서버 프롬프트00:00",
      "→문서 작성00:00",
      "3QA 환경 검증00:00",
    ]);
    expect(items.map((item) => item.dataset.state)).toEqual(["completed", "current", "pending"]);
    const current = s.ui.getByTestId("tm-timer-step-2");
    expect(current.getAttribute("aria-current")).toBe("step");
    expect(current.style.backgroundColor).toBe("var(--interactive-accent)");
  });

  it("[U3c] 타이머가 돌아가는 중 currentStep이 갱신되면 바로 반영한다", async () => {
    const s = await setup();
    const task = await s.create({
      title: "AI가 진행률 갱신",
      status: "doing",
      steps: ["하나", "둘", "셋"],
    });
    expect(s.ui.getByTestId("tm-timer-steps").querySelector('[data-state="current"]')?.textContent)
      .toContain("하나");

    await act(async () => {
      await s.taskService.updateTask(task.id, { currentStep: 3 });
    });
    expect(s.ui.getByTestId("tm-timer-steps").querySelector('[data-state="current"]')?.textContent)
      .toContain("셋");
  });

  it("[U3d] 배너의 단계를 클릭하면 그 단계가 현재 단계로 저장된다", async () => {
    const s = await setup();
    const task = await s.create({
      title: "클릭으로 단계 선택",
      status: "doing",
      steps: ["하나", "둘", "셋"],
    });

    fireEvent.click(s.ui.getByTestId("tm-timer-step-3"));

    await waitFor(() => {
      expect(s.store.getState().tasks.get(task.id)?.currentStep).toBe(3);
      expect(s.ui.getByTestId("tm-timer-step-3").getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("[U3e] 7단계 이상이어도 높이 제한으로 자르지 않고 모두 보여준다", async () => {
    const s = await setup();
    await s.create({
      title: "전체 단계 표시",
      status: "doing",
      steps: Array.from({ length: 7 }, (_, index) => `${index + 1}번 작업`),
    });

    const plan = s.ui.getByTestId("tm-timer-steps");
    expect(within(plan).getAllByRole("listitem")).toHaveLength(7);
    expect(plan.className).not.toContain("tm-max-h");
    expect(plan.className).not.toContain("tm-overflow-y-auto");
  });

  it("[U3f] 긴 단계명은 배너 밖으로 넘치지 않고 말줄임하며 전체 내용을 tooltip에 두는다", async () => {
    const s = await setup();
    const longStep = "프론트 리뷰 요청 https://github.com/29CM-Developers/frontend-29cm-admin/pull/12345";
    await s.create({ title: "긴 단계", status: "doing", steps: [longStep] });

    const button = s.ui.getByTestId("tm-timer-step-1");
    const label = button.querySelector<HTMLElement>("[title]");
    expect(button.className).toContain("tm-overflow-hidden");
    expect(label?.className).toContain("tm-truncate");
    expect(label?.getAttribute("title")).toBe(longStep);
  });

  it("[U3g] 실행 중인 현재 단계의 누적 시간을 초 단위로 갱신한다", async () => {
    vi.useFakeTimers();
    try {
      const s = await setup();
      await s.create({ title: "단계 시간", status: "doing", steps: ["조사", "검증"] });
      fireEvent.click(s.ui.getByTestId("tm-timer-start"));
      act(() => vi.advanceTimersByTime(4_000));
      expect(s.ui.getByTestId("tm-timer-step-elapsed-1").textContent).toBe("00:04");
      expect(s.ui.getByTestId("tm-timer-step-elapsed-2").textContent).toBe("00:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("[U3h] 화면 고정 토글은 별도 막대가 아니라 태스크 타이머 헤더 안에 있다", async () => {
    const floating = new FakeFloatingController();
    const s = await setup(floating);
    await s.create({ title: "외부 고정", status: "doing" });

    const banner = s.ui.getByTestId("tm-timer-banner");
    const toggle = within(banner).getByTestId("tm-timer-floating-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("TimerNotificationStack — 스타트/정지/스탑 버튼", () => {
  it("[U4] idle 배너에는 스타트 버튼이 있고(aria-label 필수), 누르면 추적이 시작돼 매초 갱신된다", async () => {
    vi.useFakeTimers();
    try {
      const s = await setup();
      await s.create({ title: "추적할 일", status: "doing" });

      const banner = s.ui.getByTestId("tm-timer-banner");
      const startBtn = within(banner).getByTestId("tm-timer-start");
      expect(startBtn.getAttribute("aria-label")).toBeTruthy();

      act(() => {
        fireEvent.click(startBtn);
      });
      act(() => {
        vi.advanceTimersByTime(TIMER_TICK_MS * 3);
      });
      expect(within(banner).getByTestId("tm-timer-elapsed").textContent).toBe("00:03");
    } finally {
      vi.useRealTimers();
    }
  });

  it("[U5] 정지(일시정지) 버튼을 누르면 경과가 멈추고, 재개 버튼으로 바뀐다", async () => {
    vi.useFakeTimers();
    try {
      const s = await setup();
      await s.create({ title: "정지할 일", status: "doing" });

      const banner = s.ui.getByTestId("tm-timer-banner");
      act(() => {
        fireEvent.click(within(banner).getByTestId("tm-timer-start"));
      });
      act(() => {
        vi.advanceTimersByTime(5_000);
      });

      const pauseBtn = within(banner).getByTestId("tm-timer-pause");
      expect(pauseBtn.getAttribute("aria-label")).toBeTruthy();
      act(() => {
        fireEvent.click(pauseBtn);
      });
      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(within(banner).getByTestId("tm-timer-elapsed").textContent).toBe("00:05");
      // 정지 후에는 다시 시작(재개) 버튼이 노출된다
      expect(within(banner).getByTestId("tm-timer-start")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("[U6] 스탑 버튼을 누르면 배너가 사라지고 태스크는 DONE이 된다", async () => {
    const s = await setup();
    const task = await s.create({ title: "끝낼 일", status: "doing" });

    const banner = s.ui.getByTestId("tm-timer-banner");
    const stopBtn = within(banner).getByTestId("tm-timer-stop");
    expect(stopBtn.getAttribute("aria-label")).toBeTruthy();

    await act(async () => {
      fireEvent.click(stopBtn);
    });

    expect(s.ui.queryByTestId("tm-timer-banner")).toBeNull();
    expect(s.store.getState().tasks.get(task.id)?.status).toBe("done");
    // 측정 없이 스탑했으므로 actualMd는 미기록 (기록 규칙 상세는 서비스 스펙 R11b~R11e)
    expect(s.store.getState().tasks.get(task.id)?.actualMd ?? null).toBeNull();
  });
});

describe("TimerNotificationStack — 밀어서 닫기 (스와이프 dismiss)", () => {
  it("[U7] 임계값 이상 오른쪽으로 밀면 배너가 닫힌다 — 추적은 서비스에 유지된다", async () => {
    const s = await setup();
    const task = await s.create({ title: "밀어 닫기", status: "doing" });
    act(() => {
      s.timers.start(task.id);
    });

    const banner = s.ui.getByTestId("tm-timer-banner");
    act(() => {
      swipeRight(banner, SWIPE_DISMISS_THRESHOLD_PX + 20);
    });

    expect(s.ui.queryByTestId("tm-timer-banner")).toBeNull();
    // 배너만 숨었을 뿐 타이머는 계속 돈다
    expect(s.timers.getTimer(task.id)).toMatchObject({ dismissed: true, phase: "running" });
  });

  it("[U8] 임계값 미만으로 밀다 놓으면 배너는 남는다", async () => {
    const s = await setup();
    await s.create({ title: "덜 밀기", status: "doing" });

    const banner = s.ui.getByTestId("tm-timer-banner");
    act(() => {
      swipeRight(banner, SWIPE_DISMISS_THRESHOLD_PX - 40);
    });

    expect(s.ui.queryByTestId("tm-timer-banner")).not.toBeNull();
  });

  it("[U9] dismiss된 타이머의 배너는 다시 그리지 않는다", async () => {
    const s = await setup();
    await s.create({ title: "보임", status: "doing" });
    const hidden = await s.create({ title: "숨김", status: "doing" });
    act(() => {
      s.timers.dismiss(hidden.id);
    });

    const stack = s.ui.getByTestId("tm-timer-stack");
    const items = banners(stack);
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("보임");
  });
});

describe("mountTimerOverlay — 화면 상단 오버레이 (ItemView와 독립)", () => {
  it("[U10] document.body에 고정 오버레이 컨테이너를 붙이고, dispose하면 제거한다", async () => {
    cleanup(); // render 잔여물 제거 후 body를 직접 검사
    const services = buildServices();
    await services.timers.init();

    let dispose!: () => void;
    act(() => {
      dispose = mountTimerOverlay(services.timers);
    });

    const overlay = document.body.querySelector<HTMLElement>(".tm-timer-overlay");
    expect(overlay).not.toBeNull();
    // TaskMaster 뷰(leaf)가 아니라 body 직속이어야 어느 화면에서든 보인다
    expect(overlay?.parentElement).toBe(document.body);
    // Tailwind scope 유지 (HLD §3.2)
    expect(overlay?.classList.contains("taskmaster-root")).toBe(true);

    act(() => {
      dispose();
    });
    expect(document.body.querySelector(".tm-timer-overlay")).toBeNull();
  });
});
