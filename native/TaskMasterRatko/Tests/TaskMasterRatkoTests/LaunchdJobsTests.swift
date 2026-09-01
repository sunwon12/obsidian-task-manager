import Foundation
import XCTest
@testable import TaskMasterRatko

final class LaunchdJobsTests: XCTestCase {
    func testRuntimeParserReadsRunningJob() {
        let runtime = LaunchdRuntimeParser.parse(
            """
            gui/503/com.example.worker = {
                state = running
                runs = 12
                pid = 4321
                last exit code = 1
            }
            """,
            loaded: true
        )

        XCTAssertEqual(runtime.state, "running")
        XCTAssertEqual(runtime.pid, 4321)
        XCTAssertEqual(runtime.runCount, 12)
        XCTAssertEqual(runtime.lastExitCode, 1)
    }

    func testRunningStateWinsOverPreviousNonzeroExit() {
        let job = job(keepAlive: true, loaded: true, state: "running", lastExitCode: 143)

        XCTAssertEqual(job.health, .running)
    }

    func testKeepAliveSpawnScheduleIsRetryingAfterFailure() {
        let job = job(keepAlive: true, loaded: true, state: "spawn scheduled", lastExitCode: 1)

        XCTAssertEqual(job.health, .retrying)
    }

    func testCalendarJobNotRunningWithoutFailureIsWaiting() {
        let job = job(keepAlive: false, loaded: true, state: "not running", lastExitCode: nil)

        XCTAssertEqual(job.health, .waiting)
    }

    func testPlistWithoutLoadedRuntimeIsUnloaded() {
        let job = job(keepAlive: false, loaded: false, state: nil, lastExitCode: nil)

        XCTAssertEqual(job.health, .unloaded)
    }

    func testScheduleDescriptionsDistinguishPersistentIntervalAndCalendarJobs() {
        XCTAssertEqual(
            LaunchdInspector.scheduleDescription(["KeepAlive": true, "RunAtLoad": true]),
            "상시 유지"
        )
        XCTAssertEqual(
            LaunchdInspector.scheduleDescription(["StartInterval": 1_200]),
            "매 20분"
        )
        XCTAssertEqual(
            LaunchdInspector.scheduleDescription([
                "StartCalendarInterval": ["Weekday": 1, "Hour": 9, "Minute": 5],
            ]),
            "매주 월 09:05"
        )
    }

    func testKnownJobsUseKoreanPurposeNamesWithoutChangingTechnicalLabels() {
        let cookieProxy = job(
            label: "com.sunwon.cookie-proxy.confluence",
            keepAlive: true,
            loaded: true,
            state: "running",
            lastExitCode: nil
        )
        let daily = job(
            label: "com.biz-e-cnc.team-ticket-daily",
            keepAlive: false,
            loaded: true,
            state: "not running",
            lastExitCode: nil
        )

        XCTAssertEqual(cookieProxy.displayName, "Confluence 쿠키 프록시")
        XCTAssertEqual(cookieProxy.label, "com.sunwon.cookie-proxy.confluence")
        XCTAssertEqual(daily.displayName, "CNC 팀 티켓 일일 점검")
    }

    func testUnknownJobFallsBackToReadableWords() {
        XCTAssertEqual(LaunchdJobNaming.displayName(for: "com.example.daily-report"), "example 일일 보고서")
    }

    private func job(
        label: String = "com.example.worker",
        keepAlive: Bool,
        loaded: Bool,
        state: String?,
        lastExitCode: Int?
    ) -> LaunchdJob {
        LaunchdJob(
            label: label,
            plistURL: URL(fileURLWithPath: "/tmp/com.example.worker.plist"),
            command: "/tmp/worker",
            schedule: keepAlive ? "상시 유지" : "매일 09:00",
            standardOutPath: nil,
            standardErrorPath: nil,
            keepAlive: keepAlive,
            loaded: loaded,
            state: state,
            pid: nil,
            runCount: nil,
            lastExitCode: lastExitCode,
            lastTerminatingSignal: nil
        )
    }
}
