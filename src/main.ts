// LLD §8.1: Plugin entrypoint.
// 책임:
// - Settings load
// - Repository / Service / Store 의존성 주입 그래프 구성
// - IndexService.bootstrap (Vault scan + event listener 등록)
// - View 등록 + ribbon icon + command palette
// - onunload sync flush (ADR-0004)

import { Notice, Plugin, TFile } from "obsidian";
import { TaskMasterView, VIEW_TYPE_TASKMASTER } from "./view/TaskMasterView";
import { mountTimerOverlay } from "./ui/timer/TimerNotificationStack";
import { mountTimerMenuBar } from "./ui/timer/TimerMenuBar";
import {
  createElectronFloatingWindowPort,
  TimerFloatingWindow,
} from "./ui/timer/TimerFloatingWindow";
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
  TaskTimerService, type PersistedTimer, type TimerPersistencePort,
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
  private timerService: TaskTimerService | null = null;
  private timerOverlayDispose: (() => void) | null = null;
  private timerMenuBarDispose: (() => void) | null = null;
  private timerFloatingWindow: TimerFloatingWindow | null = null;

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

    // T-901: DOING 타이머. 상태는 vault의 .timers.json에 저장해 재시작 후 복원한다.
    const timerService = new TaskTimerService(
      events, store, taskService,
      this.createTimerPersistence(`${dataRoot}/.timers.json`),
    );
    this.timerService = timerService;
    // 앱 자체 종료에서는 plugin onunload보다 먼저 checkpoint를 시작한다.
    if (typeof this.registerDomEvent === "function") {
      this.registerDomEvent(window, "beforeunload", () => {
        void timerService.flushForShutdown().catch((err: unknown) => {
          console.error("[TaskMaster] timer beforeunload checkpoint failed", err);
        });
      });
    }

    const indexService = new IndexService(
      this.app, this, store,
      taskRepo, boardRepo, boardService,
      meetingRepo, projectRepo,
      events,
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

    // bootstrap 은 여기서 바로 돌리지 않는다 — onload 시점엔 vault 인덱스가
    // 아직 덜 차서 폴더/파일 존재 판정이 틀리는 부팅 레이스가 실측으로 확인됨
    // (2026-08-08: ensureFolders "Folder already exists" → 보드 전체 공백).
    // 파일 끝의 onLayoutReady 블록에서 실행한다.

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

    // vault 로드 완료 후에만: ① bootstrap(전체 스캔) ② Jira 동기화 ③ 스프린트 아카이브.
    // Jira 동기화는 기존 태스크(store)와 대조해 중복 생성을 막으므로, 빈 store 위에서
    // 돌면 안 된다 — 반드시 bootstrap 완료 뒤 순서를 보장한다.
    this.app.workspace.onLayoutReady(() => {
      void (async () => {
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

        // T-901: bootstrap으로 store가 채워진 뒤에 타이머 복원 + 오버레이 mount.
        try {
          await timerService.init();
          this.timerFloatingWindow = new TimerFloatingWindow(
            timerService,
            createElectronFloatingWindowPort(),
          );
          this.timerOverlayDispose = mountTimerOverlay(timerService, this.timerFloatingWindow);
          // 배너와 병행하는 맥 메뉴바 표시. 미지원 환경이면 null (배너만 동작).
          this.timerMenuBarDispose = mountTimerMenuBar(timerService, this.timerFloatingWindow);
        } catch (err) {
          diagnostics.record({
            kind: "boot",
            message: "timer overlay init failed",
            cause: err instanceof Error ? err.message : String(err),
          });
        }

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
      })();
    });
  }

  /**
   * T-406, ADR-0004: onunload는 sync. promise를 기다리지 않는다.
   * 의미 데이터는 평소 saveImmediate로 즉시 flush되므로 손실 risk 없음.
   * 여기서는 reorder debounce 잔여만 fire-and-forget으로 flush한다.
   */
  override onunload(): void {
    const timerService = this.timerService;
    // plugin reload/disable에서도 UI teardown보다 타이머 checkpoint를 먼저 시작한다.
    void timerService?.flushForShutdown().catch((err: unknown) => {
      console.error("[TaskMaster] timer shutdown checkpoint failed", err);
    });
    this.timerFloatingWindow?.dispose();
    this.timerFloatingWindow = null;
    this.timerMenuBarDispose?.();
    this.timerMenuBarDispose = null;
    this.timerOverlayDispose?.();
    this.timerOverlayDispose = null;
    timerService?.dispose();
    this.timerService = null;
    void this.taskRepo?.flush();
    void this.boardRepo?.flush();
    void this.meetingRepo?.flush();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASKMASTER);
  }

  /** T-901: .timers.json 어댑터. 없으면 빈 상태, 파손이면 무시하고 새로 시작한다. */
  private createTimerPersistence(timersPath: string): TimerPersistencePort {
    return {
      load: async (): Promise<PersistedTimer[]> => {
        const file = this.app.vault.getAbstractFileByPath(timersPath);
        if (!(file instanceof TFile)) return [];
        try {
          const parsed = JSON.parse(await this.app.vault.read(file)) as {
            timers?: PersistedTimer[];
          };
          return Array.isArray(parsed?.timers) ? parsed.timers : [];
        } catch {
          return [];
        }
      },
      save: async (timers): Promise<void> => {
        const json = JSON.stringify({ version: 1, timers }, null, 2);
        const file = this.app.vault.getAbstractFileByPath(timersPath);
        if (file instanceof TFile) await this.app.vault.modify(file, json);
        else await this.app.vault.create(timersPath, json);
      },
    };
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
      const blocked = result.blocked > 0
        ? `, ${result.blocked} blocked (broken task file — see console)`
        : "";
      new Notice(
        `Jira synced: ${result.created} added, ${result.updated} updated${blocked}`,
        result.blocked > 0 ? 30_000 : undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Notice 는 몇 초 뒤 사라져 증거가 안 남는다. console.error 로도 남겨
      // 외부 계측(smart-split console 태핑)이 원문을 영구 기록하게 한다.
      console.error("TaskMaster Jira sync failed", err);
      new Notice(`Jira sync failed: ${message}`, 30_000);
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
