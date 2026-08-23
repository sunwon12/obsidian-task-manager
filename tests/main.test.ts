import { describe, expect, it, vi } from "vitest";
import { App as ObsidianApp } from "obsidian";
import TaskMasterPlugin from "../src/main";

describe("TaskMasterPlugin", () => {
  it("loads without throwing in an Obsidian-like environment", async () => {
    const app = new ObsidianApp();
    const plugin = new TaskMasterPlugin(app, {
      id: "taskmaster-plugin",
      name: "TaskMaster",
      version: "0.1.0",
      minAppVersion: "1.5.0",
      description: "",
      author: "TaskMaster Team",
    });

    await expect(plugin.onload()).resolves.toBeUndefined();
    plugin.onunload();
  });

  it("리로드 중 unload된 인스턴스는 느진 bootstrap 이후 UI를 다시 만들지 않는다", async () => {
    const app = new ObsidianApp();
    const plugin = new TaskMasterPlugin(app, {
      id: "taskmaster-plugin",
      name: "TaskMaster",
      version: "0.9.0",
      minAppVersion: "1.5.0",
      description: "",
      author: "TaskMaster Team",
    });

    await plugin.onload();
    plugin.onunload();
    // onLayoutReady callback 안의 bootstrap/init promise가 모두 재개될 시간을 준다.
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect((plugin as unknown as { taskMenuPopover: unknown }).taskMenuPopover).toBeNull();
    expect(document.querySelector(".tm-timer-overlay")).toBeNull();
  });

  it("Electron UI 하나의 정리가 실패해도 나머지를 독립적으로 정리한다", () => {
    const app = new ObsidianApp();
    const plugin = new TaskMasterPlugin(app, {
      id: "taskmaster-plugin",
      name: "TaskMaster",
      version: "0.9.0",
      minAppVersion: "1.5.0",
      description: "",
      author: "TaskMaster Team",
    });
    const menuDispose = vi.fn(() => { throw new Error("native tray stale"); });
    const floatingDispose = vi.fn();
    const popoverDispose = vi.fn();
    Object.assign(plugin as unknown as Record<string, unknown>, {
      timerMenuBarDispose: menuDispose,
      timerFloatingWindow: { dispose: floatingDispose },
      taskMenuPopover: { dispose: popoverDispose },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => plugin.onunload()).not.toThrow();
    expect(menuDispose).toHaveBeenCalledOnce();
    expect(floatingDispose).toHaveBeenCalledOnce();
    expect(popoverDispose).toHaveBeenCalledOnce();
  });
});
