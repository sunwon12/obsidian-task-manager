import type { DiagnosticsLog } from "../core/diagnostics";
import type { PluginSettings } from "../core/types";
import type { JiraRepository } from "../repositories/JiraRepository";
import type { TaskService } from "./TaskService";

export interface JiraSyncResult { created: number; updated: number; skipped: number; }

export class JiraSyncService {
  private inFlight: Promise<JiraSyncResult> | null = null;

  constructor(
    private readonly jira: JiraRepository,
    private readonly tasks: TaskService,
    private readonly diagnostics: DiagnosticsLog,
  ) {}

  async sync(settings: PluginSettings): Promise<JiraSyncResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.syncNow(settings).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async syncNow(settings: PluginSettings): Promise<JiraSyncResult> {
    try {
      const issues = await this.jira.search(settings);
      const result: JiraSyncResult = { created: 0, updated: 0, skipped: 0 };
      for (const issue of issues) {
        const outcome = await this.tasks.upsertJiraIssue(issue);
        result[outcome] += 1;
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.diagnostics.record({ kind: "sync", message: "Jira sync failed", cause: message });
      throw err;
    }
  }
}
