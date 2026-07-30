// LLD §10.3: 단순 lookup. 외부 라이브러리 없음.

import { moment } from "obsidian";
import ko from "./ko";
import en from "./en";

const locales = { ko, en } as const;
export type LocaleKey = keyof typeof locales;
export type StringKey = keyof typeof ko;

type LocaleStrings = Record<keyof typeof ko, string>;
let current: LocaleStrings = en;

/**
 * Plugin onload에서 settings.locale로 호출.
 * 'auto'는 Obsidian moment.locale()로 결정.
 */
export function initI18n(localePref: "auto" | LocaleKey): void {
  const resolved: LocaleKey =
    localePref === "auto"
      ? (moment.locale().startsWith("ko") ? "ko" : "en")
      : localePref;
  current = locales[resolved];
}

export function t(key: StringKey): string {
  return current[key] ?? en[key] ?? key;
}

/** Test helper: locale 강제. */
export function __setLocaleForTest(loc: LocaleKey): void {
  current = locales[loc];
}
