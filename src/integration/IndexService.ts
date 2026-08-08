// LLD §6.1: IndexService.
// Plugin host와 service layer 사이의 boundary.
// services 폴더가 obsidian-free라는 ESLint 규칙을 깨지 않기 위해 별도 폴더에 둔다.
//
// 책임:
// - bootstrap: 폴더 보장, 모든 entity scan, store 채우기, board reconcile
// - Vault event 라우팅: file change → store update + board reconcile

import { TFile, TFolder, type App, type EventRef, type Plugin, type TAbstractFile } from "obsidian";
import type { DiagnosticsLog } from "../core/diagnostics";
import { isUnderFolder } from "../core/paths";
import { parseTask } from "../parser/taskMarkdown";
import { parseMeeting } from "../parser/meetingMarkdown";
import { parseProject } from "../parser/projectMarkdown";
import type { BoardRepository } from "../repositories/BoardRepository";
import type { MeetingRepository } from "../repositories/MeetingRepository";
import type { ProjectRepository } from "../repositories/ProjectRepository";
import type { TaskRepository } from "../repositories/TaskRepository";
import type { BoardService } from "../services/BoardService";
import type { TaskMasterStore } from "../store/taskMasterStore";
import type { Task } from "../core/types";

export class IndexService {
  constructor(
    private readonly app: App,
    private readonly plugin: Plugin,
    private readonly store: TaskMasterStore,
    private readonly tasks: TaskRepository,
    private readonly boardRepo: BoardRepository,
    private readonly boardService: BoardService,
    private readonly meetings: MeetingRepository,
    private readonly projects: ProjectRepository,
    private readonly diagnostics: DiagnosticsLog,
    private readonly dataRoot: string,
  ) {}

  async bootstrap(): Promise<void> {
    await this.ensureFolders();

    const [taskList, meetingList, projectList] = await Promise.all([
      this.tasks.findAll(),
      this.meetings.findAll(),
      this.projects.findAll(),
    ]);

    this.store.getState().setTasks(taskList);
    this.store.getState().setMeetings(meetingList);
    this.store.getState().setProjects(projectList);

    const board = await this.boardRepo.loadOrRebuild(taskList);
    this.boardService.replace(board);

    this.registerVaultListeners();
  }

  async ensureFolders(): Promise<void> {
    const folders = [
      this.dataRoot,
      `${this.dataRoot}/Tasks`,
      `${this.dataRoot}/Meetings`,
      `${this.dataRoot}/Projects`,
      `${this.dataRoot}/Archive`,
    ];
    for (const path of folders) {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) continue;
      try {
        await this.app.vault.createFolder(path);
      } catch (err) {
        // 부팅 직후엔 vault 인덱스가 디스크에 실존하는 폴더를 아직 모를 수 있다.
        // 그 상태에서 createFolder 는 "Folder already exists"를 던지는데, 이건
        // 정상 상황이다. 여기서 throw 하면 bootstrap 전체가 죽어 보드가 빈다
        // (2026-08-08 실사고). 진짜 생성 실패만 위로 올린다.
        const message = err instanceof Error ? err.message : String(err);
        if (!/already exists/iu.test(message)) throw err;
      }
    }
  }

  private registerVaultListeners(): void {
    this.register(
      this.app.vault.on("create", (file: TAbstractFile) => {
        void this.handleCreate(file);
      }),
    );
    this.register(
      this.app.metadataCache.on("changed", (file: TFile) => {
        void this.handleMetaChanged(file);
      }),
    );
    this.register(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        this.handleDelete(file);
      }),
    );
    this.register(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        this.handleRename(file, oldPath);
      }),
    );
  }

  private register(ref: EventRef): void {
    this.plugin.registerEvent(ref);
  }

  /** Test entrypoint for vault event handlers. */
  async handleCreateForTest(file: TAbstractFile): Promise<void> {
    return this.handleCreate(file);
  }
  async handleMetaChangedForTest(file: TFile): Promise<void> {
    return this.handleMetaChanged(file);
  }
  handleDeleteForTest(file: TAbstractFile): void {
    this.handleDelete(file);
  }
  handleRenameForTest(file: TAbstractFile, oldPath: string): void {
    this.handleRename(file, oldPath);
  }

  /**
   * plugin 외부(디스크에 직접 write 등)에서 생성된 파일은 metadataCache가 아직
   * frontmatter를 파싱하기 전에 "create"가 먼저 발생할 수 있어, cache 대신
   * raw 파싱 결과로 type을 직접 판별한다.
   */
  private async handleCreate(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile)) return;
    if (!isUnderFolder(file.path, this.dataRoot)) return;
    const raw = await this.app.vault.cachedRead(file);
    if (parseTask(raw)) {
      await this.handleTaskMeta(file);
    } else if (parseMeeting(raw)) {
      await this.handleMeetingMeta(file);
    } else if (parseProject(raw)) {
      await this.handleProjectMeta(file);
    }
  }

  private async handleMetaChanged(file: TFile): Promise<void> {
    if (!isUnderFolder(file.path, this.dataRoot)) return;
    const cache = this.app.metadataCache.getFileCache(file);
    const fmType = cache?.frontmatter?.["type"];
    if (!fmType) return;

    if (fmType === "task") await this.handleTaskMeta(file);
    else if (fmType === "meeting") await this.handleMeetingMeta(file);
    else if (fmType === "project") await this.handleProjectMeta(file);
  }

  private async handleTaskMeta(file: TFile): Promise<void> {
    try {
      const raw = await this.app.vault.cachedRead(file);
      const parsed = parseTask(raw);
      if (!parsed) {
        this.diagnostics.record({
          kind: "parse", path: file.path, message: "validation failed on modify",
        });
        return;
      }
      const previous = this.store.getState().tasks.get(parsed.task.id);
      const next: Task = {
        ...parsed.task,
        knownMtime: file.stat.mtime,
        path: file.path,
      };
      this.store.getState().upsertTask(next);

      // status, archive, deletion → board reconcile
      const statusChanged = !previous || previous.status !== next.status;
      const archivedChanged = !previous || previous.archivedAt !== next.archivedAt;
      if (statusChanged || archivedChanged) {
        const allTasks = [...this.store.getState().tasks.values()];
        const reconciled = this.boardRepo.reconcile(this.store.getState().board, allTasks);
        this.boardService.replace(reconciled);
      }
    } catch (err) {
      this.diagnostics.record({
        kind: "parse", path: file.path, message: "metaChanged handler failed",
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleMeetingMeta(file: TFile): Promise<void> {
    try {
      const raw = await this.app.vault.cachedRead(file);
      const parsed = parseMeeting(raw);
      if (!parsed) return;
      const next = { ...parsed.meeting, knownMtime: file.stat.mtime, path: file.path };
      this.store.getState().upsertMeeting(next);
    } catch (err) {
      this.diagnostics.record({
        kind: "parse", path: file.path, message: "meeting meta handler failed",
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleProjectMeta(file: TFile): Promise<void> {
    try {
      const raw = await this.app.vault.cachedRead(file);
      const parsed = parseProject(raw);
      if (!parsed) return;
      const next = { ...parsed.project, knownMtime: file.stat.mtime, path: file.path };
      this.store.getState().upsertProject(next);
    } catch (err) {
      this.diagnostics.record({
        kind: "parse", path: file.path, message: "project meta handler failed",
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private handleDelete(file: TAbstractFile): void {
    if (!("path" in file)) return;
    if (!isUnderFolder(file.path, this.dataRoot)) return;
    const tasks = this.store.getState().tasks;
    for (const t of tasks.values()) {
      if (t.path === file.path) {
        this.store.getState().removeTask(t.id);
        const allTasks = [...this.store.getState().tasks.values()];
        const reconciled = this.boardRepo.reconcile(this.store.getState().board, allTasks);
        this.boardService.replace(reconciled);
        return;
      }
    }
    const meetings = this.store.getState().meetings;
    for (const m of meetings.values()) {
      if (m.path === file.path) {
        this.store.getState().removeMeeting(m.id);
        return;
      }
    }
  }

  private handleRename(file: TAbstractFile, oldPath: string): void {
    if (!isUnderFolder(file.path, this.dataRoot) && !isUnderFolder(oldPath, this.dataRoot)) return;
    const tasks = this.store.getState().tasks;
    for (const t of tasks.values()) {
      if (t.path === oldPath) {
        this.store.getState().upsertTask({ ...t, path: file.path });
        this.tasks.updatePath(t.id, file.path);
        return;
      }
    }
    const meetings = this.store.getState().meetings;
    for (const m of meetings.values()) {
      if (m.path === oldPath) {
        this.store.getState().upsertMeeting({ ...m, path: file.path });
        return;
      }
    }
  }
}

// TFolder type silencer if needed for runtime guard
void TFolder;
