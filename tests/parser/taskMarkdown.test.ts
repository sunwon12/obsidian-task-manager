import { describe, it, expect } from "vitest";
import { parseTask, serializeTask } from "../../src/parser/taskMarkdown";
import type { Task, TaskId, ProjectId, IsoDateTime } from "../../src/core/types";
import { SCHEMA_VERSION } from "../../src/core/types";

const validId = "task_01HX7SM2J6K4XQ7EV6C8T92PPW";
const validProject = "project_01HX9C5K3D8GHX0Y7T2QN8VFE2";

const baseRaw = `---
schemaVersion: 1
id: ${validId}
type: task
status: doing
project: ${validProject}
priority: high
createdAt: 2026-05-08T14:30:00.000Z
updatedAt: 2026-05-08T14:45:00.000Z
---

# 웹사이트 리뉴얼 1차 회의

본문
`;

describe("parseTask", () => {
  it("parses a valid task", () => {
    const result = parseTask(baseRaw);
    expect(result).not.toBeNull();
    expect(result!.task.id).toBe(validId);
    expect(result!.task.status).toBe("doing");
    expect(result!.task.priority).toBe("high");
    expect(result!.task.project).toBe(validProject);
    expect(result!.task.remarks).toBeNull();
    expect(result!.task.title).toBe("웹사이트 리뉴얼 1차 회의");
    expect(result!.task.bodySummary).toBe("본문");
    expect(result!.body).toContain("본문");
  });

  it("returns null when type is not task", () => {
    const raw = baseRaw.replace("type: task", "type: meeting");
    expect(parseTask(raw)).toBeNull();
  });

  it("returns null when id is invalid", () => {
    const raw = baseRaw.replace(validId, "task_short");
    expect(parseTask(raw)).toBeNull();
  });

  it("returns null when status is invalid", () => {
    const raw = baseRaw.replace("status: doing", "status: invalid");
    expect(parseTask(raw)).toBeNull();
  });

  it("parses all kanban statuses", () => {
    for (const status of ["hold", "todo", "doing", "in-review", "done"]) {
      const raw = baseRaw.replace("status: doing", `status: ${status}`);
      expect(parseTask(raw)?.task.status).toBe(status);
    }
  });

  it("downgrades invalid project to null", () => {
    const raw = baseRaw.replace(validProject, "not-a-project-id");
    const result = parseTask(raw);
    expect(result?.task.project).toBeNull();
  });

  it("downgrades invalid priority to null", () => {
    const raw = baseRaw.replace("priority: high", "priority: extreme");
    const result = parseTask(raw);
    expect(result?.task.priority).toBeNull();
  });

  it("treats archivedAt as null when absent", () => {
    expect(parseTask(baseRaw)?.task.archivedAt).toBeNull();
  });

  it("parses jiraKey when present", () => {
    const raw = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      "updatedAt: 2026-05-08T14:45:00.000Z\njiraKey: M29CEF-3126",
    );
    expect(parseTask(raw)?.task.jiraKey).toBe("M29CEF-3126");
  });

  it("treats old scheduling metadata as passthrough after Timeline removal", () => {
    const raw = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      [
        "updatedAt: 2026-05-08T14:45:00.000Z",
        "startDate: 2026-05-11",
        "dueDate: 2026-05-15",
        "milestone: true",
      ].join("\n"),
    );
    const task = parseTask(raw)?.task;
    expect(task?.passthrough).toMatchObject({
      startDate: "2026-05-11",
      dueDate: "2026-05-15",
      milestone: true,
    });
  });

  it("treats absent or empty jiraKey as null", () => {
    expect(parseTask(baseRaw)?.task.jiraKey).toBeNull();
    const empty = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      "updatedAt: 2026-05-08T14:45:00.000Z\njiraKey: ''",
    );
    expect(parseTask(empty)?.task.jiraKey).toBeNull();
  });

  it("parses remarks when present", () => {
    const raw = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      "updatedAt: 2026-05-08T14:45:00.000Z\nremarks: 리뷰 대기 중",
    );
    expect(parseTask(raw)?.task.remarks).toBe("리뷰 대기 중");
  });

  it("parses work-plan steps and the 1-based current step", () => {
    const raw = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      [
        "updatedAt: 2026-05-08T14:45:00.000Z",
        "steps:",
        "  - 서버 프롬프트",
        "  - QA 환경 검증",
        "currentStep: 2",
      ].join("\n"),
    );
    expect(parseTask(raw)?.task).toMatchObject({
      steps: ["서버 프롬프트", "QA 환경 검증"],
      currentStep: 2,
    });
  });

  it("parses individually numbered step properties", () => {
    const raw = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      [
        "updatedAt: 2026-05-08T14:45:00.000Z",
        "step1: 서버 프롬프트",
        "step2: 트러블 슈팅 문서 작성",
        "step2Seconds: 37",
        "step3: QA 환경 검증",
        "currentStep: 2",
      ].join("\n"),
    );
    expect(parseTask(raw)?.task).toMatchObject({
      steps: ["서버 프롬프트", "트러블 슈팅 문서 작성", "QA 환경 검증"],
      currentStep: 2,
      stepSeconds: [0, 37, 0],
      passthrough: {},
    });
  });

  it("clamps an out-of-range current step and ignores it when steps are absent", () => {
    const withSteps = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      "updatedAt: 2026-05-08T14:45:00.000Z\nsteps:\n  - 하나\n  - 둘\ncurrentStep: 99",
    );
    expect(parseTask(withSteps)?.task.currentStep).toBe(2);
    const withoutSteps = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      "updatedAt: 2026-05-08T14:45:00.000Z\ncurrentStep: 1",
    );
    expect(parseTask(withoutSteps)?.task.currentStep).toBeNull();
  });

  it("treats absent or empty remarks as null", () => {
    expect(parseTask(baseRaw)?.task.remarks).toBeNull();
    const empty = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      "updatedAt: 2026-05-08T14:45:00.000Z\nremarks: ''",
    );
    expect(parseTask(empty)?.task.remarks).toBeNull();
  });

  it("preserves archivedAt when present", () => {
    const raw = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      "updatedAt: 2026-05-08T14:45:00.000Z\narchivedAt: 2026-05-09T11:00:00.000Z",
    );
    expect(parseTask(raw)?.task.archivedAt).toBe("2026-05-09T11:00:00.000Z");
  });

  it("captures unknown fields in passthrough (ADR-0008)", () => {
    const raw = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      "updatedAt: 2026-05-08T14:45:00.000Z\ntags:\n  - alpha\ndeadline: 2026-06-01",
    );
    const result = parseTask(raw);
    expect(result?.task.tags).toEqual(["alpha"]);
    expect(result?.task.passthrough).toEqual({ deadline: "2026-06-01" });
  });

  it("uses Untitled when body has no H1", () => {
    const raw = baseRaw.replace(/# 웹사이트.*\n\n본문/, "본문");
    const result = parseTask(raw);
    expect(result?.task.title).toBe("Untitled");
  });
});

describe("serializeTask", () => {
  function makeTask(overrides: Partial<Task> = {}): Task {
    return {
      schemaVersion: SCHEMA_VERSION,
      id: validId as TaskId,
      type: "task",
      status: "doing",
      title: "테스트 task",
      project: null,
      priority: "high",
      jiraKey: null,
      remarks: null,
      createdAt: "2026-05-08T14:30:00.000Z" as IsoDateTime,
      updatedAt: "2026-05-08T14:45:00.000Z" as IsoDateTime,
      archivedAt: null,
      passthrough: {},
      fieldOrder: [
        "schemaVersion", "id", "type", "status", "project",
        "priority", "createdAt", "updatedAt",
      ],
      knownMtime: 0,
      path: "TaskMaster/Tasks/test.md",
      ...overrides,
    };
  }

  it("round-trips a basic task", () => {
    const task = makeTask();
    const out = serializeTask(task, "본문\n");
    const reparsed = parseTask(out);
    expect(reparsed?.task.id).toBe(task.id);
    expect(reparsed?.task.status).toBe(task.status);
    expect(reparsed?.task.priority).toBe(task.priority);
    expect(reparsed?.body).toContain("본문");
  });

  it("preserves passthrough across round-trip", () => {
    const task = makeTask({
      project: validProject as ProjectId,
      tags: ["alpha", "urgent"],
      passthrough: { deadline: "2026-06-01" },
      fieldOrder: [
        "schemaVersion", "id", "type", "status", "project",
        "priority", "createdAt", "updatedAt", "tags", "deadline",
      ],
    });
    const out = serializeTask(task, "본문\n");
    const reparsed = parseTask(out);
    expect(reparsed?.task.tags).toEqual(task.tags);
    expect(reparsed?.task.passthrough).toEqual(task.passthrough);
  });

  it("removes archivedAt when null", () => {
    const task = makeTask({ archivedAt: null });
    const out = serializeTask(task, "본문\n");
    expect(out).not.toContain("archivedAt:");
  });

  it("includes jiraKey when set", () => {
    const task = makeTask({ jiraKey: "M29CEF-3126" });
    const out = serializeTask(task, "본문\n");
    expect(out).toContain("jiraKey: M29CEF-3126");
  });

  it("excludes jiraKey when null", () => {
    const task = makeTask({ jiraKey: null });
    const out = serializeTask(task, "본문\n");
    expect(out).not.toContain("jiraKey:");
  });

  it("includes remarks when set", () => {
    const task = makeTask({ remarks: "리뷰 전 확인 필요" });
    const out = serializeTask(task, "본문\n");
    expect(out).toContain("remarks: 리뷰 전 확인 필요");
  });

  it("serializes work-plan steps as individually numbered properties", () => {
    const task = makeTask({
      steps: ["서버 프롬프트", "QA 환경 검증"],
      currentStep: 2,
      stepSeconds: [12, 34],
    });
    const out = serializeTask(task, "본문\n");
    expect(out).toContain("step1: 서버 프롬프트");
    expect(out).toContain("step2: QA 환경 검증");
    expect(out).toContain("step1Seconds: 12");
    expect(out).toContain("step2Seconds: 34");
    expect(out).not.toContain("steps:");
    expect(out).toContain("currentStep: 2");
    expect(parseTask(out)?.task).toMatchObject({
      steps: task.steps,
      currentStep: 2,
      stepSeconds: [12, 34],
    });
  });

  it("migrates the legacy steps list to numbered properties on write", () => {
    const legacy = baseRaw.replace(
      "updatedAt: 2026-05-08T14:45:00.000Z",
      "updatedAt: 2026-05-08T14:45:00.000Z\nsteps:\n  - 하나\n  - 둘\ncurrentStep: 1",
    );
    const parsed = parseTask(legacy)!;
    const task = { ...parsed.task, knownMtime: 0, path: "TaskMaster/Tasks/legacy.md" };
    const out = serializeTask(task, parsed.body);
    expect(out).toContain("step1: 하나");
    expect(out).toContain("step2: 둘");
    expect(out).not.toContain("steps:");
  });

  it("excludes remarks when null", () => {
    const task = makeTask({ remarks: null });
    const out = serializeTask(task, "본문\n");
    expect(out).not.toContain("remarks:");
  });

  it("includes archivedAt when set", () => {
    const task = makeTask({
      archivedAt: "2026-05-09T11:00:00.000Z" as IsoDateTime,
    });
    const out = serializeTask(task, "본문\n");
    expect(out).toContain("archivedAt: 2026-05-09T11:00:00.000Z");
  });

  it("syncs Markdown H1 with title", () => {
    const task = makeTask({ title: "새 제목" });
    const out = serializeTask(task, "# 옛 제목\n\n본문");
    expect(out).toContain("# 새 제목");
    expect(out).not.toContain("# 옛 제목");
  });

  it("inserts H1 if body has none", () => {
    const task = makeTask({ title: "Fresh title" });
    const out = serializeTask(task, "그냥 본문");
    expect(out).toMatch(/# Fresh title\n\n그냥 본문/);
  });

  it("estimateMd/actualMd/due 는 왕복 보존된다 (견적 회고 자산 필드)", () => {
    const task = makeTask({ estimateMd: 3.5, actualMd: 2, due: "2026-08-09" });
    const out = serializeTask(task, "본문");
    expect(out).toContain("estimateMd: 3.5");
    expect(out).toContain("actualMd: 2");
    expect(out).toContain("due: 2026-08-09");
    const back = parseTask(out)!;
    expect(back.task.estimateMd).toBe(3.5);
    expect(back.task.actualMd).toBe(2);
    expect(back.task.due).toBe("2026-08-09");
  });

  it("estimateMd/actualMd/due 가 null 이면 frontmatter 에 나타나지 않는다", () => {
    const out = serializeTask(makeTask({}), "본문");
    expect(out).not.toContain("estimateMd");
    expect(out).not.toContain("actualMd");
    expect(out).not.toContain("due:");
  });
});
