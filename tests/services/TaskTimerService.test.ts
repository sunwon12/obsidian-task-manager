// T-901 (task_01KZN31H): DOING 타이머 — 서비스 요구사항 스펙.
//
// 요구사항 출처:
// - TaskMaster 카드: "DOING으로 옮기면 화면 상단에 타이머 각각 일정별로 띄우기,
//   스타트 누르면 시간 추적되고 스탑 누르면 done 되게"
// - 2026-08-10 대화: 맥북 슬랙 알림창 스타일(직사각형 스택), 스와이프로 닫기,
//   정지(일시정지)/스탑 버튼, 타이머는 일정별로 독립.
//
// UI 레이어 스펙은 tests/ui/timer/TimerNotificationStack.test.tsx 에 있다.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App as ObsidianApp } from "obsidian";
import {
  TaskTimerService,
  formatElapsed,
  elapsedMsToMd,
  type PersistedTimer,
  type TimerPersistencePort,
} from "../../src/services/TaskTimerService";
import { createTaskMasterStore } from "../../src/store/taskMasterStore";
import { EventBus } from "../../src/core/eventBus";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { TaskRepository, BoardRepository } from "../../src/repositories";
import { BoardService, TaskService } from "../../src/services";
import type { ColumnId, TaskId } from "../../src/core/types";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** 서비스 그래프 구성. 타이머 서비스는 테스트마다 명시적으로 만든다(복원 시나리오 때문). */
function buildGraph() {
  const app = new ObsidianApp();
  const events = new EventBus();
  const diagnostics = new DiagnosticsLog();
  const store = createTaskMasterStore();
  const taskRepo = new TaskRepository(app, diagnostics, 500, "TaskMaster/Tasks", "TaskMaster/Archive");
  const boardRepo = new BoardRepository(app, diagnostics, "TaskMaster/.board.json", 500);
  const boardService = new BoardService(boardRepo, store, events);
  const taskService = new TaskService(taskRepo, boardService, store, events);

  let clock = 0;
  const saved: PersistedTimer[][] = [];
  const persisted: PersistedTimer[] = [];
  const port: TimerPersistencePort = {
    load: async () => persisted,
    save: async (timers) => {
      saved.push(timers.map((t) => ({ ...t })));
    },
  };

  return {
    events, store, taskService, boardService, port, saved, persisted,
    now: () => clock,
    tick: (ms: number) => { clock += ms; },
    setClock: (ms: number) => { clock = ms; },
  };
}

type Graph = ReturnType<typeof buildGraph>;

async function setup() {
  const graph = buildGraph();
  const timers = new TaskTimerService(
    graph.events, graph.store, graph.taskService, graph.port, graph.now,
  );
  await timers.init();
  return { ...graph, timers };
}

function boardColumn(graph: Graph, id: ColumnId): TaskId[] {
  return graph.store.getState().board.columns.find((c) => c.id === id)?.taskIds ?? [];
}

/** fire-and-forget persistence flush 대기용. */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TaskTimerService — DOING 진입 시 타이머 생성", () => {
  it("[R1] 태스크를 DOING으로 옮기면 그 태스크의 타이머가 생긴다 (초기 idle, 0초, 배너 표시 상태)", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "갤러리 성능", status: "todo" });
    expect(s.timers.getTimers()).toHaveLength(0);

    await s.taskService.moveTask(task.id, "doing");

    const snap = s.timers.getTimer(task.id);
    expect(snap).toMatchObject({
      taskId: task.id,
      title: "갤러리 성능",
      phase: "idle",
      elapsedMs: 0,
      dismissed: false,
    });
  });

  it("[R2] 타이머는 일정(태스크)별로 독립적으로 하나씩 뜬다", async () => {
    const s = await setup();
    const a = await s.taskService.createTask({ title: "A", status: "todo" });
    const b = await s.taskService.createTask({ title: "B", status: "todo" });
    await s.taskService.moveTask(a.id, "doing");
    await s.taskService.moveTask(b.id, "doing");

    const snaps = s.timers.getTimers();
    expect(snaps).toHaveLength(2);
    expect(new Set(snaps.map((t) => t.taskId))).toEqual(new Set([a.id, b.id]));
  });

  it("[R3] 스택 정렬: 나중에 DOING에 들어온 타이머가 목록 맨 앞(화면 최상단)", async () => {
    const s = await setup();
    const first = await s.taskService.createTask({ title: "먼저", status: "todo" });
    const second = await s.taskService.createTask({ title: "나중", status: "todo" });
    await s.taskService.moveTask(first.id, "doing");
    s.tick(1000);
    await s.taskService.moveTask(second.id, "doing");

    expect(s.timers.getTimers().map((t) => t.taskId)).toEqual([second.id, first.id]);
  });

  it("[R4] DOING 상태로 곧바로 생성(퀵 애드)해도 타이머가 생긴다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "바로 시작", status: "doing" });
    expect(s.timers.getTimer(task.id)).not.toBeNull();
  });

  it("[R5] DOING 유지 중 다른 필드를 수정해도 타이머가 리셋되지 않는다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "수정중", status: "doing" });
    s.timers.start(task.id);
    s.tick(5_000);

    await s.taskService.updateTitle(task.id, "제목 바꿈");

    const snap = s.timers.getTimer(task.id);
    expect(snap?.phase).toBe("running");
    expect(snap?.elapsedMs).toBe(5_000);
    expect(snap?.title).toBe("제목 바꿈");
  });
});

describe("TaskTimerService — 스타트 / 정지(일시정지)", () => {
  it("[R6] 스타트를 누르기 전에는 시간이 흘러도 경과는 0이다 (카드 요구: 스타트 눌러야 추적)", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "대기", status: "doing" });
    s.tick(60_000);
    expect(s.timers.getTimer(task.id)?.elapsedMs).toBe(0);
    expect(s.timers.getTimer(task.id)?.phase).toBe("idle");
  });

  it("[R7] 스타트를 누르면 시간 추적이 시작된다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "추적", status: "doing" });
    s.timers.start(task.id);
    s.tick(3_000);
    expect(s.timers.getTimer(task.id)?.phase).toBe("running");
    expect(s.timers.getTimer(task.id)?.elapsedMs).toBe(3_000);
  });

  it("[R8] 정지(일시정지)하면 경과가 동결되고, 다시 스타트하면 이어서 누적된다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "정지", status: "doing" });
    s.timers.start(task.id);
    s.tick(10_000);
    s.timers.pause(task.id);
    s.tick(30_000); // 정지 동안 흐른 시간은 세지 않는다
    expect(s.timers.getTimer(task.id)?.phase).toBe("paused");
    expect(s.timers.getTimer(task.id)?.elapsedMs).toBe(10_000);

    s.timers.start(task.id); // 재개
    s.tick(5_000);
    expect(s.timers.getTimer(task.id)?.elapsedMs).toBe(15_000);
  });

  it("[R9] 중복 호출은 안전하다: running에 start, idle에 pause는 no-op", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "중복", status: "doing" });
    s.timers.pause(task.id); // idle에 pause
    expect(s.timers.getTimer(task.id)?.phase).toBe("idle");

    s.timers.start(task.id);
    s.tick(2_000);
    s.timers.start(task.id); // running에 start — 앵커가 리셋되면 안 된다
    s.tick(2_000);
    expect(s.timers.getTimer(task.id)?.elapsedMs).toBe(4_000);
  });

  it("[R10] 한 타이머를 정지해도 다른 태스크의 타이머는 계속 돈다 (독립성)", async () => {
    const s = await setup();
    const a = await s.taskService.createTask({ title: "A", status: "doing" });
    const b = await s.taskService.createTask({ title: "B", status: "doing" });
    s.timers.start(a.id);
    s.timers.start(b.id);
    s.tick(4_000);
    s.timers.pause(a.id);
    s.tick(6_000);

    expect(s.timers.getTimer(a.id)?.elapsedMs).toBe(4_000);
    expect(s.timers.getTimer(b.id)?.elapsedMs).toBe(10_000);
  });
});

describe("TaskTimerService — 단계별 시간 측정·저장", () => {
  it("[R10b] 단계를 바꾸면 이전 단계 시간을 확정하고 새 단계 측정을 시작한다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({
      title: "단계 전환", status: "doing", steps: ["조사", "구현", "검증"],
    });
    s.timers.start(task.id);
    s.tick(5_000);

    await s.timers.selectStep(task.id, 2);
    expect(s.store.getState().tasks.get(task.id)?.stepSeconds).toEqual([5, 0, 0]);
    s.tick(3_000);

    expect(s.timers.getTimer(task.id)?.stepElapsedMs).toEqual([5_000, 3_000, 0]);
    expect(s.timers.getTimer(task.id)?.elapsedMs).toBe(8_000);
  });

  it("[R10c] 일시정지하면 현재 단계 시간을 task의 stepNSeconds에 저장한다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({
      title: "단계 일시정지", status: "doing", steps: ["조사", "검증"],
    });
    s.timers.start(task.id);
    s.tick(7_000);
    s.timers.pause(task.id);
    await flushAsync();

    expect(s.store.getState().tasks.get(task.id)?.stepSeconds).toEqual([7, 0]);
    s.tick(20_000);
    expect(s.timers.getTimer(task.id)?.stepElapsedMs).toEqual([7_000, 0]);
  });

  it("[R10d] 외부 AI가 currentStep을 바꿔도 이전 단계 시간을 저장한다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({
      title: "AI 단계 전환", status: "doing", steps: ["조사", "검증"],
    });
    s.timers.start(task.id);
    s.tick(9_000);

    await s.taskService.updateTask(task.id, { currentStep: 2 });
    await flushAsync();

    expect(s.store.getState().tasks.get(task.id)?.stepSeconds).toEqual([9, 0]);
    s.tick(4_000);
    expect(s.timers.getTimer(task.id)?.stepElapsedMs).toEqual([9_000, 4_000]);
  });

  it("[R10e] 스탑 시 마지막 단계까지 초 단위로 확정한다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({
      title: "단계 종료", status: "doing", steps: ["조사", "검증"],
    });
    s.timers.start(task.id);
    s.tick(2_000);
    await s.timers.selectStep(task.id, 2);
    s.tick(6_000);

    await s.timers.stop(task.id);

    expect(s.store.getState().tasks.get(task.id)?.stepSeconds).toEqual([2, 6]);
  });

  it("[R10f] 종료·리로드 checkpoint는 Stop 없이 전체/단계 시간을 먼저 저장한다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({
      title: "종료 직전 저장", status: "doing", steps: ["분석", "검증"],
    });
    s.timers.start(task.id);
    s.tick(6_000);

    await s.timers.flushForShutdown();

    expect(s.store.getState().tasks.get(task.id)).toMatchObject({
      status: "doing",
      stepSeconds: [6, 0],
    });
    expect(s.timers.getTimer(task.id)).toMatchObject({
      phase: "running",
      elapsedMs: 6_000,
      stepElapsedMs: [6_000, 0],
    });
    expect(s.saved.at(-1)?.[0]).toMatchObject({
      taskId: task.id,
      phase: "running",
      accumulatedMs: 6_000,
      runningSince: 6_000,
      stepAccumulatedMs: [6_000, 0],
      stepRunningSince: 6_000,
    });

    s.tick(2_000);
    expect(s.timers.getTimer(task.id)?.elapsedMs).toBe(8_000);
  });
});

describe("TaskTimerService — 스탑 버튼", () => {
  it("[R11] 스탑을 누르면 태스크가 DONE으로 이동하고 타이머(배너)가 사라진다 (카드 요구)", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "끝내기", status: "doing" });
    s.timers.start(task.id);
    s.tick(3_000);

    await s.timers.stop(task.id);

    expect(s.store.getState().tasks.get(task.id)?.status).toBe("done");
    expect(boardColumn(s, "done")).toContain(task.id);
    expect(boardColumn(s, "doing")).not.toContain(task.id);
    expect(s.timers.getTimer(task.id)).toBeNull();
    expect(s.timers.getTimers()).toHaveLength(0);
  });

  it("[R11b] 스탑 시 측정 시간이 MD(1MD=8시간)로 환산되어 actualMd에 기록된다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "공수기록", status: "doing" });
    s.timers.start(task.id);
    s.tick(4 * 60 * 60 * 1000); // 4시간 추적

    await s.timers.stop(task.id);

    expect(s.store.getState().tasks.get(task.id)?.actualMd).toBe(0.5);
  });

  it("[R11c] 기존 actualMd가 있으면 덮어쓰지 않고 합산한다 (Jira 동기화·재추적 보호)", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({
      title: "합산", status: "doing", actualMd: 0.5,
    });
    s.timers.start(task.id);
    s.tick(8 * 60 * 60 * 1000); // 8시간 = 1 MD

    await s.timers.stop(task.id);

    expect(s.store.getState().tasks.get(task.id)?.actualMd).toBe(1.5);
  });

  it("[R11d] 스타트 없이(측정 0) 스탑하면 actualMd는 건드리지 않는다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "빈스탑", status: "doing" });
    s.tick(60_000); // idle이므로 측정 없음

    await s.timers.stop(task.id);

    expect(s.store.getState().tasks.get(task.id)?.status).toBe("done");
    expect(s.store.getState().tasks.get(task.id)?.actualMd ?? null).toBeNull();
  });

  it("[R11e] 정지(일시정지) 상태에서 스탑해도 동결된 측정분이 기록된다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "정지후스탑", status: "doing" });
    s.timers.start(task.id);
    s.tick(2 * 60 * 60 * 1000); // 2시간
    s.timers.pause(task.id);
    s.tick(60 * 60 * 1000); // 정지 동안 1시간은 세지 않는다

    await s.timers.stop(task.id);

    expect(s.store.getState().tasks.get(task.id)?.actualMd).toBe(0.25);
  });
});

describe("TaskTimerService — 보드 조작과의 동기화", () => {
  it("[R12] 보드에서 DOING 밖으로 옮기면 타이머가 사라진다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "이탈", status: "doing" });
    s.timers.start(task.id);
    await s.taskService.moveTask(task.id, "in-review");
    expect(s.timers.getTimer(task.id)).toBeNull();
  });

  it("[R13] 태스크 삭제·보관 시 타이머가 사라진다", async () => {
    const s = await setup();
    const a = await s.taskService.createTask({ title: "삭제", status: "doing" });
    const b = await s.taskService.createTask({ title: "보관", status: "doing" });

    await s.taskService.deleteTask(a.id);
    expect(s.timers.getTimer(a.id)).toBeNull();

    await s.taskService.archiveTask(b.id);
    expect(s.timers.getTimer(b.id)).toBeNull();
  });

  it("[R14] 재색인(tasks:indexed) 시 reconcile: DOING인데 타이머 없으면 idle 생성, DOING 아니면 제거", async () => {
    const s = await setup();
    const doing = await s.taskService.createTask({ title: "진행중", status: "doing" });
    const todo = await s.taskService.createTask({ title: "할일", status: "todo" });

    // 외부 수정 등으로 store만 바뀐 상황을 흉내: todo를 doing으로 몰래 바꾸고 재색인
    const tasks = s.store.getState().tasks;
    const flipped = { ...tasks.get(todo.id)!, status: "doing" as const };
    s.store.getState().upsertTask(flipped);
    s.events.emit({ type: "tasks:indexed", tasks: [tasks.get(doing.id)!, flipped] });

    expect(s.timers.getTimer(todo.id)?.phase).toBe("idle");
    expect(s.timers.getTimer(doing.id)).not.toBeNull();
  });
});

describe("TaskTimerService — 스와이프 dismiss (서비스 상태)", () => {
  it("[R15] dismiss하면 배너만 숨고(dismissed=true) 추적은 계속된다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "숨김", status: "doing" });
    s.timers.start(task.id);
    s.tick(2_000);

    s.timers.dismiss(task.id);
    s.tick(3_000);

    const snap = s.timers.getTimer(task.id);
    expect(snap?.dismissed).toBe(true);
    expect(snap?.phase).toBe("running");
    expect(snap?.elapsedMs).toBe(5_000);
  });

  it("[R15b] restore하면 숨긴 배너가 다시 표시된다 (추적 상태는 그대로)", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "복구", status: "doing" });
    s.timers.start(task.id);
    s.timers.dismiss(task.id);

    s.timers.restore(task.id);

    expect(s.timers.getTimer(task.id)).toMatchObject({ dismissed: false, phase: "running" });
  });

  it("[R16] dismiss된 타이머도 DOING 이탈·스탑 시 함께 정리된다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "숨김정리", status: "doing" });
    s.timers.dismiss(task.id);
    await s.taskService.moveTask(task.id, "done");
    expect(s.timers.getTimer(task.id)).toBeNull();
  });
});

describe("TaskTimerService — 재시작 복원 (persistence)", () => {
  it("[R17] 상태가 바뀔 때마다 port.save로 저장된다", async () => {
    const s = await setup();
    const task = await s.taskService.createTask({ title: "저장", status: "doing" });
    s.timers.start(task.id);
    await flushAsync();

    expect(s.saved.length).toBeGreaterThan(0);
    const last = s.saved.at(-1)!;
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ taskId: task.id, phase: "running" });
  });

  it("[R18] running 저장분은 재시작 사이에 흐른 벽시계 시간까지 포함해 이어진다", async () => {
    const g = buildGraph();
    const task = await g.taskService.createTask({ title: "복원", status: "doing" });
    g.persisted.push({
      taskId: task.id,
      phase: "running",
      accumulatedMs: 5_000,
      runningSince: 10_000,
      dismissed: false,
      enteredDoingAt: 8_000,
    });
    g.setClock(25_000); // "재시작" 후 현재 시각

    const timers = new TaskTimerService(g.events, g.store, g.taskService, g.port, g.now);
    await timers.init();

    const snap = timers.getTimer(task.id);
    expect(snap?.phase).toBe("running");
    expect(snap?.elapsedMs).toBe(5_000 + (25_000 - 10_000));
  });

  it("[R19] paused 저장분은 누적 그대로 paused로 복원된다", async () => {
    const g = buildGraph();
    const task = await g.taskService.createTask({ title: "정지복원", status: "doing" });
    g.persisted.push({
      taskId: task.id,
      phase: "paused",
      accumulatedMs: 42_000,
      runningSince: null,
      dismissed: false,
      enteredDoingAt: 0,
    });
    g.setClock(999_000);

    const timers = new TaskTimerService(g.events, g.store, g.taskService, g.port, g.now);
    await timers.init();

    expect(timers.getTimer(task.id)).toMatchObject({ phase: "paused", elapsedMs: 42_000 });
  });

  it("[R19b] running 단계 시간도 재시작 사이의 벽시계 시간을 포함해 복원한다", async () => {
    const g = buildGraph();
    const task = await g.taskService.createTask({
      title: "단계 복원", status: "doing", steps: ["조사", "검증"], currentStep: 2,
    });
    g.persisted.push({
      taskId: task.id,
      phase: "running",
      accumulatedMs: 3_000,
      runningSince: 10_000,
      stepAccumulatedMs: [2_000, 3_000],
      activeStep: 2,
      stepRunningSince: 10_000,
      dismissed: false,
      enteredDoingAt: 0,
    });
    g.setClock(15_000);

    const timers = new TaskTimerService(g.events, g.store, g.taskService, g.port, g.now);
    await timers.init();

    expect(timers.getTimer(task.id)?.stepElapsedMs).toEqual([2_000, 8_000]);
  });

  it("[R20] 저장분의 태스크가 더 이상 DOING이 아니면 복원하지 않는다", async () => {
    const g = buildGraph();
    const task = await g.taskService.createTask({ title: "끝난일", status: "done" });
    g.persisted.push({
      taskId: task.id,
      phase: "running",
      accumulatedMs: 0,
      runningSince: 0,
      dismissed: false,
      enteredDoingAt: 0,
    });

    const timers = new TaskTimerService(g.events, g.store, g.taskService, g.port, g.now);
    await timers.init();

    expect(timers.getTimer(task.id)).toBeNull();
  });
});

describe("formatElapsed — 배너 경과 시간 표기", () => {
  it("[R21] 1시간 미만은 MM:SS, 1시간 이상은 H:MM:SS", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(59_000)).toBe("00:59");
    expect(formatElapsed(61_000)).toBe("01:01");
    expect(formatElapsed(3_599_000)).toBe("59:59");
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(36_061_000)).toBe("10:01:01");
  });
});

describe("elapsedMsToMd — actualMd 환산 규칙", () => {
  it("[R22] 1MD=8시간, 소수 둘째 자리 반올림, 측정이 있으면 최소 0.01", () => {
    const HOUR = 60 * 60 * 1000;
    expect(elapsedMsToMd(0)).toBe(0);
    expect(elapsedMsToMd(8 * HOUR)).toBe(1);
    expect(elapsedMsToMd(4 * HOUR)).toBe(0.5);
    expect(elapsedMsToMd(2 * HOUR)).toBe(0.25);
    expect(elapsedMsToMd(1 * HOUR)).toBe(0.13); // 0.125 → 반올림
    expect(elapsedMsToMd(30 * 60 * 1000)).toBe(0.06); // 0.0625 → 반올림
    expect(elapsedMsToMd(2 * 60 * 1000)).toBe(0.01); // 0.004… → 최소 보장
    expect(elapsedMsToMd(12 * HOUR)).toBe(1.5);
  });
});
