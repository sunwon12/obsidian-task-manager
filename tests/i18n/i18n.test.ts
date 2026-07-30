import { describe, it, expect } from "vitest";
import { t, __setLocaleForTest } from "../../src/i18n";
import ko from "../../src/i18n/ko";
import en from "../../src/i18n/en";

describe("i18n", () => {
  it("ko and en have the exact same key set", () => {
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
  });

  it("returns Korean string when locale is ko", () => {
    __setLocaleForTest("ko");
    expect(t("kanban.column.todo")).toBe("TODO");
    expect(t("header.newTask")).toBe("+ 새 할 일");
  });

  it("returns English string when locale is en", () => {
    __setLocaleForTest("en");
    expect(t("kanban.column.todo")).toBe("TODO");
    expect(t("header.newTask")).toBe("+ New task");
  });

  it("supports placeholder substitution via .replace", () => {
    __setLocaleForTest("ko");
    const msg = t("kanban.card.confirmDeleteMessage").replace("{title}", "샘플");
    expect(msg).toContain("샘플");
  });
});
