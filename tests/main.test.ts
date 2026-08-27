import { describe, expect, it } from "vitest";
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

  it("Obsidian 플러그인은 Electron 랏코 런타임을 소유하지 않는다", async () => {
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
    const runtime = plugin as unknown as Record<string, unknown>;
    expect(runtime["timerService"]).toBeUndefined();
    expect(runtime["timerMenuBarDispose"]).toBeUndefined();
    expect(runtime["taskMenuPopover"]).toBeUndefined();
    plugin.onunload();
  });
});
