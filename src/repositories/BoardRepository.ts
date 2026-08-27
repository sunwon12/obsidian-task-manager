// LLD §5.3, ADR-0002: BoardRepository.
//
// 책임:
// - load: .board.json 읽기 (없거나 손상 시 null)
// - rebuildFromTasks: PRD §9.4 결정적 알고리즘
// - reconcile: loaded 와 tasks 사이의 drift 보정 (Markdown SoT 신뢰)
// - resolveSyncConflict: ADR-0002 정책 (winner + 누락 taskId append)
// - queueWrite + flush: debounce 처리

import { normalizePath, type App } from "obsidian";
import type { DiagnosticsLog } from "../core/diagnostics";
import { nowIso } from "../core/time";
import { DEFAULT_BOARD_COLUMN_DEFS, isTaskStatus } from "../core/types";
import type {
  BoardColumn, BoardState, ColumnId, RatkoTaskOrder, Task, TaskId,
} from "../core/types";

const COLUMN_DEFS = DEFAULT_BOARD_COLUMN_DEFS;

export class BoardRepository {
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: BoardState | null = null;
  private writeInFlight: Promise<void> | null = null;

  constructor(
    private readonly app: App,
    private readonly diagnostics: DiagnosticsLog,
    private readonly boardPath: string,
    private readonly debounceMs: number,
  ) {}

  // ---------- Read (T-207) ----------

  async loadOrRebuild(tasks: Task[]): Promise<BoardState> {
    const loaded = await this.tryLoad();
    if (!loaded) return this.rebuildFromTasks(tasks);
    return this.reconcile(loaded, tasks);
  }

  private async tryLoad(): Promise<BoardState | null> {
    // persist와 같은 이유로 adapter를 쓴다 — 인덱스로 찾으면 항상 null이라
    // 저장한 보드를 다시 읽지 못하고 매번 tasks에서 재구축했다.
    try {
      if (!(await this.app.vault.adapter.exists(this.boardPath))) return null;
      const raw = await this.app.vault.adapter.read(this.boardPath);
      const parsed = JSON.parse(raw) as unknown;
      if (!isBoardState(parsed)) return null;
      return parsed;
    } catch (err) {
      this.diagnostics.record({
        kind: "boot",
        path: this.boardPath,
        message: ".board.json corrupted, rebuilding",
        cause: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /** PRD §9.4 결정적 알고리즘: status → updatedAt desc → path asc. */
  rebuildFromTasks(tasks: Task[]): BoardState {
    const grouped = emptyTaskGroups();
    for (const t of tasks) {
      if (t.archivedAt) continue;
      grouped[t.status].push(t);
    }
    for (const id of Object.keys(grouped) as ColumnId[]) {
      grouped[id].sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) {
          return b.updatedAt.localeCompare(a.updatedAt);
        }
        return a.path.localeCompare(b.path);
      });
    }
    return {
      version: 1,
      columns: COLUMN_DEFS.map(({ id, title }) => ({
        id,
        title,
        taskIds: grouped[id].map((t) => t.id),
      })),
      updatedAt: nowIso(),
    };
  }

  /**
   * loaded와 tasks 사이의 drift 보정.
   * - tasks에 있지만 board에 없는 task → 해당 column 끝에 append
   * - board에 있지만 tasks에 없는 taskId → 제거
   * - task.status와 board column이 다르면 task.status 신뢰 (Markdown SoT)
   */
  reconcile(loaded: BoardState, tasks: Task[]): BoardState {
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const seenIds = new Set<TaskId>();

    const columns: BoardColumn[] = COLUMN_DEFS.map(({ id, title }) => {
      const sourceColumn = loaded.columns.find((c) => c.id === id);
      const orderedIds: TaskId[] = [];
      for (const taskId of sourceColumn?.taskIds ?? []) {
        const task = taskById.get(taskId);
        if (!task || task.archivedAt) continue;
        if (task.status !== id) continue;
        orderedIds.push(taskId);
        seenIds.add(taskId);
      }
      return { id, title, taskIds: orderedIds };
    });

    // 새 task append
    for (const t of tasks) {
      if (t.archivedAt || seenIds.has(t.id)) continue;
      const column = columns.find((c) => c.id === t.status);
      column?.taskIds.push(t.id);
    }

    const ratkoOrder = loaded.ratkoOrder
      ? reconcileRatkoOrder(loaded.ratkoOrder, columns, tasks)
      : null;
    return {
      version: 1,
      columns,
      updatedAt: nowIso(),
      ...(ratkoOrder ? { ratkoOrder } : {}),
    };
  }

  /**
   * ADR-0002 sync conflict 해소.
   * winner = updatedAt 큰 쪽. loser의 missing taskId는 winner의 column 끝에 append.
   */
  resolveSyncConflict(local: BoardState, remote: BoardState): BoardState {
    const winner = local.updatedAt >= remote.updatedAt ? local : remote;
    const loser = winner === local ? remote : local;

    const mergedColumns: BoardColumn[] = COLUMN_DEFS.map(({ id, title }) => {
      const wc = winner.columns.find((c) => c.id === id);
      const lc = loser.columns.find((c) => c.id === id);
      const winnerTaskIds = wc?.taskIds ?? [];
      const winnerSet = new Set<TaskId>(winnerTaskIds);
      const missing = (lc?.taskIds ?? []).filter((id) => !winnerSet.has(id));
      return { id, title, taskIds: [...winnerTaskIds, ...missing] };
    });

    const ratkoOrder = mergeRatkoOrder(winner.ratkoOrder, loser.ratkoOrder);
    return {
      version: 1,
      columns: mergedColumns,
      updatedAt: nowIso(),
      ...(ratkoOrder ? { ratkoOrder } : {}),
    };
  }

  // ---------- Write (T-208) ----------

  queueWrite(board: BoardState): void {
    this.pending = board;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.writeInFlight) return this.writeInFlight;
    if (!this.pending) return;
    const board = this.pending;
    this.pending = null;
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.writeInFlight = this.persist(board).finally(() => {
      this.writeInFlight = null;
      if (this.pending) {
        this.writeTimer = setTimeout(() => {
          void this.flush();
        }, this.debounceMs);
      }
    });
    return this.writeInFlight;
  }

  /**
   * `.board.json`은 점으로 시작해 Obsidian vault 인덱스에 잡히지 않는다.
   * getAbstractFileByPath가 항상 null이라 create 분기로만 가고, 파일은 디스크에
   * 실재하므로 "File already exists"로 매번 실패했다 — 보드가 2026-08-07 이후
   * 한 번도 저장되지 않았다. adapter는 인덱스를 거치지 않고 경로로 직접 쓴다.
   */
  private async persist(board: BoardState): Promise<void> {
    // Ratko order는 Swift 앱이 소유한다. Obsidian이 오래 들고 있던 BoardState를 쓰기 직전에
    // 디스크 최신값을 다시 읽어, 실행 중인 Ratko의 드래그 순서를 덮어쓰지 않는다.
    const onDisk = await this.tryLoad();
    const value = onDisk?.ratkoOrder
      ? { ...board, ratkoOrder: onDisk.ratkoOrder }
      : board;
    const json = JSON.stringify(value, null, 2);
    await this.app.vault.adapter.write(normalizePath(this.boardPath), json);
  }
}

// ---------- Type guard ----------

function isBoardState(v: unknown): v is BoardState {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  if (obj["version"] !== 1) return false;
  if (!Array.isArray(obj["columns"])) return false;
  if (typeof obj["updatedAt"] !== "string") return false;
  const ratkoOrder = obj["ratkoOrder"];
  if (ratkoOrder !== undefined) {
    if (!ratkoOrder || typeof ratkoOrder !== "object") return false;
    const order = ratkoOrder as Record<string, unknown>;
    if (!isStringArray(order["focusTaskIds"]) || !isStringArray(order["nextTaskIds"])) return false;
  }
  for (const c of obj["columns"]) {
    if (!c || typeof c !== "object") return false;
    const col = c as Record<string, unknown>;
    if (!isTaskStatus(col["id"])) return false;
    if (typeof col["title"] !== "string") return false;
    if (!Array.isArray(col["taskIds"])) return false;
  }
  return true;
}

function reconcileRatkoOrder(
  loaded: RatkoTaskOrder,
  columns: BoardColumn[],
  tasks: Task[],
): RatkoTaskOrder {
  const active = tasks.filter((task) => !task.archivedAt && task.status !== "done");
  const focus = new Set(active.filter((task) => task.status === "doing").map((task) => task.id));
  const next = new Set(active.filter((task) => task.status !== "doing").map((task) => task.id));
  const idsFor = (status: ColumnId): TaskId[] => columns.find((column) => column.id === status)?.taskIds ?? [];
  const fallback = [
    ...idsFor("doing"),
    ...idsFor("in-review"),
    ...idsFor("todo"),
    ...idsFor("hold"),
    ...idsFor("backlog"),
    ...active.map((task) => task.id),
  ];
  return {
    focusTaskIds: uniqueTaskIds([...loaded.focusTaskIds.filter((id) => focus.has(id)), ...fallback.filter((id) => focus.has(id))]),
    nextTaskIds: uniqueTaskIds([...loaded.nextTaskIds.filter((id) => next.has(id)), ...fallback.filter((id) => next.has(id))]),
  };
}

function mergeRatkoOrder(
  winner: RatkoTaskOrder | undefined,
  loser: RatkoTaskOrder | undefined,
): RatkoTaskOrder | null {
  if (!winner && !loser) return null;
  return {
    focusTaskIds: uniqueTaskIds([...(winner?.focusTaskIds ?? []), ...(loser?.focusTaskIds ?? [])]),
    nextTaskIds: uniqueTaskIds([...(winner?.nextTaskIds ?? []), ...(loser?.nextTaskIds ?? [])]),
  };
}

function uniqueTaskIds(ids: TaskId[]): TaskId[] {
  return [...new Set(ids)];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function emptyTaskGroups(): Record<ColumnId, Task[]> {
  return Object.fromEntries(
    COLUMN_DEFS.map(({ id }) => [id, [] as Task[]]),
  ) as Record<ColumnId, Task[]>;
}

/** Test helper: type guard 노출. */
export const __test_isBoardState = isBoardState;
