// LLD §3.3: 경로 헬퍼.

const ILLEGAL = /[/\\:*?"<>|\n\r]/g;
const SAFE_TITLE_MAX = 60;

/**
 * Title을 OS-safe 파일명으로 변환.
 * - illegal 문자 → "-"
 * - 양끝 공백 trim
 * - 최대 60자
 * - 빈 결과면 "untitled"
 */
export function safeTitle(title: string): string {
  const trimmed = title.replace(ILLEGAL, "-").trim();
  const truncated = trimmed.slice(0, SAFE_TITLE_MAX).trim();
  return truncated.length > 0 ? truncated : "untitled";
}

/** 경로 파편들을 join하고 양끝 슬래시를 제거한다. */
export function joinPath(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/^\/|\/$/g, ""))
    .filter((p) => p.length > 0)
    .join("/");
}

/** path가 folder 아래에 있는지 검사. folder 자체는 false. */
export function isUnderFolder(path: string, folder: string): boolean {
  const normalized = folder.replace(/\/$/, "") + "/";
  return path.startsWith(normalized);
}
