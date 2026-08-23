import { describe, expect, it } from "vitest";
import { appendMemoToBody, MEMO_HEADING, readMemoEntries } from "../../src/core/taskMemo";

const NOW = new Date("2026-08-23T18:42:00+09:00");
const LATER = new Date("2026-08-23T19:05:00+09:00");
const TOMORROW = new Date("2026-08-24T09:10:00+09:00");

describe("appendMemoToBody", () => {
  it("메모 절이 없으면 본문 끝에 만든다", () => {
    const body = "# 카드 제목\n\n원래 있던 설명.\n";
    const next = appendMemoToBody(body, "지현님 답변 대기 중", NOW);
    expect(next).toContain("# 카드 제목");
    expect(next).toContain("원래 있던 설명.");
    expect(next).toContain(MEMO_HEADING);
    expect(next).toContain("### 2026-08-23");
    expect(next).toContain("- 18:42 지현님 답변 대기 중");
  });

  it("같은 날 메모는 날짜 제목을 다시 만들지 않고 시간순으로 쌓는다", () => {
    const first = appendMemoToBody("# 제목\n", "첫 메모", NOW);
    const second = appendMemoToBody(first, "둘째 메모", LATER);
    expect(second.match(/### 2026-08-23/gu)).toHaveLength(1);
    expect(second.indexOf("18:42 첫 메모")).toBeLessThan(second.indexOf("19:05 둘째 메모"));
  });

  it("날짜가 바뀌면 새 날짜 제목을 연다", () => {
    const first = appendMemoToBody("# 제목\n", "어제 메모", NOW);
    const second = appendMemoToBody(first, "오늘 메모", TOMORROW);
    expect(second).toContain("### 2026-08-23");
    expect(second).toContain("### 2026-08-24");
    expect(second).toContain("- 09:10 오늘 메모");
  });

  it("메모 절 뒤에 다른 절이 있어도 그 앞에 넣는다", () => {
    const body = `# 제목\n\n${MEMO_HEADING}\n\n### 2026-08-23\n- 10:00 이전 메모\n\n## 참고\n\n링크들\n`;
    const next = appendMemoToBody(body, "새 메모", NOW);
    expect(next.indexOf("18:42 새 메모")).toBeLessThan(next.indexOf("## 참고"));
    expect(next).toContain("링크들");
  });

  it("여러 줄 메모는 한 bullet로 묶는다", () => {
    const next = appendMemoToBody("# 제목\n", "첫 줄\n둘째 줄", NOW);
    expect(next).toContain("- 18:42 첫 줄");
    expect(next).toContain("  둘째 줄");
  });

  it("빈 메모는 본문을 그대로 둔다", () => {
    const body = "# 제목\n\n내용\n";
    expect(appendMemoToBody(body, "   \n  ", NOW)).toBe(body);
  });

  it("빈 본문에서도 동작한다", () => {
    const next = appendMemoToBody("", "첫 메모", NOW);
    expect(next.startsWith(MEMO_HEADING)).toBe(true);
    expect(next).toContain("- 18:42 첫 메모");
  });
});

describe("readMemoEntries", () => {
  it("메모 절이 없으면 빈 배열이다", () => {
    expect(readMemoEntries("# 제목\n\n설명\n")).toEqual([]);
  });

  it("날짜별 메모를 기록 순서로 읽는다", () => {
    let body = appendMemoToBody("# 제목\n", "첫 메모", NOW);
    body = appendMemoToBody(body, "둘째 메모", LATER);
    body = appendMemoToBody(body, "다음날 메모", TOMORROW);

    expect(readMemoEntries(body)).toEqual([
      { date: "2026-08-23", time: "18:42", text: "첫 메모" },
      { date: "2026-08-23", time: "19:05", text: "둘째 메모" },
      { date: "2026-08-24", time: "09:10", text: "다음날 메모" },
    ]);
  });

  it("여러 줄 메모를 하나로 합친다", () => {
    const body = appendMemoToBody("# 제목\n", "첫 줄\n둘째 줄", NOW);
    expect(readMemoEntries(body)).toEqual([
      { date: "2026-08-23", time: "18:42", text: "첫 줄\n둘째 줄" },
    ]);
  });

  it("메모 절 뒤의 다른 절은 읽지 않는다", () => {
    const body = `# 제목\n\n${MEMO_HEADING}\n\n### 2026-08-23\n- 10:00 진짜 메모\n\n## 참고\n\n- 11:00 이건 메모가 아니다\n`;
    expect(readMemoEntries(body)).toEqual([
      { date: "2026-08-23", time: "10:00", text: "진짜 메모" },
    ]);
  });

  it("형식이 어긋난 줄은 흘리고 나머지를 읽는다", () => {
    const body = `${MEMO_HEADING}\n\n### 2026-08-23\n- 10:00 정상\n아무 말\n- 11:00 그 다음\n`;
    expect(readMemoEntries(body).map((entry) => entry.text)).toEqual(["정상", "그 다음"]);
  });
});
