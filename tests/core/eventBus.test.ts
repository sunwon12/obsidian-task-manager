import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../../src/core/eventBus";
import type { TaskMasterEvent, BoardState, IsoDateTime } from "../../src/core/types";

const dummyBoard: BoardState = {
  version: 1,
  columns: [
    { id: "todo", title: "Todo", taskIds: [] },
    { id: "doing", title: "Doing", taskIds: [] },
    { id: "done", title: "Done", taskIds: [] },
  ],
  updatedAt: "2026-05-08T00:00:00.000Z" as IsoDateTime,
};

describe("EventBus", () => {
  it("delivers events to subscribed handlers", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe(handler);
    const event: TaskMasterEvent = { type: "board:updated", board: dummyBoard };
    bus.emit(event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("dispose function removes the handler", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const dispose = bus.subscribe(handler);
    dispose();
    bus.emit({ type: "board:updated", board: dummyBoard });
    expect(handler).not.toHaveBeenCalled();
    expect(bus.size()).toBe(0);
  });

  it("isolates handler exceptions from other handlers", () => {
    const bus = new EventBus();
    const failing = vi.fn(() => { throw new Error("boom"); });
    const ok = vi.fn();
    bus.subscribe(failing);
    bus.subscribe(ok);

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    bus.emit({ type: "board:updated", board: dummyBoard });
    expect(failing).toHaveBeenCalled();
    expect(ok).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("supports multiple subscribers", () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    bus.emit({ type: "board:updated", board: dummyBoard });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
