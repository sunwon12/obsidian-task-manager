// LLD §10.2, PRD §8.7: in-memory diagnostics + Notice throttle.
// 이 파일은 ESLint config에서 obsidian import를 명시적으로 허용한다.
import { Notice } from "obsidian";
import type { DiagnosticEntry, DiagnosticKind, IsoDateTime } from "./types";

const NOTICE_THROTTLE_MS = 5000;
const MAX_ENTRIES = 50;

export class DiagnosticsLog {
  private entries: DiagnosticEntry[] = [];
  private lastNoticeAt = new Map<DiagnosticKind, number>();

  constructor(private readonly onRecord?: (entry: DiagnosticEntry) => void) {}

  record(input: Omit<DiagnosticEntry, "ts">): void {
    const entry: DiagnosticEntry = {
      ts: new Date().toISOString() as IsoDateTime,
      ...input,
    };
    this.entries = [entry, ...this.entries].slice(0, MAX_ENTRIES);
    this.onRecord?.(entry);
    console.warn("[TaskMaster]", entry);
    this.maybeNotify(entry);
  }

  list(): readonly DiagnosticEntry[] {
    return this.entries;
  }

  /** Test helper. */
  clear(): void {
    this.entries = [];
    this.lastNoticeAt.clear();
  }

  private maybeNotify(entry: DiagnosticEntry): void {
    if (entry.kind === "boot") return;
    const last = this.lastNoticeAt.get(entry.kind) ?? 0;
    const now = Date.now();
    if (now - last < NOTICE_THROTTLE_MS) return;
    this.lastNoticeAt.set(entry.kind, now);
    new Notice(this.userMessage(entry));
  }

  private userMessage(entry: DiagnosticEntry): string {
    switch (entry.kind) {
      case "parse":
        return `TaskMaster: failed to parse ${entry.path ?? "file"}`;
      case "flush":
        return `TaskMaster: failed to save changes`;
      case "conflict":
        return `TaskMaster: conflict detected for ${entry.entityId ?? "entity"}`;
      default:
        return `TaskMaster: ${entry.message}`;
    }
  }
}
