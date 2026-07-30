// LLD §10.1: typed pub/sub. handler 예외는 다른 handler를 막지 않는다.
import type { TaskMasterEvent } from "./types";

type Handler = (e: TaskMasterEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Handler>();

  /** Returns dispose function. */
  subscribe(handler: Handler): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  emit(event: TaskMasterEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[TaskMaster] event handler failed", err);
      }
    }
  }

  /** Test helper. */
  size(): number {
    return this.listeners.size;
  }
}
