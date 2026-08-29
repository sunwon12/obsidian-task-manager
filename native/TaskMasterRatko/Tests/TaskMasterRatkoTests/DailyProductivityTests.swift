import Foundation
import XCTest
@testable import TaskMasterRatko

final class DailyProductivityTests: XCTestCase {
    func testHumanLedgerSplitsOneRunningSegmentAcrossLocalDays() throws {
        let root = try temporaryDirectory()
        let repository = DailyProductivityRepository(vaultURL: root, dataRoot: "TaskMaster")
        let calendar = utcCalendar()
        let firstStart = date("2026-08-28T23:50:00Z")
        let firstSync = date("2026-08-29T00:05:00Z")
        let pausedAt = date("2026-08-29T00:20:00Z")
        let task = humanTask()
        let running = TimerRecord(
            taskId: task.id,
            phase: .running,
            runningSince: firstStart.millisecondsSince1970,
            stepAccumulatedMs: [0],
            activeStep: 1,
            stepRunningSince: firstStart.millisecondsSince1970
        )

        try repository.synchronizeHumanTimers(tasks: [task], timers: [running], at: firstSync)
        var paused = running
        paused.phase = .paused
        paused.runningSince = nil
        paused.stepRunningSince = nil
        try repository.synchronizeHumanTimers(tasks: [task], timers: [paused], at: pausedAt)

        let archive = try DailyProductivityBatch.run(
            dates: [date("2026-08-28T00:00:00Z"), date("2026-08-29T00:00:00Z")],
            repository: repository,
            homeURL: root,
            authorizedClaudeProjects: [:],
            now: pausedAt,
            calendar: calendar
        )

        XCTAssertEqual(archive.days.first { $0.date == "2026-08-28" }?.humanMilliseconds, 10 * 60_000)
        XCTAssertEqual(archive.days.first { $0.date == "2026-08-29" }?.humanMilliseconds, 20 * 60_000)
    }

    func testCodexReportedDurationIsClippedAcrossDaysAndArchiveIsIdempotent() throws {
        let root = try temporaryDirectory()
        let repository = DailyProductivityRepository(vaultURL: root, dataRoot: "TaskMaster")
        let sessionDirectory = root.appendingPathComponent(".codex/sessions/2026/08/28", isDirectory: true)
        try FileManager.default.createDirectory(at: sessionDirectory, withIntermediateDirectories: true)
        let transcript = try jsonl([
            ["timestamp": "2026-08-28T23:59:00.000Z", "type": "session_meta", "payload": ["id": "cross-day", "source": "cli"]],
            ["timestamp": "2026-08-28T23:59:00.000Z", "type": "event_msg", "payload": ["type": "task_started", "started_at": "2026-08-28T23:59:00.000Z"]],
            ["timestamp": "2026-08-29T00:01:00.000Z", "type": "event_msg", "payload": ["type": "task_complete", "completed_at": "2026-08-29T00:01:00.000Z", "duration_ms": 120_000]],
        ])
        try transcript.write(to: sessionDirectory.appendingPathComponent("rollout.jsonl"), options: .atomic)
        let dates = [date("2026-08-28T00:00:00Z"), date("2026-08-29T00:00:00Z")]

        _ = try DailyProductivityBatch.run(
            dates: dates,
            repository: repository,
            homeURL: root,
            authorizedClaudeProjects: [:],
            now: date("2026-08-30T00:10:00Z"),
            calendar: utcCalendar()
        )
        let archive = try DailyProductivityBatch.run(
            dates: dates,
            repository: repository,
            homeURL: root,
            authorizedClaudeProjects: [:],
            now: date("2026-08-30T00:11:00Z"),
            calendar: utcCalendar()
        )

        XCTAssertEqual(archive.days.count, 2)
        XCTAssertEqual(
            try XCTUnwrap(archive.days.first { $0.date == "2026-08-28" }).interactiveAiMilliseconds,
            60_000,
            accuracy: 1
        )
        XCTAssertEqual(
            try XCTUnwrap(archive.days.first { $0.date == "2026-08-29" }).interactiveAiMilliseconds,
            60_000,
            accuracy: 1
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: repository.summaryURL.path))
    }

    func testClaudeSdkCliIsSeparatedAsAutomation() throws {
        let data = try jsonl([
            ["type": "user", "sessionId": "automation", "timestamp": "2026-08-28T00:00:00.000Z", "entrypoint": "sdk-cli", "isSidechain": false, "message": ["content": "daily"]],
            ["type": "assistant", "sessionId": "automation", "timestamp": "2026-08-28T00:01:00.000Z", "entrypoint": "sdk-cli", "isSidechain": false, "message": ["content": [["type": "text", "text": "done"]]]],
        ])

        let parsed = DailyProductivityBatch.parseClaude(data: data)

        XCTAssertEqual(parsed.kind, .automation)
        XCTAssertEqual(parsed.work, 60_000, accuracy: 1)
    }

    func testCodexExecIsSeparatedAsAutomation() throws {
        let data = try jsonl([
            ["timestamp": "2026-08-28T00:00:00.000Z", "type": "session_meta", "payload": ["id": "exec", "source": "exec", "originator": "codex_exec"]],
            ["timestamp": "2026-08-28T00:00:00.000Z", "type": "event_msg", "payload": ["type": "task_started", "started_at": "2026-08-28T00:00:00.000Z"]],
            ["timestamp": "2026-08-28T00:01:00.000Z", "type": "event_msg", "payload": ["type": "task_complete", "completed_at": "2026-08-28T00:01:00.000Z", "duration_ms": 60_000]],
        ])

        let parsed = DailyProductivityBatch.parseCodex(data: data)

        XCTAssertEqual(parsed.kind, .automation)
        XCTAssertEqual(parsed.work, 60_000, accuracy: 1)
    }

    func testDuplicateCodexTurnsAcrossRuntimeRootsAreCountedOnce() throws {
        let root = try temporaryDirectory()
        let repository = DailyProductivityRepository(vaultURL: root, dataRoot: "TaskMaster")
        let transcript = try jsonl([
            ["timestamp": "2026-08-28T00:00:00.000Z", "type": "session_meta", "payload": ["id": "shared", "source": "cli"]],
            ["timestamp": "2026-08-28T00:00:00.000Z", "type": "event_msg", "payload": ["type": "task_started", "started_at": "2026-08-28T00:00:00.000Z"]],
            ["timestamp": "2026-08-28T00:01:00.000Z", "type": "event_msg", "payload": ["type": "task_complete", "completed_at": "2026-08-28T00:01:00.000Z", "duration_ms": 60_000]],
        ])
        let roots = CodexLogLocations.sessionRoots(homeURL: root)
        for sessionRoot in roots {
            let directory = sessionRoot.appendingPathComponent("2026/08/28", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try transcript.write(to: directory.appendingPathComponent("rollout.jsonl"), options: .atomic)
        }

        let archive = try DailyProductivityBatch.run(
            dates: [date("2026-08-28T00:00:00Z")],
            repository: repository,
            homeURL: root,
            authorizedClaudeProjects: [:],
            now: date("2026-08-29T00:10:00Z"),
            calendar: utcCalendar()
        )

        XCTAssertEqual(try XCTUnwrap(archive.days.first).interactiveAiMilliseconds, 60_000, accuracy: 1)
    }

    func testDueDatesWaitForScheduleAndBackfillOnlyMissingDays() {
        let calendar = utcCalendar()
        let beforeSchedule = DailyProductivityBatch.dueDates(
            now: date("2026-08-29T00:05:00Z"),
            scheduleAt: "00:10",
            lookbackDays: 2,
            existingDates: [],
            calendar: calendar
        )
        let afterSchedule = DailyProductivityBatch.dueDates(
            now: date("2026-08-29T00:11:00Z"),
            scheduleAt: "00:10",
            lookbackDays: 2,
            existingDates: ["2026-08-27"],
            calendar: calendar
        )

        XCTAssertEqual(beforeSchedule.map { day($0, calendar: calendar) }, ["2026-08-26", "2026-08-27"])
        XCTAssertEqual(afterSchedule.map { day($0, calendar: calendar) }, ["2026-08-28"])
    }

    private func humanTask() -> TaskCard {
        TaskCard(
            id: "task_human",
            title: "설계 검증",
            status: .doing,
            url: URL(fileURLWithPath: "/tmp/task-human.md"),
            steps: ["[인간] 설계"],
            currentStep: 1,
            stepSeconds: [0],
            actualMd: nil,
            due: nil,
            updatedAt: "",
            body: ""
        )
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func utcCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private func date(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }

    private func day(_ date: Date, calendar: Calendar) -> String {
        let values = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", values.year!, values.month!, values.day!)
    }

    private func jsonl(_ objects: [[String: Any]]) throws -> Data {
        let lines = try objects.map { object in
            String(data: try JSONSerialization.data(withJSONObject: object), encoding: .utf8)!
        }
        return Data(lines.joined(separator: "\n").utf8)
    }
}
