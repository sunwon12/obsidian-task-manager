import { request as httpsRequest } from "https";
import { adfToMarkdown } from "../core/adf";
import type { PluginSettings } from "../core/types";

export interface JiraIssue {
  key: string;
  summary: string;
  statusName: string;
  /**
   * status.statusCategory.key — "new" | "indeterminate" | "done".
   * 표시명(statusName)은 Jira UI 언어를 따라가지만(한국어 계정은 "완료") 이 키는
   * 언어와 무관하다. 완료 판정은 이쪽을 먼저 본다.
   */
  statusCategoryKey: string;
  /**
   * issuetype.hierarchyLevel — 하위작업 -1, 일반 0, 에픽 1, 그 위 2+.
   * 유형 표시명("Epic"/"에픽")은 Jira UI 언어를 타지만 이 값은 타지 않는다.
   */
  hierarchyLevel: number;
  /** 이슈 본문(ADF → Markdown 변환). 없으면 "". */
  description: string;
  /** 견적 MD (설정에 필드 id 없으면 null). */
  estimateMd: number | null;
  /** 실제 MD (설정에 필드 id 없으면 null). */
  actualMd: number | null;
  /** 마감일 YYYY-MM-DD. */
  dueDate: string | null;
}

interface JiraSearchResponse {
  issues?: Array<{ key?: unknown; fields?: Record<string, unknown> }>;
}

export interface JiraHttpResponse {
  status: number;
  text: string;
}

export type JiraHttpPost = (
  url: string,
  headers: Record<string, string>,
  body: string,
) => Promise<JiraHttpResponse>;

/**
 * 기본 전송자: Node https 직접 호출.
 *
 * 옵시디언 requestUrl 은 Electron 세션 쿠키를 함께 실어 보내 Atlassian 이
 * 브라우저 세션으로 오인, Basic 인증이 유효해도 XSRF 403 을 낸다.
 * `X-Atlassian-Token: no-check` 헤더로도 막히지 않음을 실측했다(2026-08-08:
 * 같은 자격증명·JQL 의 쿠키 없는 CLI 재현은 200, requestUrl 은 403).
 * Node https 는 쿠키 저장소 자체가 없어 이 문제 계열이 원천 차단된다.
 */
export const nodeHttpsPost: JiraHttpPost = (url, headers, body) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": String(new TextEncoder().encode(body).length),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.setTimeout(20_000, () => req.destroy(new Error("Jira request timed out")));
    req.write(body);
    req.end();
  });

/** Jira REST boundary. Credentials are read only from device-local plugin settings. */
export class JiraRepository {
  constructor(private readonly post: JiraHttpPost = nodeHttpsPost) {}

  async search(settings: PluginSettings): Promise<JiraIssue[]> {
    return this.runJql(settings, settings.jiraJql.trim());
  }

  /**
   * 키로 직접 조회. 사용자 JQL이 완료 이슈를 제외하도록 짜여 있으면(기본값이 그렇다)
   * 티켓이 완료되는 순간 결과에서 빠져 로컬 카드가 영영 옛 상태로 남는다.
   * 동기화가 그 구멍을 닫을 때 쓴다.
   */
  async searchByKeys(settings: PluginSettings, keys: readonly string[]): Promise<JiraIssue[]> {
    const safe = keys.filter((key) => JIRA_KEY_RE.test(key));
    if (safe.length === 0) return [];
    return this.runJql(settings, `key in (${safe.join(",")})`);
  }

  private async runJql(settings: PluginSettings, jql: string): Promise<JiraIssue[]> {
    const apiUrl = settings.jiraApiUrl.trim().replace(/\/+$/u, "");
    const token = settings.jiraApiToken.trim();
    if (!apiUrl || !token) throw new Error("Jira API URL and API token are required");

    const endpoint = settings.jiraApiVersion === "3"
      ? `${apiUrl}/rest/api/3/search/jql`
      : `${apiUrl}/rest/api/2/search`;
    const authorization = settings.jiraAuthType === "basic"
      ? `Basic ${btoa(`${settings.jiraEmail.trim()}:${token}`)}`
      : `Bearer ${token}`;
    const estimateField = settings.jiraEstimateMdFieldId.trim();
    const actualField = settings.jiraActualMdFieldId.trim();
    const fields = ["summary", "status", "description", "duedate", "issuetype"];
    if (estimateField) fields.push(estimateField);
    if (actualField) fields.push(actualField);

    const response = await this.post(
      endpoint,
      {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      JSON.stringify({ jql, fields, maxResults: 100 }),
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Jira request failed (${response.status}): ${response.text.slice(0, 240)}`);
    }
    const payload = JSON.parse(response.text) as JiraSearchResponse;
    return (payload.issues ?? []).flatMap((issue) => {
      const f = issue.fields ?? {};
      const key = typeof issue.key === "string" ? issue.key.trim() : "";
      const summary = typeof f["summary"] === "string" ? f["summary"].trim() : "";
      const status = f["status"] as
        | { name?: unknown; statusCategory?: { key?: unknown } }
        | undefined;
      const statusName = typeof status?.name === "string" ? status.name.trim() : "";
      const categoryKey = typeof status?.statusCategory?.key === "string"
        ? status.statusCategory.key.trim().toLowerCase()
        : "";
      const issueType = f["issuetype"] as { hierarchyLevel?: unknown } | undefined;
      // 값이 없으면 0(일반)으로 본다 — 판단이 안 서면 거르지 않고 보여주는 쪽이 안전하다.
      const hierarchyLevel = asFiniteNumber(issueType?.hierarchyLevel) ?? 0;
      if (!key || !summary) return [];
      return [{
        key,
        summary,
        statusName,
        statusCategoryKey: categoryKey,
        hierarchyLevel,
        description: adfToMarkdown(f["description"]),
        estimateMd: estimateField ? asFiniteNumber(f[estimateField]) : null,
        actualMd: actualField ? asFiniteNumber(f[actualField]) : null,
        dueDate: typeof f["duedate"] === "string" && f["duedate"] ? f["duedate"] : null,
      }];
    });
  }
}

const JIRA_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/u;

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
