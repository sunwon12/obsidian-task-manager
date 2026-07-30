// LLD §8.3: React Context로 ServiceContainer 주입.
// useServices는 service 인스턴스에 접근. useStore는 zustand store를 selector로 구독.

import * as React from "react";
import type { App as ObsidianApp } from "obsidian";
import { useStore as useZustandStore } from "zustand";
import type { ServiceContainer } from "../../main";
import type { TaskMasterStore, TaskMasterState, TaskMasterActions } from "../../store/taskMasterStore";

export interface ContextValue extends ServiceContainer {
  app: ObsidianApp;
}

const Ctx = React.createContext<ContextValue | null>(null);

export const TaskMasterProvider: React.FC<{
  container: ServiceContainer;
  app: ObsidianApp;
  children: React.ReactNode;
}> = ({ container, app, children }) => {
  const value = React.useMemo<ContextValue>(
    () => ({ ...container, app }),
    [container, app],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useServices(): ContextValue {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useServices: TaskMasterProvider missing");
  return v;
}

/** Store selector hook. zustand의 useStore를 wrap한다. */
export function useStore<T>(
  selector: (state: TaskMasterState & TaskMasterActions) => T,
): T {
  const { store } = useServices();
  return useZustandStore(store as TaskMasterStore, selector);
}
