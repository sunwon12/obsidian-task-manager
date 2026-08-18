import type { DiagnosticsLog } from "../core/diagnostics";
import type { PluginSettings } from "../core/types";
import type { JiraIssue, JiraRepository } from "../repositories/JiraRepository";
import type { TaskService } from "./TaskService";

export interface JiraSyncResult {
  created: number;
  updated: number;
  skipped: number;
  /** 디스크에 같은 jiraKey 파일이 있는데 인덱스에 없어 생성을 막은 건수. */
  blocked: number;
}

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
      // store가 아니라 디스크를 한 번 훑어 둔다. 깨진 파일은 인덱스에 못 올라오므로
      // store만 믿으면 같은 이슈로 파일을 또 만들게 된다 (2026-08-18 실사고).
      const onDisk = await this.tasks.jiraKeysOnDisk();
      const result: JiraSyncResult = { created: 0, updated: 0, skipped: 0, blocked: 0 };
      const apply = async (issue: JiraIssue): Promise<void> => {
        const outcome = await this.tasks.upsertJiraIssue(issue, onDisk);
        result[outcome.outcome] += 1;
        if (outcome.outcome === "blocked") {
          this.diagnostics.record({
            kind: "parse",
            path: outcome.path,
            message: `${outcome.jiraKey}: file exists but is not indexed; skipped creating a duplicate`,
          });
        }
      };

      const seen = new Set<string>();
      for (const issue of issues) {
        seen.add(issue.key);
        await apply(issue);
      }

      // 사용자 JQL은 보통 완료를 제외한다(기본값 `statusCategory != Done`). 그러면
      // 티켓이 완료되는 순간 결과에서 빠져 로컬 카드가 옛 상태로 굳는다. 결과에 없는
      // 로컬 jiraKey를 키로 다시 조회해 상태를 닫는다 — 여긴 갱신만, 생성은 없다.
      const missing = [...onDisk.keys()].filter((key) => !seen.has(key));
      for (const issue of await this.jira.searchByKeys(settings, missing)) {
        await apply(issue);
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.diagnostics.record({ kind: "sync", message: "Jira sync failed", cause: message });
      throw err;
    }
  }
}
