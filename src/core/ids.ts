// LLD §3.1, ADR-0003: ULID + short ID 충돌 처리.
import { ulid } from "ulid";

const SHORT_ID_MIN = 8;
/** ULID 전체 길이 (Crockford Base32 26자) */
const SHORT_ID_MAX = 26;

/**
 * 새 ULID를 entity prefix와 함께 생성한다.
 * @example newId("task") → "task_01HX7SM2J6K4XQ7EV6C8T92PPW"
 */
export function newId<T extends string>(prefix: T): `${T}_${string}` {
  return `${prefix}_${ulid()}` as `${T}_${string}`;
}

/**
 * Full ID에서 ULID 부분만 추출.
 * `task_01HX7SM2...` → `01HX7SM2...`
 */
export function ulidOf(fullId: string): string {
  const idx = fullId.indexOf("_");
  if (idx < 0) throw new Error(`Invalid ID: ${fullId}`);
  return fullId.slice(idx + 1);
}

/**
 * Short ID 생성. 충돌 시 길이 자동 확장.
 *
 * @param fullId          full prefixed ID (예: "task_01HX7SM2J6K...")
 * @param existingShorts  기존에 사용 중인 short ID set
 * @returns short ID with prefix (예: "task_01HX7SM2")
 */
export function makeShortId(
  fullId: string,
  existingShorts: ReadonlySet<string>,
): string {
  const underscore = fullId.indexOf("_");
  if (underscore < 0) throw new Error(`Invalid ID: ${fullId}`);
  const prefix = fullId.slice(0, underscore + 1);
  const ulidPart = ulidOf(fullId);
  for (let len = SHORT_ID_MIN; len <= SHORT_ID_MAX; len++) {
    const candidate = prefix + ulidPart.slice(0, len);
    if (!existingShorts.has(candidate)) return candidate;
  }
  throw new Error(`short ID exhausted for ${fullId}`);
}

/** Type guard: full prefixed ID 형식 검증. */
export function isValidId(prefix: string, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const expected = prefix + "_";
  if (!value.startsWith(expected)) return false;
  const rest = value.slice(expected.length);
  return rest.length === 26 && /^[0-9A-HJKMNP-TV-Z]+$/.test(rest);
}
