// LLD §7.1, ADR-0007: Zustand vanilla store.
// Vanilla를 쓰는 이유는 services가 react를 import하지 않게 하기 위함이다 (ESLint zone).
// React 통합은 store/selectors.ts가 useStore hook으로 wrap한다.

import { createStore, type StoreApi } from "zustand/vanilla";
import { DEFAULT_BOARD_COLUMN_DEFS } from "../core/types";
import type {
  BoardState, DiagnosticEntry, IsoDateTime, Priority,
  Meeting, MeetingId, Project, ProjectId,
  Task, TaskId,
} from "../core/types";

export type ProjectFilter = "all" | "none" | ProjectId;
export type PriorityFilter = "all" | Priority;
export type ViewMode = "board" | "archive";

export interface TaskMasterState {
  tasks: Map<TaskId, Task>;
  meetings: Map<MeetingId, Meeting>;
  projects: Map<ProjectId, Project>;
  board: BoardState;
  diagnostics: readonly DiagnosticEntry[];
  selectedProjectId: ProjectFilter;
  hideCompleted: boolean;
  viewMode: ViewMode;
  searchQuery: string;
  priorityFilter: PriorityFilter;
  settingsRevision: number;
}

export interface TaskMasterActions {
  setTasks: (tasks: Task[]) => void;
  upsertTask: (task: Task) => void;
  removeTask: (id: TaskId) => void;

  setMeetings: (meetings: Meeting[]) => void;
  upsertMeeting: (m: Meeting) => void;
  removeMeeting: (id: MeetingId) => void;

  setProjects: (projects: Project[]) => void;
  upsertProject: (p: Project) => void;

  setBoard: (board: BoardState) => void;
  recordDiagnostic: (entry: DiagnosticEntry) => void;
  setProjectFilter: (id: ProjectFilter) => void;
  setHideCompleted: (hide: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  setPriorityFilter: (priority: PriorityFilter) => void;
  bumpSettingsRevision: () => void;

  /** Test/teardown용. */
  reset: () => void;
}

export type TaskMasterStore = StoreApi<TaskMasterState & TaskMasterActions>;

const MAX_DIAGNOSTICS = 50;

const emptyBoard: BoardState = {
  version: 1,
  columns: DEFAULT_BOARD_COLUMN_DEFS.map(({ id, title }) => ({ id, title, taskIds: [] })),
  updatedAt: new Date(0).toISOString() as IsoDateTime,
};

function emptyState(): TaskMasterState {
  return {
    tasks: new Map(),
    meetings: new Map(),
    projects: new Map(),
    board: emptyBoard,
    diagnostics: [],
    selectedProjectId: "all",
    hideCompleted: false,
    viewMode: "board",
    searchQuery: "",
    priorityFilter: "all",
    settingsRevision: 0,
  };
}

export function createTaskMasterStore(): TaskMasterStore {
  return createStore<TaskMasterState & TaskMasterActions>((set) => ({
    ...emptyState(),

    setTasks: (tasks) =>
      set({ tasks: new Map(tasks.map((t) => [t.id, t])) }),

    upsertTask: (task) =>
      set((s) => {
        const next = new Map(s.tasks);
        next.set(task.id, task);
        return { tasks: next };
      }),

    removeTask: (id) =>
      set((s) => {
        if (!s.tasks.has(id)) return s;
        const next = new Map(s.tasks);
        next.delete(id);
        return { tasks: next };
      }),

    setMeetings: (meetings) =>
      set({ meetings: new Map(meetings.map((m) => [m.id, m])) }),

    upsertMeeting: (m) =>
      set((s) => {
        const next = new Map(s.meetings);
        next.set(m.id, m);
        return { meetings: next };
      }),

    removeMeeting: (id) =>
      set((s) => {
        if (!s.meetings.has(id)) return s;
        const next = new Map(s.meetings);
        next.delete(id);
        return { meetings: next };
      }),

    setProjects: (projects) =>
      set({ projects: new Map(projects.map((p) => [p.id, p])) }),

    upsertProject: (p) =>
      set((s) => {
        const next = new Map(s.projects);
        next.set(p.id, p);
        return { projects: next };
      }),

    setBoard: (board) => set({ board }),

    recordDiagnostic: (entry) =>
      set((s) => {
        const next = [entry, ...s.diagnostics].slice(0, MAX_DIAGNOSTICS);
        return { diagnostics: next };
      }),

    setProjectFilter: (id) => set({ selectedProjectId: id }),
    setHideCompleted: (hide) => set({ hideCompleted: hide }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setPriorityFilter: (priority) => set({ priorityFilter: priority }),
    bumpSettingsRevision: () =>
      set((s) => ({ settingsRevision: s.settingsRevision + 1 })),

    reset: () => set(emptyState()),
  }));
}
