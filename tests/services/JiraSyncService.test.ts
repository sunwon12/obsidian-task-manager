// 2026-08-18 실사고: Jira에서 완료로 바꿔도 로컬 카드가 IN REVIEW로 남았다.
// 원인이 두 겹이라 둘 다 여기서 잠근다.
//  ① 사용자 JQL이 완료를 제외해(`statusCategory != Done` 기본값) 완료된 이슈가
//     결과에서 빠지고, 동기화가 그 카드를 영영 건드리지 않는다.
//  ② 상태 표시명이 Jira UI 언어를 따라가 한국어 계정은 "완료"인데,
//     매핑 정규식이 영어만 봐서 todo로 떨어졌다.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "obsidian";
import { JiraSyncService } from "../../src/services/JiraSyncService";
import { TaskService } from "../../src/services/TaskService";
import { BoardService } from "../../src/services/BoardService";
import { TaskRepository } from "../../src/repositories/TaskRepository";
import { BoardRepository } from "../../src/repositories/BoardRepository";
import type { JiraIssue, JiraRepository } from "../../src/repositories/JiraRepository";
import { DiagnosticsLog } from "../../src/core/diagnostics";
import { EventBus } from "../../src/core/eventBus";
import { createTaskMasterStore } from "../../src/store/taskMasterStore";
import { DEFAULT_SETTINGS } from "../../src/core/types";

const TASKS = "TaskMaster/Tasks";
const ARCHIVE = "TaskMaster/Archive";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function issue(partial: Partial<JiraIssue> & { key: string }): JiraIssue {
  return {
    summary: partial.key,
    statusName: "",
    statusCategoryKey: "",
    hierarchyLevel: 0,
    description: "",
    estimateMd: null,
    actualMd: null,
    dueDate: null,
    ...partial,
  };
}

function build(jqlResult: JiraIssue[], byKeyResult: JiraIssue[]) {
  const app = new App();
  const diag = new DiagnosticsLog();
  const events = new EventBus();
  const store = createTaskMasterStore();
  const taskRepo = new TaskRepository(app, diag, 500, TASKS, ARCHIVE);
  const boardRepo = new BoardRepository(app, diag, "TaskMaster/.board.json", 500);
  const board = new BoardService(boardRepo, store, events);
  const tasks = new TaskService(taskRepo, board, store, events);
  const askedKeys: string[][] = [];
  const jira = {
    search: async () => jqlResult,
    searchByKeys: async (_s: unknown, keys: readonly string[]) => {
      askedKeys.push([...keys]);
      return byKeyResult.filter((i) => keys.includes(i.key));
    },
  } as unknown as JiraRepository;
  const sync = new JiraSyncService(jira, tasks, diag);
  return { sync, tasks, store, askedKeys };
}

describe("JiraSyncService — JQL에서 빠진 이슈 되찾기", () => {
  it("완료되어 JQL 결과에서 사라진 이슈도 키로 다시 조회해 상태를 닫는다", async () => {
    const done = issue({ key: "BDCC-944", summary: "완료된 일", statusName: "완료", statusCategoryKey: "done" });
    const { sync, tasks, store, askedKeys } = build([], [done]);

    // 아직 완료 전이라 JQL에 잡히던 시절 생성된 카드
    await tasks.upsertJiraIssue(issue({
      key: "BDCC-944", summary: "완료된 일", statusName: "In Developer Test",
      statusCategoryKey: "indeterminate", hierarchyLevel: 0,
    }));
    const card = [...store.getState().tasks.values()].find((t) => t.jiraKey === "BDCC-944")!;
    expect(card.status).toBe("in-review");

    const result = await sync.sync(DEFAULT_SETTINGS);

    expect(askedKeys[0]).toContain("BDCC-944");
    expect(store.getState().tasks.get(card.id)?.status).toBe("done");
    expect(result.created).toBe(0);
  });

  it("JQL이 돌려준 이슈는 키 재조회 대상에서 빠진다", async () => {
    const live = issue({ key: "BDCC-932", statusName: "In Progress", statusCategoryKey: "indeterminate" });
    const { sync, askedKeys } = build([live], []);
    await sync.sync(DEFAULT_SETTINGS);
    expect(askedKeys[0]).not.toContain("BDCC-932");
  });
});

describe("JiraSyncService — 에픽은 보드에 올리지 않는다", () => {
  it("에픽(hierarchyLevel 1)은 카드로 만들지 않는다", async () => {
    const epic = issue({
      key: "BDCC-932", summary: "이구홈갤러리 오픈 후 Quick 후속 대응",
      statusName: "In Progress", statusCategoryKey: "indeterminate", hierarchyLevel: 1,
    });
    const normal = issue({
      key: "BDCC-945", summary: "크리에이터 전체보기",
      statusName: "In Progress", statusCategoryKey: "indeterminate", hierarchyLevel: 0,
    });
    const { sync, store } = build([epic, normal], []);

    const result = await sync.sync(DEFAULT_SETTINGS);

    const keys = [...store.getState().tasks.values()].map((t) => t.jiraKey);
    expect(keys).toEqual(["BDCC-945"]);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("하위작업(-1)과 일반(0)은 그대로 올린다", async () => {
    const subtask = issue({ key: "BDCC-100", statusName: "In Progress", hierarchyLevel: -1 });
    const normal = issue({ key: "BDCC-101", statusName: "In Progress", hierarchyLevel: 0 });
    const { sync, store } = build([subtask, normal], []);

    await sync.sync(DEFAULT_SETTINGS);

    expect([...store.getState().tasks.values()].map((t) => t.jiraKey).sort())
      .toEqual(["BDCC-100", "BDCC-101"]);
  });

  it("키 재조회로 되찾은 이슈에도 같은 규칙을 적용한다", async () => {
    const epic = issue({ key: "BDCC-932", statusName: "완료", statusCategoryKey: "done", hierarchyLevel: 1 });
    const { sync, tasks, store } = build([], [epic]);
    // 규칙이 생기기 전 만들어진 에픽 카드가 이미 있어도 되살려 갱신하지 않는다
    await tasks.upsertJiraIssue(issue({
      key: "BDCC-932", statusName: "In Progress", statusCategoryKey: "indeterminate", hierarchyLevel: 1,
    }));
    const card = [...store.getState().tasks.values()].find((t) => t.jiraKey === "BDCC-932")!;

    await sync.sync(DEFAULT_SETTINGS);

    expect(store.getState().tasks.get(card.id)?.status).toBe("doing"); // 건드리지 않음
  });
});
