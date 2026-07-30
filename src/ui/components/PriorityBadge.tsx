// PRD §10.6: color-blind 친화. 색상만으로 의미 표현 안 함 (라벨 텍스트 함께 표기).

import * as React from "react";
import type { Priority } from "../../core/types";

const styles: Record<Exclude<Priority, never>, { label: string; classes: string }> = {
  low: { label: "Low", classes: "tm-bg-tm-bg-alt tm-text-tm-muted" },
  medium: { label: "Medium", classes: "tm-bg-tm-warning/20 tm-text-tm-warning" },
  high: { label: "High", classes: "tm-bg-tm-error/20 tm-text-tm-error" },
};

export const PriorityBadge: React.FC<{ priority: Priority | null }> = ({ priority }) => {
  if (priority === null) return null;
  const s = styles[priority];
  return (
    <span
      className={`tm-inline-block tm-px-2 tm-py-0.5 tm-rounded tm-text-xs tm-font-medium ${s.classes}`}
      aria-label={`Priority ${s.label}`}
    >
      {s.label}
    </span>
  );
};
