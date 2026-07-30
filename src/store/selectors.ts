// LLD §7.2: React selectors for the Zustand vanilla store.
// 이 파일이 react를 import하므로 services는 이 파일을 import하지 않아야 한다.

import { useMemo } from "react";
import { useStore } from "zustand";
import type {
  BoardColumn, BoardState, Task, TaskId,
} from "../core/types";
import type { PriorityFilter, ProjectFilter, TaskMasterStore } from "./taskMasterStore";

export function useTasks(store: TaskMasterStore): Map<TaskId, Task> {
  return useStore(store, (s) => s.tasks);
}

export function useBoard(store: TaskMasterStore): BoardState {
  return useStore(store, (s) => s.board);
}

export function useProjectFilter(store: TaskMasterStore): ProjectFilter {
  return useStore(store, (s) => s.selectedProjectId);
}

export function useHideCompleted(store: TaskMasterStore): boolean {
  return useStore(store, (s) => s.hideCompleted);
}

export function useSearchQuery(store: TaskMasterStore): string {
  return useStore(store, (s) => s.searchQuery);
}

export function usePriorityFilter(store: TaskMasterStore): PriorityFilter {
  return useStore(store, (s) => s.priorityFilter);
}

/**
 * 보드 + 필터 상태를 결합해 화면에 표시할 columns를 계산한다.
 * filter는 의미 데이터(Markdown)를 변경하지 않고 시야만 좁힌다.
 */
export function useFilteredBoard(store: TaskMasterStore): BoardState {
  const board = useBoard(store);
  const tasks = useTasks(store);
  const projectFilter = useProjectFilter(store);
  const hideCompleted = useHideCompleted(store);
  const searchQuery = useSearchQuery(store);
  const priorityFilter = usePriorityFilter(store);

  return useMemo(() => {
    return {
      ...board,
      columns: board.columns.map((c) =>
        filterColumn(c, tasks, projectFilter, hideCompleted, searchQuery, priorityFilter),
      ),
    };
  }, [board, tasks, projectFilter, hideCompleted, searchQuery, priorityFilter]);
}

function filterColumn(
  column: BoardColumn,
  tasks: Map<TaskId, Task>,
  projectFilter: ProjectFilter,
  hideCompleted: boolean,
  searchQuery = "",
  priorityFilter: PriorityFilter = "all",
): BoardColumn {
  let ids = column.taskIds;

  if (hideCompleted && column.id === "done") {
    return { ...column, taskIds: [] };
  }

  if (projectFilter !== "all") {
    ids = ids.filter((id) => {
      const t = tasks.get(id);
      if (!t) return false;
      if (projectFilter === "none") return t.project === null;
      return t.project === projectFilter;
    });
  }

  if (priorityFilter !== "all") {
    ids = ids.filter((id) => tasks.get(id)?.priority === priorityFilter);
  }

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  if (normalizedQuery) {
    ids = ids.filter((id) => {
      const task = tasks.get(id);
      if (!task) return false;
      return [
        task.title,
        task.bodySummary ?? "",
        task.jiraKey ?? "",
        task.remarks ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }

  return { ...column, taskIds: ids };
}

/**
 * Pure 함수 export — selector logic 단위 테스트 용.
 */
export const __test_filterColumn = filterColumn;
