import { describe, expect, it } from "vitest";
import { basenameWithoutExt, wikiLinkToName, wikiLinkToPath } from "../../src/core/wikiLink";

describe("wikiLink helpers", () => {
  it("creates note and block wikilinks from vault paths", () => {
    expect(basenameWithoutExt("TaskMaster/Projects/Checkout - project_ABC.md")).toBe(
      "Checkout - project_ABC",
    );
    expect(wikiLinkToPath("TaskMaster/Projects/Checkout - project_ABC.md")).toBe(
      "[[Checkout - project_ABC]]",
    );
    expect(wikiLinkToPath("TaskMaster/Projects/Checkout - project_ABC.md", "tm-memo-01")).toBe(
      "[[Checkout - project_ABC#^tm-memo-01]]",
    );
  });

  it("normalizes caret-prefixed block ids", () => {
    expect(wikiLinkToName("Meeting", "^block-id")).toBe("[[Meeting#^block-id]]");
  });
});
