import { requestUrl } from "obsidian";
import type { PluginSettings } from "../core/types";

export interface JiraIssue {
  key: string;
  summary: string;
  statusName: string;
}

interface JiraSearchResponse {
  issues?: Array<{ key?: unknown; fields?: { summary?: unknown; status?: { name?: unknown } } }>;
}

/** Jira REST boundary. Credentials are read only from device-local plugin settings. */
export class JiraRepository {
  async search(settings: PluginSettings): Promise<JiraIssue[]> {
    const apiUrl = settings.jiraApiUrl.trim().replace(/\/+$/u, "");
    const token = settings.jiraApiToken.trim();
    if (!apiUrl || !token) throw new Error("Jira API URL and API token are required");

    const endpoint = settings.jiraApiVersion === "3"
      ? `${apiUrl}/rest/api/3/search/jql`
      : `${apiUrl}/rest/api/2/search`;
    const authorization = settings.jiraAuthType === "basic"
      ? `Basic ${btoa(`${settings.jiraEmail.trim()}:${token}`)}`
      : `Bearer ${token}`;
    const response = await requestUrl({
      url: endpoint,
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
        // Obsidian의 requestUrl은 Electron session에 남은 쿠키를 함께 보낼 수 있어,
        // Basic/Bearer 인증뿐이어도 Atlassian이 브라우저 세션으로 오인해 XSRF 403을 낼 수 있다.
        "X-Atlassian-Token": "no-check",
      },
      body: JSON.stringify({ jql: settings.jiraJql.trim(), fields: ["summary", "status"], maxResults: 100 }),
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Jira request failed (${response.status}): ${response.text.slice(0, 240)}`);
    }
    const payload = response.json as JiraSearchResponse;
    return (payload.issues ?? []).flatMap((issue) => {
      const key = typeof issue.key === "string" ? issue.key.trim() : "";
      const summary = typeof issue.fields?.summary === "string" ? issue.fields.summary.trim() : "";
      const statusName = typeof issue.fields?.status?.name === "string" ? issue.fields.status.name.trim() : "";
      return key && summary ? [{ key, summary, statusName }] : [];
    });
  }
}
