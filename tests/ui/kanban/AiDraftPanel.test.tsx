import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, fireEvent, act } from "@testing-library/react";
import { App as ObsidianApp } from "obsidian";
import { TaskMasterProvider } from "../../../src/app/providers/TaskMasterProvider";
import { createTaskMasterStore } from "../../../src/store/taskMasterStore";
import { EventBus } from "../../../src/core/eventBus";
import { DiagnosticsLog } from "../../../src/core/diagnostics";
import {
  BoardRepository, MeetingRepository, ProjectRepository, TaskRepository,
} from "../../../src/repositories";
import {
  BoardService, MeetingService, ProjectMemoService, ProjectService, TaskService,
} from "../../../src/services";
import { AiDraftPanel, type DraftFormValues, type DraftPatch } from "../../../src/ui/kanban/AiDraftPanel";
import { AiDraftService, type AiDraftRunner, type AiDraftRunResult } from "../../../src/services/AiDraftService";
import { DEFAULT_SETTINGS, type Task } from "../../../src/core/types";
import type { ServiceContainer } from "../../../src/main";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function stdout(payload: unknown): AiDraftRunResult {
  return {
    ok: true,
    stdout: JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(payload) }),
    message: "",
  };
}

const TASK = {
  id: "task_01TEST",
  title: "오피셜 체크 노출",
  jiraKey: "BDCC-1002",
  tags: [],
  steps: [],
  bodySummary: "",
  remarks: null,
} as unknown as Task;

function build(respond: () => Promise<AiDraftRunResult>) {
  const app = new ObsidianApp();
  const store = createTaskMasterStore();
  const events = new EventBus();
  const diagnostics = new DiagnosticsLog();
  const boardRepo = new BoardRepository(app, diagnostics, "TaskMaster/.board.json", 500);
  const boardService = new BoardService(boardRepo, store, events);
  const taskRepo = new TaskRepository(app, diagnostics, 500, "TaskMaster/Tasks", "TaskMaster/Archive");
  const projectRepo = new ProjectRepository(app, diagnostics, "TaskMaster/Projects");
  const meetingRepo = new MeetingRepository(app, diagnostics, "TaskMaster/Meetings");
  const runner: AiDraftRunner = { isSupported: () => true, run: respond };
  const container: ServiceContainer = {
    store,
    taskService: new TaskService(taskRepo, boardService, store, events),
    boardService,
    projectService: new ProjectService(projectRepo, store),
    projectMemoService: new ProjectMemoService(projectRepo, store),
    meetingService: new MeetingService(meetingRepo, store),
    aiDraftService: new AiDraftService(runner, () => ({
      enabled: true, binary: "claude", cwd: "/vault", model: "sonnet", timeoutMs: 1000,
    })),
    events,
    diagnostics,
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
  };
  return { app, container };
}

const EMPTY_VALUES: DraftFormValues = {
  priority: "none",
  project: "none",
  tags: "",
  remarks: "",
  steps: [""],
};

function renderPanel(
  container: ServiceContainer,
  app: ObsidianApp,
  values: DraftFormValues,
  onApply: (patch: DraftPatch) => void,
) {
  return render(
    <TaskMasterProvider container={container} app={app}>
      <AiDraftPanel task={TASK} values={values} onApply={onApply} />
    </TaskMasterProvider>,
  );
}

describe("AiDraftPanel", () => {
  it("비어 있던 필드만 기본 선택하고, 고른 것만 폼에 얹는다", async () => {
    const { app, container } = build(async () => stdout({
      priority: "high",
      tags: ["업무"],
      remarks: "새 비고",
      steps: ["[인간] 설계", "[AI] 구현", "[인간] 검증"],
    }));
    const applied: DraftPatch[] = [];
    const values: DraftFormValues = { ...EMPTY_VALUES, remarks: "이미 적어 둔 비고" };
    const { getByText, getByLabelText } = renderPanel(container, app, values, (patch) => applied.push(patch));

    await act(async () => { fireEvent.click(getByText(/빠르게 채우기|Fill quickly/)); });

    // 이미 값이 있는 비고는 기본 해제, 나머지는 기본 선택.
    expect((getByLabelText(/비고|Remarks/) as HTMLInputElement).checked).toBe(false);
    expect((getByLabelText(/우선순위|Priority/) as HTMLInputElement).checked).toBe(true);

    await act(async () => { fireEvent.click(getByText(/선택 항목 적용|Apply selected/)); });

    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ priority: "high", tags: "업무" });
    expect(applied[0]?.remarks).toBeUndefined();
    expect(applied[0]?.steps).toHaveLength(3);
  });

  it("이미 단계가 있으면 비평만 보여주고 단계 제안 자체가 없다", async () => {
    const { app, container } = build(async () => stdout({
      steps: [],
      critique: ["1번이 닫히기 전엔 3번이 불가능하다"],
    }));
    const values: DraftFormValues = { ...EMPTY_VALUES, steps: ["[AI] 구현"] };
    const { getByText, queryByLabelText } = renderPanel(container, app, values, () => {});

    await act(async () => { fireEvent.click(getByText(/빠르게 채우기|Fill quickly/)); });

    expect(getByText("1번이 닫히기 전엔 3번이 불가능하다")).toBeTruthy();
    expect(queryByLabelText(/작업 계획|Work plan/)).toBeNull();
  });

  it("실행 주체가 없는 계획은 경고로 알리되 조용히 고치지 않는다", async () => {
    const { app, container } = build(async () => stdout({
      steps: ["설계", "[AI] 구현", "[인간] 검증"],
    }));
    const applied: DraftPatch[] = [];
    const { getByText, getByLabelText } = renderPanel(container, app, EMPTY_VALUES, (p) => applied.push(p));

    await act(async () => { fireEvent.click(getByText(/빠르게 채우기|Fill quickly/)); });
    expect(getByText(/실행 주체를 못 읽은 단계 1개/)).toBeTruthy();

    await act(async () => { fireEvent.click(getByText(/선택 항목 적용|Apply selected/)); });
    expect(applied[0]?.steps).toEqual(["설계", "[AI] 구현", "[인간] 검증"]);
    expect((getByLabelText(/작업 계획|Work plan/) as HTMLInputElement).checked).toBe(true);
  });

  it("실패는 사라지지 않고 사유 한 줄로 남는다", async () => {
    const { app, container } = build(async () => ({ ok: false, stdout: "", message: "시간 초과 (180초)" }));
    const { getByText } = renderPanel(container, app, EMPTY_VALUES, () => {});

    await act(async () => { fireEvent.click(getByText(/빠르게 채우기|Fill quickly/)); });

    expect(getByText("시간 초과 (180초)")).toBeTruthy();
  });
});
