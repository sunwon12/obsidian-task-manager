// LLD §13: 테스트용 obsidian mock.
// 실제 Vault 동작을 in-memory로 흉내내어 Repository 단위 테스트가 가능하게 한다.

import { vi } from "vitest";

export class TFile {
  basename: string;
  extension: string;
  name: string;
  path: string;
  parent: TFolder | null = null;
  stat: { ctime: number; mtime: number; size: number };
  vault!: Vault;

  constructor(path: string, content = "") {
    this.path = path;
    const parts = path.split("/");
    this.name = parts[parts.length - 1] ?? "";
    const dot = this.name.lastIndexOf(".");
    this.basename = dot >= 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot >= 0 ? this.name.slice(dot + 1) : "";
    const now = Date.now();
    this.stat = { ctime: now, mtime: now, size: content.length };
  }
}

export class TFolder {
  name: string;
  path: string;
  parent: TFolder | null = null;
  children: Array<TFile | TFolder> = [];

  constructor(path: string) {
    this.path = path;
    const parts = path.split("/");
    this.name = parts[parts.length - 1] ?? "";
  }
}

export class TAbstractFile {
  path = "";
  name = "";
}

export type EventRef = { _eventRef: true };

/**
 * In-memory Vault. T-202 이후 Repository 테스트에서 사용한다.
 */
export class Vault {
  private files = new Map<string, TFile>();
  private folders = new Set<string>();
  private contents = new Map<string, string>();
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  // ---- Files & Folders ----
  getAbstractFileByPath(path: string): TFile | TFolder | null {
    if (this.files.has(path)) return this.files.get(path) ?? null;
    if (this.folders.has(path)) return new TFolder(path);
    return null;
  }

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].filter((f) => f.extension === "md");
  }

  async createFolder(path: string): Promise<TFolder> {
    this.folders.add(path);
    return new TFolder(path);
  }

  async create(path: string, content: string): Promise<TFile> {
    if (this.files.has(path)) throw new Error(`File exists: ${path}`);
    const file = new TFile(path, content);
    file.vault = this;
    this.files.set(path, file);
    this.contents.set(path, content);
    this.emit("create", file);
    return file;
  }

  async read(file: TFile): Promise<string> {
    return this.contents.get(file.path) ?? "";
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.contents.get(file.path) ?? "";
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.contents.set(file.path, content);
    file.stat.mtime = Date.now();
    file.stat.size = content.length;
    this.emit("modify", file);
  }

  async delete(file: TFile): Promise<void> {
    this.files.delete(file.path);
    this.contents.delete(file.path);
    this.emit("delete", file);
  }

  async trash(file: TFile, _system: boolean): Promise<void> {
    return this.delete(file);
  }

  async rename(file: TFile, newPath: string): Promise<void> {
    const oldPath = file.path;
    const content = this.contents.get(oldPath) ?? "";
    this.files.delete(oldPath);
    this.contents.delete(oldPath);
    file.path = newPath;
    this.files.set(newPath, file);
    this.contents.set(newPath, content);
    this.emit("rename", file, oldPath);
  }

  // ---- Events ----
  on(name: string, handler: (...args: unknown[]) => void): EventRef {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(handler);
    return { _eventRef: true };
  }

  offref(_ref: EventRef): void {
    // Tests usually let GC handle this.
  }

  private emit(name: string, ...args: unknown[]): void {
    this.listeners.get(name)?.forEach((h) => h(...args));
  }
}

/**
 * MetadataCache mock — frontmatter parse는 단순 regex로 흉내.
 * Repository는 obsidian의 실제 metadataCache를 사용하므로,
 * 테스트에서는 직접 frontmatter를 등록할 수 있도록 set 메서드를 추가했다.
 */
export class MetadataCache {
  private cache = new Map<string, { frontmatter?: Record<string, unknown> }>();
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null {
    return this.cache.get(file.path) ?? null;
  }

  /** Test helper: 직접 frontmatter 주입. */
  __set(path: string, frontmatter: Record<string, unknown>): void {
    this.cache.set(path, { frontmatter });
  }

  on(name: string, handler: (...args: unknown[]) => void): EventRef {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(handler);
    return { _eventRef: true };
  }

  __emit(name: string, ...args: unknown[]): void {
    this.listeners.get(name)?.forEach((h) => h(...args));
  }
}

export class FileManager {
  constructor(private vault: Vault) {}
  async renameFile(file: TFile, newPath: string): Promise<void> {
    return this.vault.rename(file, newPath);
  }
}

export class Workspace {
  private leaves: WorkspaceLeaf[] = [];
  getLeavesOfType(_type: string): WorkspaceLeaf[] { return this.leaves; }
  getRightLeaf(_split: boolean): WorkspaceLeaf | null { return new WorkspaceLeaf(); }
  getLeaf(_mode?: string): WorkspaceLeaf { return new WorkspaceLeaf(); }
  revealLeaf(_leaf: WorkspaceLeaf): void {}
  detachLeavesOfType(_type: string): void {}
}

export class WorkspaceLeaf {
  async setViewState(_state: unknown): Promise<void> {}
  async openFile(_file: TFile): Promise<void> {}
}

export class App {
  vault: Vault;
  metadataCache: MetadataCache;
  workspace: Workspace;
  fileManager: FileManager;

  constructor() {
    this.vault = new Vault();
    this.metadataCache = new MetadataCache();
    this.workspace = new Workspace();
    this.fileManager = new FileManager(this.vault);
  }
}

export class Plugin {
  app: App;
  manifest = { id: "taskmaster-plugin", name: "TaskMaster", version: "0.1.0", minAppVersion: "1.5.0", description: "", author: "" };

  constructor(app: App, _manifest: unknown) {
    this.app = app;
  }

  registerEvent(_ref: EventRef): void {}

  async loadData(): Promise<unknown> { return null; }
  async saveData(_data: unknown): Promise<void> {}

  addRibbonIcon = vi.fn();
  addCommand = vi.fn();
  addSettingTab = vi.fn();
  registerView = vi.fn();
}

export class ItemView {
  contentEl = document.createElement("div");
  constructor(_leaf: WorkspaceLeaf) {}
  getViewType(): string { return ""; }
  getDisplayText(): string { return ""; }
}

export class PluginSettingTab {
  containerEl = document.createElement("div");
  constructor(_app: App, _plugin: Plugin) {}
  display(): void {}
  hide(): void {}
}

export class Setting {
  constructor(_containerEl: HTMLElement) {}
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
}

export class Modal {
  contentEl = document.createElement("div");
  app: App;
  constructor(app: App) { this.app = app; }
  open(): void {}
  close(): void {}
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

export const moment = {
  locale: () => "en",
};

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
