# ADR-0007: Plugin core와 React UI를 잇는 state store로 Zustand 채택

- **Status**: Accepted
- **Date**: 2026-05-10
- **Deciders**: 제품/엔지니어링
- **Related**: PRD §8.4, §8.5, PLAN §11

## Context

플러그인은 두 개의 세계를 잇는다.

- **Plugin core** (TypeScript class): Obsidian Vault API, Repository, Service, EventBus
- **React UI** (functional components, hooks): 보드, 카드, 설정 화면

두 세계를 어떻게 연결할 것인가? 다음 흐름이 필요하다.

1. Plugin core가 Vault scan을 끝내면 React에 task 목록을 푸시.
2. React에서 카드를 옮기면 Service를 호출.
3. 외부에서 Markdown이 modify되면 Plugin core가 React state를 갱신.
4. 두 개의 TaskMaster View가 동시에 떠 있으면 둘이 동일 state를 공유.

후보:

- (A) EventBus + React useReducer (Provider 안)
- (B) Zustand store (외부 store, React가 hook으로 구독)
- (C) `useSyncExternalStore` 표준 hook + 직접 구현한 Map store

## Decision

**Zustand를 state store로 사용한다.**

- Plugin core와 React UI가 같은 Zustand store를 공유.
- Service 메서드는 store action을 호출 (`store.getState().updateTask(...)`).
- React component는 selector로 필요한 slice만 구독 (`useStore(s => s.tasks)`).
- EventBus는 Vault 이벤트를 Plugin core 내부에서 라우팅하는 용도로만 유지 (UI는 store만 보면 됨).

```ts
// src/store/taskMasterStore.ts
import { create } from "zustand";

interface TaskMasterStore {
  tasks: Map<string, Task>;
  board: BoardState;
  diagnostics: DiagnosticEntry[];

  setTasks: (tasks: Task[]) => void;
  upsertTask: (task: Task) => void;
  removeTask: (id: string) => void;
  setBoard: (board: BoardState) => void;
}

export const useTaskMasterStore = create<TaskMasterStore>((set) => ({
  tasks: new Map(),
  board: emptyBoard(),
  diagnostics: [],
  setTasks: (tasks) => set({ tasks: new Map(tasks.map((t) => [t.id, t])) }),
  upsertTask: (task) =>
    set((s) => {
      const next = new Map(s.tasks);
      next.set(task.id, task);
      return { tasks: next };
    }),
  removeTask: (id) =>
    set((s) => {
      const next = new Map(s.tasks);
      next.delete(id);
      return { tasks: next };
    }),
  setBoard: (board) => set({ board }),
}));
```

## Alternatives Considered

### A. EventBus + Provider + useReducer

장점: 라이브러리 의존성 없음.

거부 이유: 두 개의 View가 동일 state를 공유하려면 Provider를 plugin level에 두고, EventBus dispatch마다 useReducer를 거쳐야 함. selector 기반 re-render 최적화를 직접 구현해야 함. boilerplate가 많고 실수 여지 큼.

### C. `useSyncExternalStore`

장점: React 18 표준, 라이브러리 추가 없음.

거부 이유: 가장 저수준 API. selector 최적화, action dispatch, devtools는 직접 구현해야 함. Zustand는 사실상 이 hook을 잘 wrapping한 결과물. 직접 구현이 학습 가치는 있지만 production cost-benefit이 안 맞음.

### D. Redux Toolkit

장점: ecosystem 풍부.

거부 이유: Zustand 대비 boilerplate가 훨씬 많음. 우리 use case는 단순한 store 하나면 충분.

### E. MobX

장점: 강력한 reactivity.

거부 이유: 학습 곡선과 번들 크기 모두 Zustand보다 큼. observable boilerplate 필요.

## Consequences

### Positive

- 두 View가 동일 store를 공유하므로 multi-leaf 시나리오가 자연스럽게 동작 (PRD §7.1).
- Plugin core(non-React)와 React UI가 같은 store에 접근 가능 (`useTaskMasterStore.getState()`).
- selector 기반 re-render 최적화가 무료.
- Zustand 번들 크기 ~3KB로 영향 작음.

### Negative

- Zustand 의존성 추가.
- Plugin core가 React 라이브러리에 일부 의존하게 됨 (테스트 시 mock 필요).

### Mitigation

- Service layer는 store action을 호출하지만 React를 import하지 않음 (Zustand vanilla store는 React 없이 동작 가능).
- 테스트에서는 Zustand store를 직접 inspect하므로 React mock 불필요.

## Validation

- 두 leaf에 TaskMaster View를 띄우고, 한쪽에서 카드를 옮기면 다른 쪽도 즉시 갱신되는지 확인.
- selector 변경 없는 component는 re-render되지 않는지 React DevTools profiler로 확인.
