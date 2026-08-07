// LLD §9.5: 최근 50개 diagnostic을 시간 역순으로 표시.

import * as React from "react";
import { useStore } from "../../app/providers/TaskMasterProvider";
import { t } from "../../i18n";
import type { DiagnosticEntry, DiagnosticKind } from "../../core/types";

const KIND_LABEL: Record<DiagnosticKind,
  "settings.diagnostics.kindParse" | "settings.diagnostics.kindFlush" | "settings.diagnostics.kindConflict" | "settings.diagnostics.kindBoot" | "settings.diagnostics.kindSync"
> = {
  parse: "settings.diagnostics.kindParse",
  flush: "settings.diagnostics.kindFlush",
  conflict: "settings.diagnostics.kindConflict",
  boot: "settings.diagnostics.kindBoot",
  sync: "settings.diagnostics.kindSync",
};

const KIND_COLOR: Record<DiagnosticKind, string> = {
  parse: "tm-text-tm-warning",
  flush: "tm-text-tm-error",
  conflict: "tm-text-tm-warning",
  boot: "tm-text-tm-muted",
  sync: "tm-text-tm-error",
};

export const DiagnosticsPane: React.FC = () => {
  const entries = useStore((s) => s.diagnostics);
  // 최신부터 (store가 unshift하므로 그대로).
  const list: readonly DiagnosticEntry[] = entries;

  if (list.length === 0) {
    return (
      <div className="tm-text-tm-muted tm-text-sm tm-py-2">
        {t("settings.diagnostics.empty")}
      </div>
    );
  }

  return (
    <ul className="tm-text-sm tm-divide-y tm-divide-tm-border tm-max-h-64 tm-overflow-y-auto">
      {list.map((e, i) => (
        <li key={`${e.ts}-${i}`} className="tm-py-2">
          <div className="tm-flex tm-items-baseline tm-gap-2">
            <span className={`tm-font-medium ${KIND_COLOR[e.kind]}`}>
              {t(KIND_LABEL[e.kind])}
            </span>
            <span className="tm-text-tm-faint tm-text-xs">{e.ts}</span>
          </div>
          {e.path && (
            <div className="tm-text-tm-muted tm-text-xs tm-mt-0.5">{e.path}</div>
          )}
          <div className="tm-text-tm-text">{e.message}</div>
          {e.cause && (
            <div className="tm-text-tm-faint tm-text-xs tm-mt-0.5">{e.cause}</div>
          )}
        </li>
      ))}
    </ul>
  );
};
