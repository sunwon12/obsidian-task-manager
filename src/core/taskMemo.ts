// 카드 본문에 짧은 메모를 덧붙인다. 랏코 패널에서 작업 중간에 상황을 적고,
// 나중에 AI가 그 본문을 읽어 정리·회고의 재료로 쓴다.
//
// 형식은 project quick memo(ADR-0011)와 같은 모양으로 맞춘다 —
//   ## 메모
//   ### YYYY-MM-DD
//   - HH:mm 내용
// 날짜별로 묶고 시간순(오래된 것이 위)으로 쌓는다. 한 카드 안에서 위에서 아래로
// 읽는 기록이라 로그와 같은 방향이다.

export const MEMO_HEADING = "## 메모";

const DATE_HEADING = /^###\s+(\d{4}-\d{2}-\d{2})\s*$/;
const MEMO_BULLET = /^-\s+(\d{2}:\d{2})\s*(.*)$/;
const SECTION_HEADING = /^##\s+/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function localTime(now: Date): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** 여러 줄 메모는 이어지는 줄을 들여써 한 bullet로 묶는다. */
function toBullet(text: string, now: Date): string[] {
  const lines = text.trim().split(/\r?\n/u);
  const [first, ...rest] = lines;
  return [`- ${localTime(now)} ${first ?? ""}`, ...rest.map((line) => `  ${line}`)];
}

/**
 * 본문에 메모 한 건을 덧붙인 새 본문을 돌려준다. 원본은 건드리지 않는다.
 * 빈 메모는 무시하고 본문을 그대로 돌려준다.
 */
export function appendMemoToBody(body: string, text: string, now: Date): string {
  if (!text.trim()) return body;
  const bullet = toBullet(text, now);
  const today = localDate(now);
  const lines = body.replace(/\s+$/u, "").split(/\r?\n/u);

  const headingIndex = lines.findIndex((line) => line.trim() === MEMO_HEADING);
  if (headingIndex < 0) {
    const prefix = lines.length === 1 && lines[0] === "" ? [] : [...lines, ""];
    return [...prefix, MEMO_HEADING, "", `### ${today}`, ...bullet, ""].join("\n");
  }

  // 메모 절의 끝 = 다음 ## 제목 직전, 없으면 본문 끝.
  let end = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (SECTION_HEADING.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }

  const section = lines.slice(headingIndex + 1, end);
  // 절 끝의 빈 줄은 삽입 뒤 다시 붙인다.
  let tail = section.length;
  while (tail > 0 && (section[tail - 1] ?? "").trim() === "") tail -= 1;

  const hasToday = section.slice(0, tail).some((line) => {
    const match = DATE_HEADING.exec(line.trim());
    return match?.[1] === today;
  });

  const inserted = hasToday
    ? [...section.slice(0, tail), ...bullet]
    : [...section.slice(0, tail), ...(tail > 0 ? [""] : []), `### ${today}`, ...bullet];

  return [
    ...lines.slice(0, headingIndex + 1),
    ...(inserted[0] === "" ? inserted : ["", ...inserted]),
    "",
    ...lines.slice(end),
  ].join("\n").replace(/\n{3,}/gu, "\n\n").replace(/\s+$/u, "") + "\n";
}

export interface MemoEntry {
  date: string;
  time: string;
  /** 이어지는 들여쓴 줄까지 합친 본문. */
  text: string;
}

/**
 * 본문의 메모 절을 읽어 기록 순서(오래된 것이 먼저)로 돌려준다.
 * 형식이 어긋난 줄은 조용히 건너뛴다 — 사람이 직접 편집하는 파일이라
 * 파서가 깨지는 것보다 못 읽는 줄을 흘리는 편이 낫다.
 */
export function readMemoEntries(body: string): MemoEntry[] {
  const lines = body.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => line.trim() === MEMO_HEADING);
  if (headingIndex < 0) return [];

  const entries: MemoEntry[] = [];
  let date = "";
  let current: MemoEntry | null = null;

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (SECTION_HEADING.test(line)) break;

    const dateMatch = DATE_HEADING.exec(line.trim());
    if (dateMatch) {
      current = null;
      date = dateMatch[1] ?? "";
      continue;
    }

    const bullet = MEMO_BULLET.exec(line.trim());
    if (bullet) {
      current = { date, time: bullet[1] ?? "", text: (bullet[2] ?? "").trim() };
      entries.push(current);
      continue;
    }

    // 들여쓴 줄은 직전 메모의 이어지는 본문이다.
    if (current && /^\s+\S/u.test(line)) {
      current.text = `${current.text}\n${line.trim()}`;
      continue;
    }
    if (line.trim() === "") continue;
    current = null;
  }

  return entries;
}
