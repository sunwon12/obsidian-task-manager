// LLD §4.1, ADR-0008: Markdown frontmatter parse + passthrough 직렬화.
//
// 정책:
// - frontmatter는 `---\n...\n---` fence로 감싼 YAML 영역.
// - top-level scalar / sequence / mapping만 우리 schema가 다룬다.
// - 우리 schema 외 모든 unknown field는 passthrough에 보존.
// - field 순서는 가능한 한 원본 순서를 유지한다.
// - serialize는 직접 emit한다 (js-yaml dump는 순서/style 보장이 약함).

import yaml from "js-yaml";
import type { ParsedFrontmatter } from "../core/types";

const FENCE_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export type EntityKind = "task" | "meeting" | "project";

const KNOWN_FIELDS: Record<EntityKind, ReadonlySet<string>> = {
  task: new Set([
    "schemaVersion", "id", "type", "status", "project",
    "priority", "jiraKey", "remarks", "estimateMd", "actualMd", "due",
    "tags", "steps", "currentStep", "createdAt", "updatedAt", "archivedAt",
  ]),
  meeting: new Set([
    "schemaVersion", "id", "type", "project", "date",
    "participants", "createdAt", "updatedAt",
  ]),
  project: new Set([
    "schemaVersion", "id", "type", "createdAt", "updatedAt",
  ]),
};

export interface FrontmatterParseResult {
  fm: ParsedFrontmatter;
  body: string;
}

/**
 * Markdown 전체 텍스트를 frontmatter와 body로 분리.
 * frontmatter가 없으면 fm.managed/passthrough = {}, body = 전체.
 *
 * @throws YAMLException (js-yaml load 실패 시)
 */
export function parseFile(raw: string, kind: EntityKind): FrontmatterParseResult {
  const match = raw.match(FENCE_RE);
  if (!match) {
    return {
      fm: { managed: {}, passthrough: {}, fieldOrder: [] },
      body: raw,
    };
  }
  const yamlBlock = match[1] ?? "";
  const body = match[2] ?? "";

  // Top-level field 순서를 보존하기 위해 line scan으로 fieldOrder를 추출한다.
  // js-yaml은 객체로만 반환하므로 ES2015+의 insertion order로 어느 정도 보존되지만,
  // 명시적으로 line scan하면 multi-line value도 안전하게 처리할 수 있다.
  const fieldOrder = extractTopLevelKeys(yamlBlock);

  // JSON_SCHEMA: ISO date를 자동으로 Date 객체로 변환하지 않는다 (passthrough 보존).
  const loaded = yaml.load(yamlBlock, { schema: yaml.JSON_SCHEMA });
  const obj: Record<string, unknown> =
    loaded && typeof loaded === "object" && !Array.isArray(loaded)
      ? (loaded as Record<string, unknown>)
      : {};

  const managed: Record<string, unknown> = {};
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isKnownField(kind, key)) managed[key] = value;
    else passthrough[key] = value;
  }

  return { fm: { managed, passthrough, fieldOrder }, body };
}

/** task의 step1, step2 ...는 개수가 가변적인 managed field로 취급한다. */
function isKnownField(kind: EntityKind, key: string): boolean {
  return KNOWN_FIELDS[kind].has(key) ||
    (kind === "task" && /^step[1-9]\d*(?:Seconds)?$/u.test(key));
}

/**
 * frontmatter + body를 다시 Markdown 텍스트로 직렬화.
 *
 * 동작:
 * - fieldOrder를 따라 emit. fieldOrder에 없는 새 field는 끝에 append.
 * - undefined 값은 emit하지 않음 (frontmatter에서 제거된 field 표현).
 * - null 값은 emit함 (의도적인 null 표현).
 */
export function serializeFile(fm: ParsedFrontmatter, body: string): string {
  const allKeys = mergeKeys(fm.fieldOrder, fm.managed, fm.passthrough);
  const lines: string[] = ["---"];
  for (const key of allKeys) {
    const value = key in fm.managed ? fm.managed[key] : fm.passthrough[key];
    if (value === undefined) continue;
    lines.push(emitYaml(key, value));
  }
  lines.push("---");
  // body 앞에 정확히 한 줄의 빈 줄을 둔다 (Obsidian 관례).
  const trimmedBody = body.replace(/^\n+/, "");
  return lines.join("\n") + "\n" + (trimmedBody.length > 0 ? "\n" + trimmedBody : "");
}

// ---------- internals ----------

/**
 * YAML block에서 top-level key의 등장 순서를 추출.
 * 들여쓰기된 줄(continuation)과 빈 줄, 주석은 무시.
 */
function extractTopLevelKeys(yamlBlock: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const line of yamlBlock.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith("#")) continue;
    if (/^\s/.test(line)) continue;          // 들여쓰기 = continuation
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    if (!m) continue;
    const key = m[1]!;
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/**
 * fieldOrder와 현재 managed/passthrough의 union을 순서대로.
 * fieldOrder에 없는 key는 끝에 append (managed → passthrough 순).
 */
function mergeKeys(
  fieldOrder: string[],
  managed: Record<string, unknown>,
  passthrough: Record<string, unknown>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const key of fieldOrder) {
    if (seen.has(key)) continue;
    if (key in managed || key in passthrough) {
      result.push(key);
      seen.add(key);
    }
  }
  for (const key of Object.keys(managed)) {
    if (!seen.has(key)) { result.push(key); seen.add(key); }
  }
  for (const key of Object.keys(passthrough)) {
    if (!seen.has(key)) { result.push(key); seen.add(key); }
  }
  return result;
}

/**
 * 단일 top-level key/value를 YAML line(s)로 emit.
 * - string: scalar (필요 시 quote)
 * - number/boolean/null: scalar
 * - string[]: block sequence
 * - object: js-yaml dump로 indent 2
 *
 * 다른 형태는 js-yaml dump로 fallback.
 */
function emitYaml(key: string, value: unknown): string {
  if (value === null) return `${key}: null`;
  if (typeof value === "string") return `${key}: ${emitScalarString(value)}`;
  if (typeof value === "number" || typeof value === "boolean") {
    return `${key}: ${String(value)}`;
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    if (value.length === 0) return `${key}: []`;
    return [
      `${key}:`,
      ...value.map((v) => `  - ${emitScalarString(v as string)}`),
    ].join("\n");
  }
  // Fallback: js-yaml dump.
  const dumped = yaml.dump({ [key]: value }, {
    indent: 2,
    lineWidth: 1000,
    noRefs: true,
  });
  return dumped.replace(/\n$/, "");
}

/**
 * 문자열 scalar emit. plain으로 못 쓰는 값은 quote.
 * ISO date / datetime은 unquoted로 두는 게 Obsidian 관례라 예외 처리.
 */
function emitScalarString(s: string): string {
  if (s.length === 0) return '""';
  if (ISO_DATE_LIKE.test(s)) return s;
  return needsQuote(s) ? JSON.stringify(s) : s;
}

function needsQuote(s: string): boolean {
  // ① 다른 파서가 다르게 읽을 값. Obsidian metadataCache는 YAML 1.1이라
  //    `yes`/`no`/`on`을 boolean으로 읽는다 — 우리 JSON_SCHEMA 왕복만으로는 못 잡는다.
  if (/^[\s"'`#&*!|>%@]|[:#]\s|\s$/.test(s)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true;
  if (/^-?\d/.test(s)) return true;
  // ② 우리 파서로도 왕복이 깨지는 값 (flow indicator 등).
  return !isPlainScalarSafe(s);
}

/**
 * plain scalar로 써도 원문 그대로 되읽히는지 **실제로 파싱해서** 확인한다.
 *
 * 예전에는 quote가 필요한 문자를 정규식으로 나열했는데, flow indicator(`[`, `{`)가
 * 빠져 있었다. 그 결과 사용자가 넣은 `step1: [AI] 계획 문서 생성` 같은 값이 unquoted로
 * 저장되어 **파일 전체의 YAML 파싱이 실패**했고, 그 태스크는 인덱스에서 통째로 빠져
 * Jira 동기화가 같은 이슈로 새 파일을 또 만들었다 (2026-08-18 실사고).
 *
 * 목록을 손으로 관리하면 다음 구멍이 또 생기고 실패가 조용하다. 그래서 규칙을 세지 않고
 * 왕복(emit → load)이 성립하는지만 본다. 성립하지 않으면 무조건 quote한다.
 * parseFile과 같은 JSON_SCHEMA로 검사해야 판정이 실제 읽기 경로와 일치한다.
 */
function isPlainScalarSafe(s: string): boolean {
  try {
    const loaded = yaml.load(`${PROBE_KEY}: ${s}`, { schema: yaml.JSON_SCHEMA });
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return false;
    const entries = Object.entries(loaded as Record<string, unknown>);
    return entries.length === 1 && entries[0]?.[0] === PROBE_KEY && entries[0]?.[1] === s;
  } catch {
    return false;
  }
}

/** 왕복 검사용 키. 값 판정에만 쓰이고 파일에 나가지 않는다. */
const PROBE_KEY = "v";

const ISO_DATE_LIKE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
