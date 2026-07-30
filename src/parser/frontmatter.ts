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
    "priority", "jiraKey", "remarks", "createdAt", "updatedAt", "archivedAt",
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

  const known = KNOWN_FIELDS[kind];
  const managed: Record<string, unknown> = {};
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (known.has(key)) managed[key] = value;
    else passthrough[key] = value;
  }

  return { fm: { managed, passthrough, fieldOrder }, body };
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
 * 문자열 scalar emit. YAML special token이 들어 있으면 quote.
 * ISO date / datetime은 unquoted로 두는 게 Obsidian 관례라 예외 처리.
 */
function emitScalarString(s: string): string {
  if (s.length === 0) return '""';
  if (ISO_DATE_LIKE.test(s)) return s;
  if (
    /^[\s"'`#&*!|>%@]|[:#]\s|\s$/.test(s) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
    /^-?\d/.test(s)
  ) {
    return JSON.stringify(s);
  }
  return s;
}

const ISO_DATE_LIKE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
