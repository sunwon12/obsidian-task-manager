// LLD §9.5: PluginSettingTab가 React로 SettingsPane을 mount.

import { PluginSettingTab, type App, type Plugin } from "obsidian";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsPane } from "./SettingsPane";
import { TaskMasterProvider } from "../../app/providers/TaskMasterProvider";
import type { ServiceContainer } from "../../main";

export class TaskMasterSettingTab extends PluginSettingTab {
  private root: Root | null = null;

  constructor(
    app: App,
    plugin: Plugin,
    private readonly container: ServiceContainer,
  ) {
    super(app, plugin);
  }

  override display(): void {
    this.containerEl.empty();
    this.containerEl.addClass("taskmaster-root");
    this.root = createRoot(this.containerEl);
    this.root.render(
      React.createElement(TaskMasterProvider, {
        container: this.container,
        app: this.app,
        children: React.createElement(SettingsPane),
      }),
    );
  }

  override hide(): void {
    this.root?.unmount();
    this.root = null;
  }
}
