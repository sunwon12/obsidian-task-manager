import { describe, it, expect, vi } from "vitest";
import { SettingsRepository } from "../../src/repositories/SettingsRepository";
import { DEFAULT_SETTINGS } from "../../src/core/types";

interface MockPlugin {
  data: unknown;
  loadData: () => Promise<unknown>;
  saveData: (data: unknown) => Promise<void>;
}

function makePlugin(initial: unknown = null): MockPlugin {
  return {
    data: initial,
    loadData: vi.fn(async function (this: MockPlugin) {
      return this.data;
    }),
    saveData: vi.fn(async function (this: MockPlugin, data: unknown) {
      this.data = data;
    }),
  };
}

describe("SettingsRepository", () => {
  it("returns DEFAULT_SETTINGS when data is null", async () => {
    const plugin = makePlugin(null);
    const repo = new SettingsRepository(plugin as never);
    const result = await repo.load();
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("returns DEFAULT_SETTINGS when data is non-object", async () => {
    const plugin = makePlugin("corrupted");
    const repo = new SettingsRepository(plugin as never);
    const result = await repo.load();
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial settings with defaults", async () => {
    const plugin = makePlugin({ saveDebounceMs: 1000 });
    const repo = new SettingsRepository(plugin as never);
    const result = await repo.load();
    expect(result.saveDebounceMs).toBe(1000);
    expect(result.dataRootPath).toBe(DEFAULT_SETTINGS.dataRootPath);
    expect(result.confirmOnDelete).toBe(DEFAULT_SETTINGS.confirmOnDelete);
    expect(result.version).toBe(1);
  });

  it("save persists exactly what was given", async () => {
    const plugin = makePlugin();
    const repo = new SettingsRepository(plugin as never);
    const next = { ...DEFAULT_SETTINGS, saveDebounceMs: 750 };
    await repo.save(next);
    expect(plugin.saveData).toHaveBeenCalledWith(next);
  });

  it("forces version to 1 even when source has different version", async () => {
    const plugin = makePlugin({ version: 99, dataRootPath: "x" });
    const repo = new SettingsRepository(plugin as never);
    const result = await repo.load();
    expect(result.version).toBe(1);
    expect(result.dataRootPath).toBe("x");
  });

  it("drops removed Timeline settings during migration", async () => {
    const plugin = makePlugin({
      timelineView: { scale: "month", groupMode: "project" },
    });
    const repo = new SettingsRepository(plugin as never);
    const result = await repo.load();
    expect(result).not.toHaveProperty("timelineView");
  });

  it("migrates collapsedColumns to hiddenStatuses", async () => {
    const plugin = makePlugin({
      collapsedColumns: ["todo", "missing", "done"],
    });
    const repo = new SettingsRepository(plugin as never);
    const result = await repo.load();
    expect(result.hiddenStatuses).toEqual(["todo", "done"]);
    expect(result).not.toHaveProperty("collapsedColumns");
  });

  it("filters hiddenStatuses and keeps at least one status visible", async () => {
    const plugin = makePlugin({
      hiddenStatuses: ["hold", "todo", "doing", "in-review", "done", "missing"],
    });
    const repo = new SettingsRepository(plugin as never);
    const result = await repo.load();
    expect(result.hiddenStatuses).toEqual(["hold", "todo", "doing", "in-review", "done"]);
  });
});
