// T-003 sanity test. T-101 이후 실제 단위 테스트가 추가되면 삭제 예정.
import { describe, it, expect } from "vitest";
import { App, normalizePath } from "obsidian";

describe("vitest environment", () => {
  it("runs a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("loads obsidian mock from alias", () => {
    const app = new App();
    expect(app.vault).toBeDefined();
    expect(app.metadataCache).toBeDefined();
  });

  it("normalizePath cleans separators", () => {
    expect(normalizePath("/a//b/")).toBe("a/b");
  });

  it("jsdom DOM is available", () => {
    const div = document.createElement("div");
    div.textContent = "hello";
    expect(div.textContent).toBe("hello");
  });
});
