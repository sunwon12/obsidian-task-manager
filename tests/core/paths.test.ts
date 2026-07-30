import { describe, it, expect } from "vitest";
import { safeTitle, joinPath, isUnderFolder } from "../../src/core/paths";

describe("safeTitle", () => {
  it("replaces illegal characters with -", () => {
    expect(safeTitle("a/b\\c:d*e?f\"g<h>i|j")).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("trims whitespace", () => {
    expect(safeTitle("   hello   ")).toBe("hello");
  });

  it("preserves Korean", () => {
    expect(safeTitle("웹사이트 리뉴얼 1차 회의")).toBe("웹사이트 리뉴얼 1차 회의");
  });

  it("caps at 60 chars", () => {
    const long = "a".repeat(100);
    expect(safeTitle(long).length).toBe(60);
  });

  it("returns 'untitled' for empty or whitespace input", () => {
    expect(safeTitle("")).toBe("untitled");
    expect(safeTitle("   ")).toBe("untitled");
  });

  it("preserves illegal-only input as dashes (does not pretend it was empty)", () => {
    // illegal 문자는 "-"로 치환되므로 "///"는 "---"가 된다.
    // 사용자 의도를 손상하지 않고 그대로 반영.
    expect(safeTitle("///")).toBe("---");
  });

  it("strips newlines (which would be illegal)", () => {
    expect(safeTitle("line1\nline2")).toBe("line1-line2");
  });
});

describe("joinPath", () => {
  it("joins with single slash", () => {
    expect(joinPath("TaskMaster", "Tasks", "x.md")).toBe("TaskMaster/Tasks/x.md");
  });

  it("strips leading and trailing slashes from parts", () => {
    expect(joinPath("/TaskMaster/", "/Tasks/")).toBe("TaskMaster/Tasks");
  });

  it("ignores empty parts", () => {
    expect(joinPath("a", "", "b")).toBe("a/b");
  });
});

describe("isUnderFolder", () => {
  it("matches direct child", () => {
    expect(isUnderFolder("TaskMaster/Tasks/x.md", "TaskMaster")).toBe(true);
  });

  it("matches nested child", () => {
    expect(isUnderFolder("TaskMaster/Tasks/sub/x.md", "TaskMaster")).toBe(true);
  });

  it("rejects sibling with same prefix", () => {
    expect(isUnderFolder("TaskMasterOther/x.md", "TaskMaster")).toBe(false);
  });

  it("rejects folder itself", () => {
    expect(isUnderFolder("TaskMaster", "TaskMaster")).toBe(false);
  });

  it("handles trailing slash on folder arg", () => {
    expect(isUnderFolder("TaskMaster/x.md", "TaskMaster/")).toBe(true);
  });
});
