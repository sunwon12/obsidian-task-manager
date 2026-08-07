import { describe, it, expect } from "vitest";
import { parseFile, serializeFile } from "../../src/parser/frontmatter";

describe("parseFile", () => {
  it("returns empty managed/passthrough when no frontmatter", () => {
    const { fm, body } = parseFile("just body text", "task");
    expect(fm.managed).toEqual({});
    expect(fm.passthrough).toEqual({});
    expect(fm.fieldOrder).toEqual([]);
    expect(body).toBe("just body text");
  });

  it("splits managed and passthrough fields", () => {
    const raw = `---
schemaVersion: 1
id: task_01HX7SM2J6K4XQ7EV6C8T92PPW
type: task
status: doing
tags:
  - alpha
  - urgent
deadline: 2026-06-01
---

# Title

body
`;
    const { fm, body } = parseFile(raw, "task");
    expect(fm.managed).toMatchObject({
      schemaVersion: 1,
      id: "task_01HX7SM2J6K4XQ7EV6C8T92PPW",
      type: "task",
      status: "doing",
    });
    expect(fm.passthrough).toEqual({ deadline: "2026-06-01" });
    expect(fm.fieldOrder).toEqual([
      "schemaVersion", "id", "type", "status", "tags", "deadline",
    ]);
    expect(body).toContain("# Title");
  });

  it("ignores ---- inside body", () => {
    const raw = `---
id: task_01HX7SM2J6K4XQ7EV6C8T92PPW
type: task
---

# Title

before

---

after
`;
    const { fm, body } = parseFile(raw, "task");
    expect(fm.managed.type).toBe("task");
    expect(body).toContain("before");
    expect(body).toContain("after");
    expect(body).toContain("---");
  });

  it("handles empty frontmatter", () => {
    const raw = `---
---

# body
`;
    const { fm, body } = parseFile(raw, "task");
    expect(fm.managed).toEqual({});
    expect(fm.passthrough).toEqual({});
    expect(body).toContain("# body");
  });
});

describe("serializeFile", () => {
  it("preserves field order", () => {
    const raw = `---
schemaVersion: 1
id: task_01HX7SM2J6K4XQ7EV6C8T92PPW
type: task
status: todo
tags:
  - alpha
priority: high
---

body
`;
    const { fm, body } = parseFile(raw, "task");
    const out = serializeFile(fm, body);
    const parsed = parseFile(out, "task");
    expect(parsed.fm.fieldOrder).toEqual([
      "schemaVersion", "id", "type", "status", "tags", "priority",
    ]);
  });

  it("round-trips passthrough fields", () => {
    const raw = `---
id: task_01HX7SM2J6K4XQ7EV6C8T92PPW
type: task
status: doing
schemaVersion: 1
tags:
  - obsidian
  - kanban
aliases:
  - WSR
deadline: 2026-06-01
---

body
`;
    const { fm, body } = parseFile(raw, "task");
    const out = serializeFile(fm, body);
    const reparsed = parseFile(out, "task");
    expect(reparsed.fm.passthrough).toEqual(fm.passthrough);
    expect(reparsed.fm.managed).toEqual(fm.managed);
  });

  it("appends new managed fields after existing fieldOrder", () => {
    const raw = `---
id: task_01HX7SM2J6K4XQ7EV6C8T92PPW
type: task
status: todo
schemaVersion: 1
---

body
`;
    const { fm, body } = parseFile(raw, "task");
    fm.managed.priority = "high";
    const out = serializeFile(fm, body);
    const reparsed = parseFile(out, "task");
    expect(reparsed.fm.fieldOrder).toEqual([
      "id", "type", "status", "schemaVersion", "priority",
    ]);
    expect(reparsed.fm.managed.priority).toBe("high");
  });

  it("removes a field when set to undefined", () => {
    const raw = `---
id: task_01HX7SM2J6K4XQ7EV6C8T92PPW
type: task
status: todo
schemaVersion: 1
archivedAt: 2026-05-08T12:00:00Z
---
`;
    const { fm, body } = parseFile(raw, "task");
    fm.managed.archivedAt = undefined;
    const out = serializeFile(fm, body);
    const reparsed = parseFile(out, "task");
    expect("archivedAt" in reparsed.fm.managed).toBe(false);
  });

  it("emits empty array as []", () => {
    const fm = {
      managed: {},
      passthrough: { tags: [] as string[] },
      fieldOrder: ["tags"],
    };
    const out = serializeFile(fm, "");
    expect(out).toContain("tags: []");
  });

  it("preserves Korean and special characters in body", () => {
    const raw = `---
id: task_01HX7SM2J6K4XQ7EV6C8T92PPW
type: task
status: todo
schemaVersion: 1
---

# 웹사이트 리뉴얼 1차 회의

## 결정 사항

- 메인 컬러 유지
- 관련 참고 문서: [[기존 디자인 가이드]]
`;
    const { fm, body } = parseFile(raw, "task");
    const out = serializeFile(fm, body);
    expect(out).toContain("# 웹사이트 리뉴얼 1차 회의");
    expect(out).toContain("[[기존 디자인 가이드]]");
  });

  it("quotes scalar strings that look like reserved words", () => {
    const fm = {
      managed: {},
      passthrough: { val: "yes" },
      fieldOrder: ["val"],
    };
    const out = serializeFile(fm, "");
    expect(out).toContain('val: "yes"');
  });

  it("quotes scalar strings that look like numbers", () => {
    const fm = {
      managed: {},
      passthrough: { val: "12345" },
      fieldOrder: ["val"],
    };
    const out = serializeFile(fm, "");
    expect(out).toContain('val: "12345"');
  });
});
