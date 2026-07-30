// LLD §5.1, PRD §8.9: 사용자 설정 저장소.
// Obsidian Plugin.loadData / saveData를 사용 (atomic write 보장).

import type { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, normalizeHiddenStatuses, type PluginSettings } from "../core/types";

export class SettingsRepository {
  constructor(private readonly plugin: Plugin) {}

  /** 손상된 settings는 DEFAULT_SETTINGS로 복구한다. */
  async load(): Promise<PluginSettings> {
    const raw = await this.plugin.loadData();
    if (!raw || typeof raw !== "object") {
      return { ...DEFAULT_SETTINGS };
    }
    return this.migrate(raw as Record<string, unknown>);
  }

  async save(settings: PluginSettings): Promise<void> {
    await this.plugin.saveData(settings);
  }

  /**
   * 부분 settings는 기본값으로 채운다.
   * 제거된 UI 설정은 runtime state에 다시 유입되지 않도록 버린다.
   */
  private migrate(raw: Record<string, unknown>): PluginSettings {
    const migrated = { ...raw };
    delete migrated["timelineView"];

    const hiddenSource = Array.isArray(migrated["hiddenStatuses"])
      ? migrated["hiddenStatuses"]
      : migrated["collapsedColumns"];
    const hiddenStatuses = Array.isArray(hiddenSource)
      ? normalizeHiddenStatuses(hiddenSource)
      : DEFAULT_SETTINGS.hiddenStatuses;
    delete migrated["collapsedColumns"];

    return {
      ...DEFAULT_SETTINGS,
      ...migrated,
      hiddenStatuses,
      version: 1,
    };
  }
}
