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
        XCTAssertEqual(draft.status, .todo)
        XCTAssertEqual(draft.steps, ["[AI] 진행", "[인간] 검증"])
        XCTAssertEqual(draft.currentStep, 2)
        XCTAssertNil(draft.bodyDetails, "Jira 동기화가 설명을 백필할 수 있게 비워 둔다")
    }

    func testAutoTaskDraftCreatesRunningSessionInDoing() throws {
        let report = notificationReport(
            activity: .running,
            at: Date(timeIntervalSince1970: 100),
            taskId: nil
        )

        let draft = try XCTUnwrap(AiSessionTaskDraft.make(from: report))

        XCTAssertEqual(draft.status, .doing)
        XCTAssertEqual(draft.currentStep, 1)
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
        XCTAssertEqual(draft.status, .todo, "실행 여부를 확정할 수 없으면 TODO로 둔다")
    }

    func testWaitingTrackerSuppressesBaselineAndNotifiesOnlyNewCompletion() {
        var tracker = AiSessionWaitingTracker()
        let firstCompletion = Date(timeIntervalSince1970: 100)
        let secondCompletion = Date(timeIntervalSince1970: 200)

        XCTAssertTrue(tracker.ingest([notificationReport(activity: .waitingForHuman, at: firstCompletion)]).isEmpty)
        XCTAssertTrue(tracker.ingest([notificationReport(activity: .waitingForHuman, at: firstCompletion)]).isEmpty)
        XCTAssertEqual(
            tracker.ingest([notificationReport(activity: .waitingForHuman, at: secondCompletion)]).map(\.sessionKey),
            ["codex:notification-test"]
        )
    }

    func testWaitingTrackerNotifiesWhenRunningSessionBecomesWaiting() {
        var tracker = AiSessionWaitingTracker()
        _ = tracker.ingest([notificationReport(activity: .running, at: Date(timeIntervalSince1970: 100))])

        let transitioned = tracker.ingest([
            notificationReport(activity: .waitingForHuman, at: Date(timeIntervalSince1970: 110)),
        ])

        XCTAssertEqual(transitioned.count, 1)
    }

    func testWaitingTrackerDoesNotRepeatAfterTemporarySessionAbsence() {
        var tracker = AiSessionWaitingTracker()
        let completion = Date(timeIntervalSince1970: 100)
        _ = tracker.ingest([notificationReport(activity: .waitingForHuman, at: completion)])
        _ = tracker.ingest([])

        XCTAssertTrue(tracker.ingest([
            notificationReport(activity: .waitingForHuman, at: completion),
            notificationReport(activity: .waitingForHuman, at: completion),
        ]).isEmpty)
    }

    func testOrcaTerminalMatcherUsesUniqueWorktree() {
        let report = notificationReport(activity: .waitingForHuman, at: Date(timeIntervalSince1970: 100))

        XCTAssertEqual(
            OrcaTerminalMatcher.match(report: report, terminals: [orcaTerminal(handle: "term_unique")]),
            .matched("term_unique")
        )
    }

    func testOrcaTerminalMatcherPrefersExactSessionId() {
        let report = notificationReport(activity: .waitingForHuman, at: Date(timeIntervalSince1970: 100))
        let terminals = [
            orcaTerminal(handle: "term_other", preview: "another session"),
            orcaTerminal(handle: "term_exact", preview: "resume codex:notification-test"),
        ]

        XCTAssertEqual(
            OrcaTerminalMatcher.match(report: report, terminals: terminals),
            .matched("term_exact")
        )
    }

    func testOrcaTerminalMatcherUsesSummaryThenActivityTime() {
        let report = notificationReport(activity: .waitingForHuman, at: Date(timeIntervalSince1970: 100))
        let summaryMatch = orcaTerminal(
            handle: "term_summary",
            preview: "확인해 주세요. 알림 테스트 결과입니다.",
            lastOutputAt: 10_000
        )
        let timeMatch = orcaTerminal(handle: "term_time", lastOutputAt: 100_000)

        XCTAssertEqual(
            OrcaTerminalMatcher.match(report: report, terminals: [timeMatch, summaryMatch]),
            .matched("term_summary")
        )

        let noSummaryReport = notificationReport(
            activity: .waitingForHuman,
            at: Date(timeIntervalSince1970: 200),
            summary: "서로 겹치지 않는 문장"
        )
        XCTAssertEqual(
            OrcaTerminalMatcher.match(
                report: noSummaryReport,
                terminals: [
                    orcaTerminal(handle: "term_old", lastOutputAt: 100_000),
                    orcaTerminal(handle: "term_recent", lastOutputAt: 200_000),
                ]
            ),
            .matched("term_recent")
        )
    }

    func testOrcaTerminalMatcherRefusesAmbiguousOrMissingTerminal() {
        let report = notificationReport(activity: .waitingForHuman, at: Date(timeIntervalSince1970: 100))
        let duplicate = orcaTerminal(handle: "term_one", lastOutputAt: 90_000)
        let duplicateTwo = orcaTerminal(handle: "term_two", lastOutputAt: 90_000)

        XCTAssertEqual(
            OrcaTerminalMatcher.match(report: report, terminals: [duplicate, duplicateTwo]),
            .ambiguous
        )
        XCTAssertEqual(
            OrcaTerminalMatcher.match(
                report: report,
                terminals: [orcaTerminal(handle: "term_elsewhere", path: "/work/elsewhere")]
            ),
            .missing
        )
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

    private func notificationReport(
        activity: AiSessionActivity,
        at date: Date,
        summary: String = "확인해 주세요.",
        taskId: String? = "task_notification"
    ) -> AiSessionReport {
        AiSessionReport(
            id: "Codex-200",
            provider: .codex,
            kind: .interactive,
            activity: activity,
            pid: 200,
            tty: "ttys002",
            cwd: "/work/notification-test",
            sessionKey: "codex:notification-test",
            transcriptPath: "/tmp/notification-test.jsonl",
            summary: summary,
            aiMilliseconds: 10_000,
            waitingMilliseconds: 0,
            phases: [],
            taskId: taskId,
            taskTitle: taskId == nil ? nil : "알림 테스트",
            humanMilliseconds: 0,
            lastActivity: date
        )
    }

    private func orcaTerminal(
        handle: String,
        path: String = "/work/notification-test",
        title: String = "terminal",
        preview: String = "",
        lastOutputAt: Double? = nil
    ) -> OrcaTerminalRecord {
        OrcaTerminalRecord(
            handle: handle,
            worktreePath: path,
            title: title,
            connected: true,
            lastOutputAt: lastOutputAt,
            preview: preview
        )
    }

    private func jsonl(_ objects: [[String: Any]]) throws -> Data {
        let lines = try objects.map { object in
            String(data: try JSONSerialization.data(withJSONObject: object), encoding: .utf8)!
        }
        return Data(lines.joined(separator: "\n").utf8)
    }
}
