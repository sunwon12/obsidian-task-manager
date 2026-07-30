import { describe, it, expect } from "vitest";
import { nowIso, isoDate, laterOf } from "../../src/core/time";
import type { IsoDateTime } from "../../src/core/types";

describe("nowIso", () => {
  it("returns ISO 8601 string", () => {
    const v = nowIso();
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("isoDate", () => {
  it("returns YYYY-MM-DD", () => {
    expect(isoDate(new Date("2026-05-08T14:30:00Z"))).toBe("2026-05-08");
  });
});

describe("laterOf", () => {
  it("returns the later one", () => {
    const a = "2026-05-08T14:00:00.000Z" as IsoDateTime;
    const b = "2026-05-08T15:00:00.000Z" as IsoDateTime;
    expect(laterOf(a, b)).toBe(b);
    expect(laterOf(b, a)).toBe(b);
  });

  it("returns first arg on tie", () => {
    const a = "2026-05-08T14:00:00.000Z" as IsoDateTime;
    const b = "2026-05-08T14:00:00.000Z" as IsoDateTime;
    expect(laterOf(a, b)).toBe(a);
  });
});
