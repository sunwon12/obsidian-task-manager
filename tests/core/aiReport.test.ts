import { describe, expect, it } from "vitest";
import { isReportForDay, parseAiReport, toLocalDate } from "../../src/core/aiReport";

const SAMPLE = `---
title: "일일 일정 피드백"
---

# 일일 일정 피드백

안내 문단.

## 2026-08-23 (일)

**스냅샷** — doing 2개: BDCC-905(오늘 마감·3MD), 옵시디언 툴 고도화.
hold 1개: BDCC-527.

- **레버리지 1위는 \`executor_*\` 노출이다** — 이펙티브 엔지니어. 배포 전에만 잴 수 있다.
- **3MD를 일요일 마감으로 두는 건 계획이 아니다** — 4000주: 못 할 것을 정하는 게 통제다.

**오늘의 하이라이트(메이크 타임)** — 보드를 현실과 맞추기 30분. 2분 시작: [[옵시디언-TODO]] 카드 열기.

---

## 2026-08-22 (토)

**스냅샷** — 이전 날짜 섹션.
`;

describe("parseAiReport", () => {
  it("맨 위 섹션만 읽어 날짜·스냅샷·불릿·하이라이트로 나눈다", () => {
    const report = parseAiReport(SAMPLE);
    expect(report?.date).toBe("2026-08-23");
    expect(report?.weekday).toBe("일");
    expect(report?.snapshot).toContain("doing 2개");
    // 같은 문단의 다음 줄까지 하나로 이어 붙인다.
    expect(report?.snapshot).toContain("hold 1개");
    expect(report?.bullets).toHaveLength(2);
    expect(report?.bullets[0]?.lead).toBe("레버리지 1위는 executor_* 노출이다");
    expect(report?.bullets[0]?.body).toContain("이펙티브 엔지니어");
    expect(report?.highlight).toContain("보드를 현실과 맞추기 30분");
    // 이전 날짜 섹션은 섞이지 않는다.
    expect(report?.snapshot).not.toContain("이전 날짜");
  });

  it("굵게·코드·위키링크 표기를 걷어내 패널이 그대로 그릴 수 있게 한다", () => {
    const report = parseAiReport(SAMPLE);
    expect(report?.highlight).toContain("옵시디언-TODO");
    expect(report?.highlight).not.toContain("[[");
    expect(report?.bullets[0]?.lead).not.toContain("**");
  });

  it("라벨이 없어도 첫 문단을 스냅샷으로 쓴다", () => {
    const report = parseAiReport("## 2026-08-23\n\n오늘 상태 한 줄.\n\n- 불릿 하나\n\n마지막 문단.\n");
    expect(report?.weekday).toBe("");
    expect(report?.snapshot).toBe("오늘 상태 한 줄.");
    expect(report?.bullets[0]?.body).toBe("불릿 하나");
    expect(report?.highlight).toBe("마지막 문단.");
  });

  it("짝이 맞는 이탤릭만 벗기고 홀로 남은 별표는 내용으로 둔다", () => {
    const report = parseAiReport('## 2026-08-23\n\n- **리드** — *"인용"* 은 벗기고 `executor_*` 는 남긴다.\n');
    expect(report?.bullets[0]?.body).toBe('"인용" 은 벗기고 executor_* 는 남긴다.');
  });

  it("섹션이 없거나 빈 입력이면 null", () => {
    expect(parseAiReport("")).toBeNull();
    expect(parseAiReport(null)).toBeNull();
    expect(parseAiReport("# 제목만 있는 문서")).toBeNull();
  });
});

describe("isReportForDay", () => {
  it("로컬 날짜 기준으로 오늘 리포트인지 판정한다", () => {
    const report = parseAiReport(SAMPLE);
    expect(isReportForDay(report, new Date("2026-08-23T09:00:00+09:00"))).toBe(true);
    expect(isReportForDay(report, new Date("2026-08-24T09:00:00+09:00"))).toBe(false);
    expect(isReportForDay(null, new Date("2026-08-23T09:00:00+09:00"))).toBe(false);
  });

  it("toLocalDate는 UTC가 아니라 로컬 달력 날짜를 쓴다", () => {
    // KST 09:00 = UTC 00:00. UTC 기준이면 하루 밀린다.
    expect(toLocalDate(new Date(2026, 7, 23, 0, 30))).toBe("2026-08-23");
  });
});
