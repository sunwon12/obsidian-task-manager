// LLD §8.2: ItemView가 React root를 mount/unmount.
// HLD §3.2: .taskmaster-root class 안에서 Tailwind scope.

import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../app/App";
import type { ServiceContainer } from "../main";

export const VIEW_TYPE_TASKMASTER = "taskmaster-view";

export class TaskMasterView extends ItemView {
  private root: Root | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly container: ServiceContainer,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_TASKMASTER;
  }

  override getDisplayText(): string {
    return "TaskMaster";
  }

  override getIcon(): string {
    return "layout-dashboard";
  }

  override async onOpen(): Promise<void> {
    const host = this.contentEl;
    host.empty();
    host.addClass("taskmaster-root");
    this.root = createRoot(host);
    this.root.render(
      React.createElement(App, {
        container: this.container,
        app: this.app,
      }),
    );
  }

  override async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }
}
