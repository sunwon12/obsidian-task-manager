import * as React from "react";
import { Check, EyeOff } from "lucide-react";
import { TASK_STATUS_ORDER } from "../../core/types";
import { t } from "../../i18n";
import { getStatusColor } from "./statusColors";
import { statusLabel } from "./statusLabels";
import type { ColumnId } from "../../core/types";

interface Props {
  hiddenStatuses: ReadonlySet<ColumnId>;
  counts?: Partial<Record<ColumnId, number>>;
  onToggleStatus: (status: ColumnId) => void;
  className?: string;
}

export const StatusVisibilityBar: React.FC<Props> = ({
  hiddenStatuses,
  counts,
  onToggleStatus,
  className = "",
}) => {
  const visibleCount = TASK_STATUS_ORDER.filter((status) => !hiddenStatuses.has(status)).length;

  return (
    <div
      aria-label={t("kanban.visibility.label")}
      className={`tm-flex tm-flex-wrap tm-gap-2 ${className}`}
    >
      {TASK_STATUS_ORDER.map((status) => {
        const label = statusLabel(status);
        const visible = !hiddenStatuses.has(status);
        const disabled = visible && visibleCount <= 1;
        const color = getStatusColor(status);
        const actionLabel = visible
          ? t("kanban.visibility.hideStatus").replace("{status}", label)
          : t("kanban.visibility.showStatus").replace("{status}", label);
        const buttonStyle: React.CSSProperties = visible
          ? {
              borderColor: color.border,
              backgroundColor: color.background,
              color: color.text,
              boxShadow: `0 0 0 2px ${color.ring}`,
            }
          : {
              borderColor: color.borderMuted,
              backgroundColor: color.backgroundMuted,
              color: "var(--text-muted)",
            };

        return (
          <button
            key={status}
            type="button"
            aria-label={actionLabel}
            aria-pressed={visible}
            disabled={disabled}
            onClick={() => onToggleStatus(status)}
            style={buttonStyle}
            className={
              "tm-inline-flex tm-items-center tm-gap-1.5 tm-rounded-full tm-border-2 tm-px-3 tm-py-1.5 " +
              "tm-text-xs tm-font-semibold tm-leading-none tm-transition-all disabled:tm-cursor-not-allowed " +
              (visible
                ? "tm-border-solid hover:tm-bg-tm-bg-hover"
                : "tm-border-dashed hover:tm-bg-tm-bg-hover")
            }
          >
            {visible ? (
              <Check aria-hidden="true" className="tm-h-3.5 tm-w-3.5 tm-shrink-0" />
            ) : (
              <EyeOff aria-hidden="true" className="tm-h-3.5 tm-w-3.5 tm-shrink-0" />
            )}
            <span>{label}</span>
            {typeof counts?.[status] === "number" && (
              <span
                className={
                  "tm-ml-0.5 tm-rounded-full tm-px-1.5 tm-py-0.5 tm-text-[10px] " +
                  (visible ? "" : "tm-bg-tm-bg-alt tm-text-tm-muted")
                }
                style={visible ? { backgroundColor: color.badgeBackground } : undefined}
              >
                {counts[status]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
