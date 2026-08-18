import { describe, it, expect } from "vitest";
import { JiraRepository, type JiraHttpPost, type JiraHttpResponse } from "../../src/repositories/JiraRepository";
import type { PluginSettings } from "../../src/core/types";

function settings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    jiraApiUrl: "https://example.atlassian.net",
    jiraApiToken: "tok",
    jiraEmail: "me@example.com",
    jiraAuthType: "basic",
    jiraApiVersion: "3",
    jiraJql: "project = BDCC",
    jiraEstimateMdFieldId: "",
    jiraActualMdFieldId: "",
    ...overrides,
  } as unknown as PluginSettings;
}

function fakePost(response: JiraHttpResponse) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const post: JiraHttpPost = async (url, headers, body) => {
    calls.push({ url, headers, body });
    return response;
  };
  return { post, calls };
}

const OK_BODY = JSON.stringify({
  issues: [
    { key: "BDCC-1", fields: { summary: "제목", status: { name: "In Progress" } } },
    { key: "", fields: { summary: "키 없음", status: { name: "Done" } } }, // 무효 → 걸러짐
  ],
});

const RICH_BODY = JSON.stringify({
  issues: [
    {
      key: "BDCC-9",
      fields: {
        summary: "견적 자산",
        status: { name: "In Progress" },
        duedate: "2026-08-09",
        customfield_12766: 3.0,
        customfield_12767: null,
        description: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: "본문입니다" }] }],
        },
      },
    },
  ],
});

describe("JiraRepository (Node https 직접 전송)", () => {
  // 배경(2026-08-08): 옵시디언 requestUrl 은 Electron 세션 쿠키를 실어 보내
  // Atlassian 이 XSRF 403 을 냈다. 쿠키 없는 전송이 이 클래스의 존재 이유다.

  it("v3: /rest/api/3/search/jql 로 Basic 인증 POST 한다", async () => {
    const { post, calls } = fakePost({ status: 200, text: OK_BODY });
    const issues = await new JiraRepository(post).search(settings());
    expect(calls[0]!.url).toBe("https://example.atlassian.net/rest/api/3/search/jql");
    expect(calls[0]!.headers["Authorization"]).toBe(`Basic ${btoa("me@example.com:tok")}`);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ jql: "project = BDCC", maxResults: 100 });
    expect(issues).toEqual([{
      key: "BDCC-1", summary: "제목", statusName: "In Progress", statusCategoryKey: "", hierarchyLevel: 0,
      description: "", estimateMd: null, actualMd: null, dueDate: null,
    }]);
  });

  it("MD 필드 id 가 설정되면 요청 fields 에 넣고 값·본문·마감일을 매핑한다", async () => {
    // 견적 회고 자산의 핵심: Estimate MD / Actual MD / description / duedate.
    const { post, calls } = fakePost({ status: 200, text: RICH_BODY });
    const issues = await new JiraRepository(post).search(settings({
      jiraEstimateMdFieldId: "customfield_12766",
      jiraActualMdFieldId: "customfield_12767",
    } as Partial<PluginSettings>));
    expect(JSON.parse(calls[0]!.body).fields).toEqual([
      "summary", "status", "description", "duedate", "issuetype", "customfield_12766", "customfield_12767",
    ]);
    expect(issues[0]).toEqual({
      key: "BDCC-9", summary: "견적 자산", statusName: "In Progress", statusCategoryKey: "", hierarchyLevel: 0,
      description: "본문입니다", estimateMd: 3, actualMd: null, dueDate: "2026-08-09",
    });
  });

  it("MD 필드 id 미설정이면 커스텀 필드를 요청하지 않는다", async () => {
    const { post, calls } = fakePost({ status: 200, text: OK_BODY });
    await new JiraRepository(post).search(settings());
    expect(JSON.parse(calls[0]!.body).fields).toEqual(["summary", "status", "description", "duedate", "issuetype"]);
  });

  it("v2: /rest/api/2/search 로 보낸다", async () => {
    const { post, calls } = fakePost({ status: 200, text: OK_BODY });
    await new JiraRepository(post).search(settings({ jiraApiVersion: "2" } as Partial<PluginSettings>));
    expect(calls[0]!.url).toBe("https://example.atlassian.net/rest/api/2/search");
  });

  it("PAT(bearer) 인증이면 Bearer 헤더를 쓴다", async () => {
    const { post, calls } = fakePost({ status: 200, text: OK_BODY });
    await new JiraRepository(post).search(settings({ jiraAuthType: "bearer" } as Partial<PluginSettings>));
    expect(calls[0]!.headers["Authorization"]).toBe("Bearer tok");
  });

  it("2xx 가 아니면 상태코드 + 응답 앞부분을 담아 throw 한다", async () => {
    const { post } = fakePost({ status: 403, text: "XSRF check failed ..." });
    await expect(new JiraRepository(post).search(settings())).rejects.toThrow(
      /Jira request failed \(403\): XSRF check failed/u,
    );
  });

  it("URL·토큰이 비면 전송 없이 throw 한다", async () => {
    const { post, calls } = fakePost({ status: 200, text: OK_BODY });
    await expect(
      new JiraRepository(post).search(settings({ jiraApiToken: "  " } as Partial<PluginSettings>)),
    ).rejects.toThrow(/required/u);
    expect(calls).toHaveLength(0);
  });
});
