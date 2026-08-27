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
import { AiReportService } from "./services/AiReportService";
import { createNodeAiReportRunner } from "./integration/aiReportRunner";
import { AiDraftService } from "./services/AiDraftService";
import { createNodeAiDraftRunner } from "./integration/aiDraftRunner";
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
  aiReportService?: AiReportService;
  aiDraftService?: AiDraftService;
  events: EventBus;
  diagnostics: DiagnosticsLog;
  settings: PluginSettings;
  saveSettings: (next: PluginSettings) => Promise<void>;
}

export default class TaskMasterPlugin extends Plugin {
  private unloaded = false;
  private container: ServiceContainer | null = null;
  private taskRepo: TaskRepository | null = null;
  private boardRepo: BoardRepository | null = null;
  private meetingRepo: MeetingRepository | null = null;
  private aiReportService: AiReportService | null = null;

  override async onload(): Promise<void> {
    this.unloaded = false;
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

    // AI 리포트: `claude -p "<스킬>"` 를 헤드리스로 돌리고 스킬이 vault에 남긴 Markdown을 읽는다.
    // launchd 잡은 ~/Desktop 아래 스크립트를 TCC 때문에 실행하지 못해 조용히 죽었다.
    // Obsidian 안에서 돌리면 vault 권한을 그대로 쓰고, 실패가 패널에 그대로 보인다.
    const aiReportService = new AiReportService(
      createNodeAiReportRunner(),
      {
        read: async () => {
          const path = settings.aiReportPath.trim();
          if (!path) return null;
          if (!(await this.app.vault.adapter.exists(path))) return null;
          return this.app.vault.adapter.read(path);
        },
      },
      () => ({
        enabled: settings.aiReportEnabled,
        binary: settings.aiReportBinary.trim() || "claude",
        prompt: settings.aiReportPrompt.trim(),
        cwd: this.vaultBasePath(),
        timeoutMs: Math.max(1, settings.aiReportTimeoutMinutes) * 60_000,
        scheduleAt: settings.aiReportScheduleAt.trim(),
      }),
    );
    this.aiReportService = aiReportService;

    // AI 초안: 같은 CLI를 쓰되 파일을 쓰지 않고 JSON만 받는다. 적용은 UI가 고른
    // 필드만 TaskService를 태운다 — AI가 카드 .md를 직접 고치면 knownMtime
    // conflict detection과 부딪히고 passthrough/fieldOrder 보존이 깨진다 (ADR-0012).
    const aiDraftService = new AiDraftService(
      createNodeAiDraftRunner(),
      () => ({
        enabled: settings.aiDraftEnabled,
        binary: settings.aiReportBinary.trim() || "claude",
        cwd: this.vaultBasePath(),
        model: settings.aiDraftModel.trim(),
        timeoutMs: Math.max(1, settings.aiDraftTimeoutMinutes) * 60_000,
      }),
    );

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
      aiReportService,
      aiDraftService,
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
      id: "run-ai-report",
      name: "Run AI report now",
      callback: () => {
        new Notice("AI report started");
        void aiReportService.runNow().then((ok) => {
          new Notice(ok ? "AI report ready" : `AI report failed: ${aiReportService.getState().error ?? ""}`);
        });
      },
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
        if (this.unloaded) return;
        try {
          await indexService.bootstrap(() => !this.unloaded);
        } catch (err) {
          if (this.unloaded) return;
          const message = err instanceof Error ? err.message : String(err);
          diagnostics.record({
            kind: "boot",
            message: "bootstrap failed; loading TaskMaster shell",
            cause: message,
          });
          console.error("TaskMaster bootstrap failed", err);
          new Notice(`TaskMaster boot failed: ${message}`);
        }
        if (this.unloaded) return;

        if (settings.jiraApiUrl.trim() && settings.jiraApiToken.trim()) {
          void this.syncJira(jiraSyncService, settings);
          if (settings.jiraSyncIntervalMinutes > 0) {
            this.registerInterval(window.setInterval(() => {
              void this.syncJira(jiraSyncService, settings);
            }, settings.jiraSyncIntervalMinutes * 60_000));
          }
        }

        // 리포트는 파일이 정본이다. 먼저 읽어 두고, 예정 시각이 지났는데 오늘 것이
        // 없으면 하루 한 번만 실행한다. 5분 간격으로 재확인해 맥이 자다 깬 날도 따라잡는다.
        void aiReportService.refresh().then(() => aiReportService.runScheduledIfDue());
        const reportInterval = window.setInterval(() => {
          void aiReportService.runScheduledIfDue();
        }, 5 * 60_000);
        if (typeof this.registerInterval === "function") this.registerInterval(reportInterval);

        void this.archiveCompletedSprint(taskService, settings, settingsRepo);
        const interval = window.setInterval(() => {
          // 리포트는 파일이 정본이다. 먼저 읽어 두고, 예정 시각이 지났는데 오늘 것이
        // 없으면 하루 한 번만 실행한다. 5분 간격으로 재확인해 맥이 자다 깬 날도 따라잡는다.
        void aiReportService.refresh().then(() => aiReportService.runScheduledIfDue());
        const reportInterval = window.setInterval(() => {
          void aiReportService.runScheduledIfDue();
        }, 5 * 60_000);
        if (typeof this.registerInterval === "function") this.registerInterval(reportInterval);

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
    // onLayoutReady 안의 비동기 bootstrap이 뒤늦게 재개되지 않게 먼저 차단한다.
    // 메뉴바 랏코는 v0.19부터 별도 Swift 프로세스라 plugin lifecycle과 무관하다.
    this.unloaded = true;
    this.aiReportService = null;
    void this.taskRepo?.flush();
    void this.boardRepo?.flush();
    void this.meetingRepo?.flush();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASKMASTER);
  }

  /** claude를 실행할 작업 디렉터리 = vault 루트. 스킬이 상대 경로로 파일을 찾는다. */
  private vaultBasePath(): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : "";
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
