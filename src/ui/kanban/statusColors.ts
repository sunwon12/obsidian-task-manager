import type { ColumnId } from "../../core/types";

interface StatusColorTokens {
  solid: string;
  border: string;
  borderMuted: string;
  text: string;
  background: string;
  backgroundMuted: string;
  ring: string;
  badgeBackground: string;
}

const STATUS_COLORS: Record<ColumnId, StatusColorTokens> = {
  hold: {
    solid: "#94a3b8",
    border: "#cbd5e1",
    borderMuted: "rgba(148, 163, 184, 0.34)",
    text: "#64748b",
    background: "rgba(148, 163, 184, 0.14)",
    backgroundMuted: "rgba(148, 163, 184, 0.06)",
    ring: "rgba(148, 163, 184, 0.24)",
    badgeBackground: "rgba(148, 163, 184, 0.18)",
  },
  todo: {
    solid: "#3b82f6",
    border: "#93c5fd",
    borderMuted: "rgba(59, 130, 246, 0.32)",
    text: "#2563eb",
    background: "rgba(59, 130, 246, 0.12)",
    backgroundMuted: "rgba(59, 130, 246, 0.05)",
    ring: "rgba(59, 130, 246, 0.22)",
    badgeBackground: "rgba(59, 130, 246, 0.16)",
  },
  doing: {
    solid: "#8b5cf6",
    border: "#c4b5fd",
    borderMuted: "rgba(139, 92, 246, 0.32)",
    text: "#7c3aed",
    background: "rgba(139, 92, 246, 0.12)",
    backgroundMuted: "rgba(139, 92, 246, 0.05)",
    ring: "rgba(139, 92, 246, 0.22)",
    badgeBackground: "rgba(139, 92, 246, 0.16)",
  },
  "in-review": {
    solid: "#b7791f",
    border: "#d6a85a",
    borderMuted: "rgba(183, 121, 31, 0.28)",
    text: "#9a5f12",
    background: "rgba(183, 121, 31, 0.10)",
    backgroundMuted: "rgba(183, 121, 31, 0.04)",
    ring: "rgba(183, 121, 31, 0.18)",
    badgeBackground: "rgba(183, 121, 31, 0.14)",
  },
  done: {
    solid: "#3f8f5f",
    border: "#8bbf9c",
    borderMuted: "rgba(63, 143, 95, 0.28)",
    text: "#2f754a",
    background: "rgba(63, 143, 95, 0.10)",
    backgroundMuted: "rgba(63, 143, 95, 0.04)",
    ring: "rgba(63, 143, 95, 0.18)",
    badgeBackground: "rgba(63, 143, 95, 0.14)",
  },
};

export function getStatusColor(status: ColumnId): StatusColorTokens {
  return STATUS_COLORS[status];
}
