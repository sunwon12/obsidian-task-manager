import Foundation
import XCTest
@testable import TaskMasterRatko

final class TaskMarkdownRepositoryTests: XCTestCase {
    private var root: URL!
    private var repository: TaskMarkdownRepository!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ratko-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("TaskMaster/Tasks"),
            withIntermediateDirectories: true
        )
        repository = TaskMarkdownRepository(vaultURL: root, dataRoot: "TaskMaster")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    func testParsesNumberedStepsAndExistingTimerContract() throws {
        let task = try fixture()
        XCTAssertEqual(task.title, "랏코 이관")
        XCTAssertEqual(task.status, .doing)
        XCTAssertEqual(task.steps, ["조사", "구현: Swift"])
        XCTAssertEqual(task.currentStep, 2)
        XCTAssertEqual(task.stepSeconds, [10, 0])

        let timer = TimerRecord(taskId: task.id, phase: .running, runningSince: 1_000)
        try repository.saveTimers([timer])
        let loaded = try repository.loadTimers()
        XCTAssertEqual(loaded.first?.taskId, task.id)
        XCTAssertEqual(loaded.first?.phase, .running)
    }

    func testStepMutationPreservesUnknownFrontmatterAndBody() throws {
        let task = try fixture()
        let updated = try repository.updateTask(
            task,
            steps: ["구현", "검증"],
            currentStep: .some(1),
            stepSeconds: [12, 0]
        )
        let raw = try String(contentsOf: task.url, encoding: .utf8)
        XCTAssertTrue(raw.contains("jiraKey: M29CE-1234"))
        XCTAssertTrue(raw.contains("본문은 보존된다"))
        XCTAssertTrue(raw.contains("step1: \"구현\""))
        XCTAssertTrue(raw.contains("step1Seconds: 12"))
        XCTAssertEqual(updated.steps, ["구현", "검증"])
        XCTAssertEqual(updated.currentStep, 1)
    }

    func testStopConversionRoundsToHundredthAndKeepsMinimum() {
        XCTAssertEqual(elapsedMd(0), 0)
        XCTAssertEqual(elapsedMd(2 * 60 * 1_000), 0.01)
        XCTAssertEqual(elapsedMd(4 * 60 * 60 * 1_000), 0.5)
        XCTAssertEqual(formattedElapsed(3_661_000), "1:01:01")
    }

    func testCreatesPluginCompatibleTaskIdAndMarkdown() throws {
        let task = try repository.createTask(title: "새 작업")
        XCTAssertNotNil(task.id.range(of: "^task_[0-9A-HJKMNP-TV-Z]{26}$", options: .regularExpression))
        XCTAssertEqual(task.status, .todo)
        XCTAssertEqual(task.title, "새 작업")
    }

    private func fixture() throws -> TaskCard {
        let url = repository.tasksURL.appendingPathComponent("fixture - task_01ABCDEF.md")
        let raw = """
        ---
        schemaVersion: 1
        id: task_01M10F5S24E35SWAYG4FMNMN0R
        type: task
        status: doing
        project: null
        priority: null
        jiraKey: M29CE-1234
        step1: 조사
        step1Seconds: 10
        step2: "구현: Swift"
        currentStep: 2
        createdAt: 2026-08-27T00:00:00Z
        updatedAt: 2026-08-27T01:00:00Z
        ---

        # 랏코 이관

        본문은 보존된다.
        """
        try raw.write(to: url, atomically: true, encoding: .utf8)
        return try repository.parseTask(at: url)
    }
}
