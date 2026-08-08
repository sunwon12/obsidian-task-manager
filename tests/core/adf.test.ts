import { describe, it, expect } from "vitest";
import { adfToMarkdown } from "../../src/core/adf";

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string, marks?: unknown[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });

describe("adfToMarkdown", () => {
  it("빈/널 입력은 빈 문자열", () => {
    expect(adfToMarkdown(null)).toBe("");
    expect(adfToMarkdown(undefined)).toBe("");
    expect(adfToMarkdown(doc())).toBe("");
  });

  it("문단과 인라인 마크(bold/em/code/link)", () => {
    const md = adfToMarkdown(doc(p(
      text("굵게", [{ type: "strong" }]),
      text(" 그리고 "),
      text("코드", [{ type: "code" }]),
      text(" "),
      text("링크", [{ type: "link", attrs: { href: "https://x.y" } }]),
    )));
    expect(md).toBe("**굵게** 그리고 `코드` [링크](https://x.y)");
  });

  it("heading 레벨과 리스트", () => {
    const md = adfToMarkdown(doc(
      { type: "heading", attrs: { level: 2 }, content: [text("배경")] },
      { type: "bulletList", content: [
        { type: "listItem", content: [p(text("첫째"))] },
        { type: "listItem", content: [p(text("둘째"))] },
      ] },
      { type: "orderedList", content: [
        { type: "listItem", content: [p(text("하나"))] },
      ] },
    ));
    expect(md).toBe("## 배경\n\n- 첫째\n- 둘째\n\n1. 하나");
  });

  it("codeBlock 은 언어 fence 로", () => {
    const md = adfToMarkdown(doc({
      type: "codeBlock", attrs: { language: "sql" }, content: [text("SELECT 1")],
    }));
    expect(md).toBe("```sql\nSELECT 1\n```");
  });

  it("멘션·hardBreak·모르는 노드는 내용을 잃지 않는다", () => {
    const md = adfToMarkdown(doc(
      p(text("담당 "), { type: "mention", attrs: { text: "@순원" } }, { type: "hardBreak" }, text("다음 줄")),
      { type: "panel", attrs: { panelType: "info" }, content: [p(text("패널 내용"))] },
      { type: "mediaSingle", content: [{ type: "media" }] },
    ));
    expect(md).toBe("담당 @순원\n다음 줄\n\n패널 내용\n\n[첨부]");
  });
});
