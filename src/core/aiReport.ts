// AI 리포트 파싱: daily-schedule-feedback 스킬이 vault에 남긴 Markdown에서
// 최신 섹션 하나만 뽑아 패널이 렌더할 수 있는 구조로 바꾼다.
//
// 스킬 출력 형식(계약):
//   ## YYYY-MM-DD (요일)
//   **스냅샷** — ...
//   - **리드** — 본문
//   **오늘의 하이라이트(...)** — ...
//
// 형식이 조금 달라져도 패널이 빈 화면이 되지 않도록, 라벨을 못 찾으면
// 문단 위치로 폴백한다(첫 문단 = 스냅샷, 불릿 뒤 마지막 문단 = 하이라이트).

export interface AiReportBullet {
  /** 굵게 쓴 첫 구절 — 한 줄 요약으로 쓴다. */
  lead: string;
  body: string;
}

export interface AiReport {
  /** YYYY-MM-DD */
  date: string;
  /** "일" 같은 요일 한 글자. 없으면 빈 문자열. */
  weekday: string;
  snapshot: string;
  bullets: AiReportBullet[];
  highlight: string;
}

const SECTION_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})(?:\s*\(([^)]*)\))?\s*$/;
const BULLET_LINE = /^\s*[-*]\s+(.*)$/;
const BULLET_LEAD = /^\*\*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$/s;

/** 최신(파일 맨 위) 섹션 하나를 파싱한다. 섹션이 없으면 null. */
export function parseAiReport(markdown: string | null | undefined): AiReport | null {
  if (!markdown) return null;
  const lines = markdown.split(/\r?\n/u);
  const startIndex = lines.findIndex((line) => SECTION_HEADING.test(line));
  if (startIndex < 0) return null;

  const heading = SECTION_HEADING.exec(lines[startIndex]!);
  if (!heading) return null;
  const endIndex = lines.findIndex(
    (line, index) => index > startIndex && /^##\s/u.test(line),
  );
  const body = lines.slice(startIndex + 1, endIndex < 0 ? lines.length : endIndex);

  const bullets: AiReportBullet[] = [];
  const paragraphs: string[] = [];
  let buffer: string[] = [];
  let sawBullet = false;
  const flush = (): void => {
    const text = buffer.join(" ").trim();
    buffer = [];
    if (text && text !== "---") paragraphs.push(text);
  };

  for (const line of body) {
    const bullet = BULLET_LINE.exec(line);
    if (bullet) {
      flush();
      sawBullet = true;
      bullets.push(toBullet(bullet[1] ?? ""));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // 불릿 다음 줄의 들여쓴 연속 문장은 그 불릿에 이어 붙인다.
    if (sawBullet && buffer.length === 0 && /^\s{2,}\S/u.test(line) && bullets.length > 0) {
      const last = bullets[bullets.length - 1]!;
      last.body = `${last.body} ${line.trim()}`.trim();
      continue;
    }
    buffer.push(line.trim());
  }
  flush();

  const snapshot = pickLabelled(paragraphs, "스냅샷") ?? paragraphs[0] ?? "";
  const highlight = pickLabelled(paragraphs, "하이라이트")
    ?? (paragraphs.length > 1 ? paragraphs[paragraphs.length - 1]! : "");

  return {
    date: heading[1] ?? "",
    weekday: (heading[2] ?? "").trim(),
    snapshot: stripMarkdown(snapshot === highlight && paragraphs.length < 2 ? "" : snapshot),
    bullets,
    highlight: stripMarkdown(highlight),
  };
}

function toBullet(raw: string): AiReportBullet {
  const trimmed = raw.trim();
  const match = BULLET_LEAD.exec(trimmed);
  if (!match) return { lead: "", body: stripMarkdown(trimmed) };
  return {
    lead: stripMarkdown(match[1] ?? ""),
    body: stripMarkdown((match[2] ?? "").trim()),
  };
}

function pickLabelled(paragraphs: string[], label: string): string | null {
  const found = paragraphs.find((text) => text.startsWith("**") && text.includes(label));
  if (!found) return null;
  // "**스냅샷** — 본문" 에서 라벨을 떼고 본문만 남긴다.
  return found.replace(/^\*\*[^*]*\*\*\s*(?:[—–-]\s*)?/u, "");
}

/** 패널은 plain text만 그린다. 굵게/코드/위키링크 표기만 걷어낸다. */
export function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/gsu, "$1")
    // 짝이 맞는 이탤릭만 벗긴다 — `executor_*` 처럼 홀로 남은 별표는 내용이다.
    .replace(/\*([^*\n]+)\*/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

/** 리포트가 오늘 것인지 — 패널이 "새로 받기"를 권할지 결정한다. */
export function isReportForDay(report: AiReport | null, now: Date): boolean {
  if (!report) return false;
  return report.date === toLocalDate(now);
}

export function toLocalDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
