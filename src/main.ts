// LLD §8.1: Plugin entrypoint.
// 책임:
// - Settings load
// - Repository / Service / Store 의존성 주입 그래프 구성
// - IndexService.bootstrap (Vault scan + event listener 등록)
// - View 등록 + ribbon icon + command palette
// - onunload sync flush (ADR-0004)

import { Notice, Plugin } from "obsidian";
import { TaskMasterView, VIEW_TYPE_TASKMASTER } from "./view/TaskMasterView";
import { DiagnosticsLog } from "./core/diagnostics";
import { EventBus } from "./core/eventBus";
import { initI18n } from "./i18n";
import { TaskMasterSettingTab } from "./ui/settings/TaskMasterSettingTab";
import {
  BoardRepository, MeetingRepository, ProjectRepository,
  SettingsRepository, TaskRepository,
} from "./repositories";
import {
  BoardService, MeetingService, ProjectMemoService, ProjectService, TaskService,
} from "./services";
import { IndexService } from "./integration/IndexService";
import { createTaskMasterStore, type TaskMasterStore } from "./store/taskMasterStore";
import type { PluginSettings } from "./core/types";

/**
 * View와 React Provider가 사용하는 의존성 컨테이너.
 * 모든 service/store/event는 plugin lifetime에 한 번 생성되고 모든 leaf가 공유한다.
 */
export interface ServiceContainer {
  store: TaskMasterStore;
  taskService: TaskService;
  boardService: BoardService;
  projectService: ProjectService;
  projectMemoService: ProjectMemoService;
  meetingService: MeetingService;
  events: EventBus;
  diagnostics: DiagnosticsLog;
  settings: PluginSettings;
  saveSettings: (next: PluginSettings) => Promise<void>;
}

export default class TaskMasterPlugin extends Plugin {
  private container: ServiceContainer | null = null;
  private taskRepo: TaskRepository | null = null;
  private boardRepo: BoardRepository | null = null;
  private meetingRepo: MeetingRepository | null = null;

  override async onload(): Promise<void> {
    const settingsRepo = new SettingsRepository(this);
    const settings = await settingsRepo.load();
    initI18n(settings.locale);
    const dataRoot = settings.dataRootPath;

    const store = createTaskMasterStore();
    const events = new EventBus();
    const diagnostics = new DiagnosticsLog((entry) => {
      store.getState().recordDiagnostic(entry);
    });

    const taskRepo = new TaskRepository(
      this.app, diagnostics, settings.saveDebounceMs,
      `${dataRoot}/Tasks`, `${dataRoot}/Archive`,
    );
    const boardRepo = new BoardRepository(
      this.app, diagnostics, `${dataRoot}/.board.json`, settings.saveDebounceMs,
    );
    const meetingRepo = new MeetingRepository(
      this.app, diagnostics, `${dataRoot}/Meetings`,
    );
    const projectRepo = new ProjectRepository(
      this.app, diagnostics, `${dataRoot}/Projects`,
    );

    const boardService = new BoardService(boardRepo, store, events);
    const taskService = new TaskService(taskRepo, boardService, store, events);
    const projectService = new ProjectService(projectRepo, store);
    const projectMemoService = new ProjectMemoService(projectRepo, store);
    const meetingService = new MeetingService(meetingRepo, store);

    const indexService = new IndexService(
      this.app, this, store,
      taskRepo, boardRepo, boardService,
      meetingRepo, projectRepo,
      diagnostics, dataRoot,
    );

    this.taskRepo = taskRepo;
    this.boardRepo = boardRepo;
    this.meetingRepo = meetingRepo;

    this.container = {
      store, taskService, boardService, projectService, projectMemoService, meetingService,
      events, diagnostics, settings,
      saveSettings: async (next) => {
        Object.assign(settings, next);
        await settingsRepo.save(settings);
        store.getState().bumpSettingsRevision();
      },
    };

    try {
      await indexService.bootstrap();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.record({
        kind: "boot",
        message: "bootstrap failed; loading TaskMaster shell",
        cause: message,
      });
      console.error("TaskMaster bootstrap failed", err);
      new Notice(`TaskMaster boot failed: ${message}`);
    }

    // T-402: View 등록
    this.registerView(
      VIEW_TYPE_TASKMASTER,
      (leaf) => new TaskMasterView(leaf, this.container!),
    );

    // T-405: ribbon + command
    this.addRibbonIcon("layout-dashboard", "Open TaskMaster", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-taskmaster",
      name: "Open TaskMaster",
      callback: () => void this.activateView(),
    });

    // T-604: Settings tab 등록
    this.addSettingTab(new TaskMasterSettingTab(this.app, this, this.container));
  }

  /**
   * T-406, ADR-0004: onunload는 sync. promise를 기다리지 않는다.
   * 의미 데이터는 평소 saveImmediate로 즉시 flush되므로 손실 risk 없음.
   * 여기서는 reorder debounce 잔여만 fire-and-forget으로 flush한다.
   */
  override onunload(): void {
    void this.taskRepo?.flush();
    void this.boardRepo?.flush();
    void this.meetingRepo?.flush();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASKMASTER);
  }

  /**
   * PRD §7.1: 이미 열린 view가 있으면 reveal, 없으면 새로 만든다.
   */
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_TASKMASTER);
    let leaf = existing[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return;
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_TASKMASTER, active: true });
    }
    workspace.revealLeaf(leaf);
  }
}
