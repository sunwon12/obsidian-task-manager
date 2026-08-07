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
  SettingsRepository, TaskRepository, JiraRepository,
} from "./repositories";
import {
  BoardService, MeetingService, ProjectMemoService, ProjectService, TaskService, JiraSyncService,
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
  jiraSyncService?: JiraSyncService;
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
    const jiraSyncService = new JiraSyncService(new JiraRepository(), taskService, diagnostics);

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
      store, taskService, boardService, projectService, projectMemoService, meetingService, jiraSyncService,
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
    this.addCommand({
      id: "sync-jira-issues",
      name: "Sync Jira issues",
      callback: () => void this.syncJira(jiraSyncService, settings),
    });

    // T-604: Settings tab 등록
    this.addSettingTab(new TaskMasterSettingTab(this.app, this, this.container));

    if (settings.jiraApiUrl.trim() && settings.jiraApiToken.trim()) {
      void this.syncJira(jiraSyncService, settings);
      if (settings.jiraSyncIntervalMinutes > 0) {
        this.registerInterval(window.setInterval(() => {
          void this.syncJira(jiraSyncService, settings);
        }, settings.jiraSyncIntervalMinutes * 60_000));
      }
    }

    void this.archiveCompletedSprint(taskService, settings, settingsRepo);
    const interval = window.setInterval(() => {
      void this.archiveCompletedSprint(taskService, settings, settingsRepo);
    }, 60 * 60_000);
    if (typeof this.registerInterval === "function") this.registerInterval(interval);
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

  private async syncJira(service: JiraSyncService, settings: PluginSettings): Promise<void> {
    try {
      const result = await service.sync(settings);
      new Notice(`Jira synced: ${result.created} added, ${result.updated} updated`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Jira sync failed: ${message}`);
    }
  }

  private async archiveCompletedSprint(
    taskService: TaskService,
    settings: PluginSettings,
    settingsRepo: SettingsRepository,
  ): Promise<void> {
    if (!settings.autoArchiveDoneAtSprintEnd || !settings.sprintStartDate) return;
    const start = parseDate(settings.sprintStartDate);
    if (!start) return;
    const today = new Date();
    const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const elapsedDays = Math.floor((utcToday - start) / 86_400_000);
    const completedSprints = Math.floor(elapsedDays / settings.sprintLengthDays);
    if (completedSprints < 1) return;

    const boundary = new Date(start + completedSprints * settings.sprintLengthDays * 86_400_000)
      .toISOString().slice(0, 10);
    if (settings.lastArchivedSprintEnd >= boundary) return;

    const completed = [...this.container?.store.getState().tasks.values() ?? []]
      .filter((task) => task.status === "done" && task.archivedAt === null);
    for (const task of completed) await taskService.archiveTask(task.id);
    settings.lastArchivedSprintEnd = boundary;
    await settingsRepo.save(settings);
    if (completed.length > 0) new Notice(`Sprint closed: ${completed.length} DONE task(s) archived`);
  }
}

function parseDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? timestamp
    : null;
}
