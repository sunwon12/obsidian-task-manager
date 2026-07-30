import { describe, it, expect } from "vitest";
import { newId, ulidOf, makeShortId, isValidId } from "../../src/core/ids";

describe("newId", () => {
  it("returns prefixed ULID", () => {
    const id = newId("task");
    expect(id).toMatch(/^task_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("does not collide across 10000 generations", () => {
    const set = new Set<string>();
    for (let i = 0; i < 10_000; i++) set.add(newId("task"));
    expect(set.size).toBe(10_000);
  });
});

describe("ulidOf", () => {
  it("strips the prefix", () => {
    expect(ulidOf("task_01HX7SM2J6K4XQ7EV6C8T92PPW")).toBe(
      "01HX7SM2J6K4XQ7EV6C8T92PPW",
    );
  });

  it("throws on invalid format", () => {
    expect(() => ulidOf("noUnderscoreHere")).toThrow();
  });
});

describe("makeShortId", () => {
  const fullId = "task_01HX7SM2J6K4XQ7EV6C8T92PPW";

  it("returns 8-char short ID when no collision", () => {
    expect(makeShortId(fullId, new Set())).toBe("task_01HX7SM2");
  });

  it("expands length on collision", () => {
    const taken = new Set(["task_01HX7SM2"]);
    expect(makeShortId(fullId, taken)).toBe("task_01HX7SM2J");
  });

  it("expands further on multiple collisions", () => {
    const taken = new Set([
      "task_01HX7SM2",
      "task_01HX7SM2J",
      "task_01HX7SM2J6",
    ]);
    expect(makeShortId(fullId, taken)).toBe("task_01HX7SM2J6K");
  });

  it("throws when full ULID is also taken (impossible duplicate)", () => {
    const taken = new Set<string>();
    for (let len = 8; len <= 26; len++) {
      taken.add("task_" + "01HX7SM2J6K4XQ7EV6C8T92PPW".slice(0, len));
    }
    expect(() => makeShortId(fullId, taken)).toThrow();
  });
});

describe("isValidId", () => {
  it("accepts well-formed task ID", () => {
    expect(isValidId("task", "task_01HX7SM2J6K4XQ7EV6C8T92PPW")).toBe(true);
  });

  it("rejects wrong prefix", () => {
    expect(isValidId("task", "meeting_01HX7SM2J6K4XQ7EV6C8T92PPW")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidId("task", "task_01HX7SM2")).toBe(false);
  });

  it("rejects invalid Crockford characters", () => {
    expect(isValidId("task", "task_01HX7SM2J6K4XQ7EV6C8T92PPI")).toBe(false); // "I" not in alphabet
  });

  it("rejects non-string", () => {
    expect(isValidId("task", 42)).toBe(false);
    expect(isValidId("task", null)).toBe(false);
    expect(isValidId("task", undefined)).toBe(false);
  });
});
