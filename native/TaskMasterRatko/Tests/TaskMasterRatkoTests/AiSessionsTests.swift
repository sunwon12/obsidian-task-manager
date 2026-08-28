import Foundation
import XCTest
@testable import TaskMasterRatko

final class AiSessionsTests: XCTestCase {
    func testProcessDiscoveryKeepsInteractiveClientsAndSeparatesAutomation() {
        let output = """
         100 1 ttys001 claude --resume abc
         101 1 ?? claude -p /nightly
         102 1 ttys002 node /opt/homebrew/bin/codex
         103 102 ttys002 /vendor/bin/codex --dangerously-bypass-approvals-and-sandbox
         104 103 ttys002 /vendor/bin/codex-code-mode-host
         105 1 ?? /usr/bin/python /Users/me/.claude/bridge.py
        """

        let processes = AiSessionScanner.parseProcesses(output)

        XCTAssertEqual(processes.map(\.pid), [100, 101, 103])
        XCTAssertEqual(processes[0].kind, .interactive)
        XCTAssertEqual(processes[1].kind, .automation)
        XCTAssertEqual(processes[2].provider, .codex)
    }

    func testClaudeSeparatesExecutionFromHumanWaitingAndClassifiesPhases() throws {
        let toolBlock: [String: Any] = ["type": "tool_use", "name": "apply_patch", "input": [String: Any]()]
        let firstText: [String: Any] = ["type": "text", "text": "구현을 마쳤습니다."]
        let secondText: [String: Any] = ["type": "text", "text": "테스트도 통과했습니다."]
        let records: [[String: Any]] = [
            ["type": "user", "sessionId": "s1", "timestamp": "2026-08-28T00:00:00.000Z", "message": ["content": "구현해줘"]],
            ["type": "assistant", "timestamp": "2026-08-28T00:01:00.000Z", "message": ["content": [toolBlock]]],
            ["type": "assistant", "timestamp": "2026-08-28T00:02:00.000Z", "message": ["content": [firstText]]],
            ["type": "user", "timestamp": "2026-08-28T00:05:00.000Z", "message": ["content": "테스트해줘"]],
            ["type": "assistant", "timestamp": "2026-08-28T00:06:00.000Z", "message": ["content": [secondText]]],
        ]
        let data = try jsonl(records)
        let now = ISO8601DateFormatter().date(from: "2026-08-28T00:10:00Z")!

        let facts = try XCTUnwrap(AiSessionScanner.parseClaude(data: data, now: now))

        XCTAssertEqual(facts.activity, .waitingForHuman)
        XCTAssertEqual(facts.aiMilliseconds, 180_000, accuracy: 1)
        XCTAssertEqual(facts.waitingMilliseconds, 420_000, accuracy: 1)
        XCTAssertEqual(facts.summary, "테스트도 통과했습니다.")
        XCTAssertTrue(facts.phases.contains { $0.name == "구현" })
    }

    func testCodexUsesReportedTurnDurationAndLeavesOpenTurnRunning() throws {
        let data = try jsonl([
            ["timestamp": "2026-08-28T00:00:00.000Z", "type": "session_meta", "payload": ["id": "c1", "source": "cli"]],
            ["timestamp": "2026-08-28T00:00:00.000Z", "type": "event_msg", "payload": ["type": "task_started", "started_at": 1_787_875_200]],
            ["timestamp": "2026-08-28T00:01:00.000Z", "type": "response_item", "payload": ["type": "function_call", "name": "apply_patch", "arguments": "{}"]],
            ["timestamp": "2026-08-28T00:02:00.000Z", "type": "event_msg", "payload": ["type": "task_complete", "completed_at": 1_787_875_320, "duration_ms": 120_000, "last_agent_message": "1차 구현 완료"]],
            ["timestamp": "2026-08-28T00:03:00.000Z", "type": "event_msg", "payload": ["type": "task_started", "started_at": 1_787_875_380]],
            ["timestamp": "2026-08-28T00:03:20.000Z", "type": "response_item", "payload": ["type": "function_call", "name": "swift test", "arguments": "{}"]],
        ])
        let now = Date(timeIntervalSince1970: 1_787_875_440)

        let facts = try XCTUnwrap(AiSessionScanner.parseCodex(data: data, now: now))

        XCTAssertEqual(facts.activity, .running)
        XCTAssertEqual(facts.aiMilliseconds, 180_000, accuracy: 1)
        XCTAssertEqual(facts.waitingMilliseconds, 60_000, accuracy: 1)
        XCTAssertTrue(facts.phases.contains { $0.name == "구현" })
        XCTAssertTrue(facts.phases.contains { $0.name == "테스트" })
    }

    func testOnlyHumanOwnedTaskStepsContributeHumanTime() {
        let task = TaskCard(
            id: "task_1",
            title: "BDCC-1234 구현",
            status: .doing,
            url: URL(fileURLWithPath: "/tmp/task.md"),
            steps: ["[인간] 설계", "[AI] 구현", "[인간] 검증"],
            currentStep: 3,
            stepSeconds: [60, 120, 0],
            actualMd: nil,
            due: nil,
            updatedAt: "",
            body: ""
        )
        let now = Date(timeIntervalSince1970: 100)
        let timer = TimerRecord(
            taskId: task.id,
            phase: .running,
            stepAccumulatedMs: [60_000, 120_000, 30_000],
            activeStep: 3,
            stepRunningSince: 90_000
        )

        XCTAssertEqual(AiSessionScanner.humanMilliseconds(task: task, timer: timer, now: now), 100_000, accuracy: 1)
    }

    func testTaskLinkUsesAnyJiraKeyFoundInSessionContext() {
        let first = task(id: "one", title: "AAAA-1 과거 작업")
        let second = task(id: "two", title: "BDCC-1234 초대장 API")

        let linked = AiSessionScanner.linkTask(
            cwd: "/work/AAAA-999-branch",
            summary: "BDCC-1234 구현 중",
            tasks: [first, second]
        )

        XCTAssertEqual(linked?.id, "two")
    }

    func testTaskLinkPrefersPersistedSessionKeyWithoutJiraKey() {
        var linkedTask = task(id: "linked", title: "로컬 작업")
        linkedTask.aiSessionKey = "codex:cwd:/work/no-ticket-branch"

        let linked = AiSessionScanner.linkTask(
            cwd: "/work/no-ticket-branch",
            summary: "조사 중",
            sessionKey: "codex:session-123",
            alternateSessionKeys: ["codex:cwd:/work/no-ticket-branch"],
            tasks: [linkedTask]
        )

        XCTAssertEqual(linked?.id, "linked")
    }

    func testAutoTaskDraftCarriesJiraIdentityAndMovesWaitingSessionToHumanStep() throws {
        let report = AiSessionReport(
            id: "Codex-100",
            provider: .codex,
            kind: .interactive,
            activity: .waitingForHuman,
            pid: 100,
            tty: "ttys001",
            cwd: "/work/29cm-community-BDCC-1263-add-admin-invitation-apis",
            sessionKey: "codex:session-1263",
            transcriptPath: "/tmp/session.jsonl",
            summary: "Step 1 승인 내용을 ADR로 남겼습니다.",
            aiMilliseconds: 60_000,
            waitingMilliseconds: 120_000,
            phases: [],
            taskId: nil,
            taskTitle: nil,
            humanMilliseconds: 0,
            lastActivity: nil
        )

        let draft = try XCTUnwrap(AiSessionTaskDraft.make(from: report))

        XCTAssertEqual(draft.jiraKey, "BDCC-1263")
        XCTAssertTrue(draft.title.hasPrefix("BDCC-1263 "))
        XCTAssertEqual(draft.steps, ["[AI] 진행", "[인간] 검증"])
        XCTAssertEqual(draft.currentStep, 2)
        XCTAssertNil(draft.bodyDetails, "Jira 동기화가 설명을 백필할 수 있게 비워 둔다")
    }

    func testAutoTaskDraftCanCaptureProtectedClaudeSessionByCwd() throws {
        let report = AiSessionReport(
            id: "Claude-100",
            provider: .claude,
            kind: .interactive,
            activity: .unknown,
            pid: 100,
            tty: "ttys001",
            cwd: "/work/project",
            sessionKey: "claude:cwd:/work/project",
            transcriptPath: nil,
            summary: "Claude 로그 폴더가 아직 연결되지 않았습니다.",
            aiMilliseconds: 0,
            waitingMilliseconds: 0,
            phases: [],
            taskId: nil,
            taskTitle: nil,
            humanMilliseconds: 0,
            lastActivity: nil
        )

        let draft = try XCTUnwrap(AiSessionTaskDraft.make(from: report))

        XCTAssertEqual(draft.title, "project — Claude 세션 작업")
        XCTAssertEqual(draft.sessionKey, "claude:cwd:/work/project")
    }

    private func task(id: String, title: String) -> TaskCard {
        TaskCard(
            id: id,
            title: title,
            status: .doing,
            url: URL(fileURLWithPath: "/tmp/\(id).md"),
            steps: [],
            currentStep: nil,
            stepSeconds: [],
            actualMd: nil,
            due: nil,
            updatedAt: "",
            body: ""
        )
    }

    private func jsonl(_ objects: [[String: Any]]) throws -> Data {
        let lines = try objects.map { object in
            String(data: try JSONSerialization.data(withJSONObject: object), encoding: .utf8)!
        }
        return Data(lines.joined(separator: "\n").utf8)
    }
}
