import AppKit
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

    func testRenamingStepPreservesSelectionAndElapsedSeconds() throws {
        let task = try fixture()
        var steps = task.steps
        steps[1] = "수정한 구현 단계"

        let updated = try repository.updateTask(task, steps: steps)

        XCTAssertEqual(updated.steps, ["조사", "수정한 구현 단계"])
        XCTAssertEqual(updated.currentStep, 2)
        XCTAssertEqual(updated.stepSeconds, [10, 0])
    }

    func testStopConversionRoundsToHundredthAndKeepsMinimum() {
        XCTAssertEqual(elapsedMd(0), 0)
        XCTAssertEqual(elapsedMd(2 * 60 * 1_000), 0.01)
        XCTAssertEqual(elapsedMd(4 * 60 * 60 * 1_000), 0.5)
        XCTAssertEqual(formattedElapsed(3_661_000), "1:01:01")
    }

    func testPanelHeightClampsToUsableScreenAndKeepsUserSize() {
        XCTAssertEqual(RatkoPanelSizing.clamp(620, visibleScreenHeight: 900), 620)
        XCTAssertEqual(RatkoPanelSizing.clamp(200, visibleScreenHeight: 900), 360)
        XCTAssertEqual(RatkoPanelSizing.clamp(1_000, visibleScreenHeight: 900), 884)
        XCTAssertEqual(RatkoPanelSizing.maximumHeight(visibleScreenHeight: 300), 360)
    }

    func testTaskDragAutoScrollUsesEdgesAndStopsInCenter() {
        XCTAssertEqual(
            RatkoDragAutoScroll.velocity(pointerY: 300, viewportMinY: 100, viewportMaxY: 500),
            0
        )
        XCTAssertLessThan(
            RatkoDragAutoScroll.velocity(pointerY: 490, viewportMinY: 100, viewportMaxY: 500),
            0
        )
        XCTAssertGreaterThan(
            RatkoDragAutoScroll.velocity(pointerY: 110, viewportMinY: 100, viewportMaxY: 500),
            0
        )
        XCTAssertGreaterThan(
            abs(RatkoDragAutoScroll.velocity(pointerY: 101, viewportMinY: 100, viewportMaxY: 500)),
            abs(RatkoDragAutoScroll.velocity(pointerY: 140, viewportMinY: 100, viewportMaxY: 500))
        )
    }

    func testTaskDragAutoScrollClampsAtDocumentBounds() {
        XCTAssertEqual(
            RatkoDragAutoScroll.nextOffset(current: 4, velocity: -10, minimum: 0, maximum: 300),
            0
        )
        XCTAssertEqual(
            RatkoDragAutoScroll.nextOffset(current: 296, velocity: 10, minimum: 0, maximum: 300),
            300
        )
        XCTAssertEqual(
            RatkoDragAutoScroll.nextOffset(current: 120, velocity: 7, minimum: 0, maximum: 300),
            127
        )
    }

    @MainActor
    func testTaskDragFindsLargestScrollViewContainingPanelContent() {
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 400, height: 600))
        let window = NSWindow(
            contentRect: root.frame,
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        window.contentView = root
        let taskScrollView = NSScrollView(frame: NSRect(x: 0, y: 60, width: 400, height: 480))
        let nestedEditor = NSScrollView(frame: NSRect(x: 100, y: 200, width: 180, height: 80))
        root.addSubview(taskScrollView)
        root.addSubview(nestedEditor)

        let resolved = RatkoScrollViewLookup.largestContaining(
            pointInWindow: NSPoint(x: 150, y: 230),
            root: root
        )

        XCTAssertTrue(resolved === taskScrollView)
    }

    @MainActor
    func testTaskDragReleaseMonitorDoesNotClearWhileWaitingForMouseUp() {
        let monitor = RatkoDragReleaseMonitor()
        var released = false
        monitor.start { released = true }

        RunLoop.main.run(until: Date().addingTimeInterval(0.08))
        XCTAssertFalse(released)
        XCTAssertTrue(monitor.isMonitoring)
        monitor.stop()
    }

    func testCreatesPluginCompatibleTaskIdAndMarkdown() throws {
        let task = try repository.createTask(title: "새 작업")
        XCTAssertNotNil(task.id.range(of: "^task_[0-9A-HJKMNP-TV-Z]{26}$", options: .regularExpression))
        XCTAssertEqual(task.status, .todo)
        XCTAssertEqual(task.title, "새 작업")
    }

    func testRatkoOrderMovesWithinAndAcrossLists() {
        var order = RatkoTaskOrder(
            focusTaskIds: ["focus-a", "focus-b"],
            nextTaskIds: ["next-a", "next-b"]
        )

        order.move("focus-b", to: .focus, before: "focus-a")
        XCTAssertEqual(order.focusTaskIds, ["focus-b", "focus-a"])
        order.move("next-b", to: .focus, before: "focus-a")
        XCTAssertEqual(order.focusTaskIds, ["focus-b", "next-b", "focus-a"])
        XCTAssertEqual(order.nextTaskIds, ["next-a"])
    }

    func testRatkoOrderPersistsInBoardAndPreservesUnknownFields() throws {
        let doing = try fixture()
        let todo = try repository.createTask(title: "다음 작업")
        let board: [String: Any] = [
            "version": 1,
            "columns": [
                ["id": "todo", "title": "TODO", "taskIds": [todo.id]],
                ["id": "doing", "title": "DOING", "taskIds": [doing.id]],
            ],
            "updatedAt": "2026-08-27T00:00:00Z",
            "externalField": ["keep": true],
        ]
        let data = try JSONSerialization.data(withJSONObject: board)
        try data.write(to: repository.boardURL)

        let order = RatkoTaskOrder(focusTaskIds: [doing.id], nextTaskIds: [todo.id])
        try repository.saveRatkoTaskOrder(order, tasks: [doing, todo])

        XCTAssertEqual(try repository.loadRatkoTaskOrder(tasks: [doing, todo]), order)
        let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: repository.boardURL)) as? [String: Any]
        let external = saved?["externalField"] as? [String: Any]
        XCTAssertEqual(external?["keep"] as? Bool, true)
    }

    @MainActor
    func testDraggingAcrossListsChangesStatusAndTimer() throws {
        let doing = try fixture()
        let todo = try repository.createTask(title: "드래그할 작업")
        let store = RatkoStore(configuration: RatkoConfiguration(vaultPath: root.path))

        store.moveTask(todo.id, to: .focus, before: doing.id)

        XCTAssertEqual(store.focusTasks.first?.0.id, todo.id)
        XCTAssertEqual(try repository.parseTask(at: todo.url).status, .doing)
        XCTAssertEqual(store.timer(for: todo.id)?.phase, .running)

        store.start(doing.id)
        store.moveTask(doing.id, to: .next, before: nil)

        XCTAssertEqual(try repository.parseTask(at: doing.url).status, .todo)
        XCTAssertEqual(store.timer(for: doing.id)?.phase, .paused)
        XCTAssertTrue(store.nextTasks.contains { $0.id == doing.id })

        let parkedElapsed = store.timer(for: doing.id)?.accumulatedMs
        store.moveTask(doing.id, to: .focus, before: nil)
        XCTAssertEqual(store.timer(for: doing.id)?.phase, .running)
        XCTAssertEqual(store.timer(for: doing.id)?.accumulatedMs, parkedElapsed)
    }

    func testPinsMenuBarItemImmediatelyLeftOfWiFi() {
        let ratkoSuite = "ratko-placement-\(UUID().uuidString)"
        let controlCenterSuite = "ratko-control-center-\(UUID().uuidString)"
        let ratkoDefaults = UserDefaults(suiteName: ratkoSuite)!
        let controlCenterDefaults = UserDefaults(suiteName: controlCenterSuite)!
        defer {
            ratkoDefaults.removePersistentDomain(forName: ratkoSuite)
            controlCenterDefaults.removePersistentDomain(forName: controlCenterSuite)
        }
        controlCenterDefaults.set(243, forKey: MenuBarPlacement.wifiPositionKey)

        let position = MenuBarPlacement.pinNextToWiFi(
            ratkoDefaults: ratkoDefaults,
            controlCenterDefaults: controlCenterDefaults
        )

        XCTAssertEqual(position, 263)
        XCTAssertEqual(ratkoDefaults.integer(forKey: MenuBarPlacement.ratkoPositionKey), 263)
    }

    func testParsesLatestAiFeedbackSection() {
        let feedback = AiFeedbackParser.parse("""
        # 일일 일정 피드백

        ## 2026-08-27 (목)

        **스냅샷** — 오늘 작업은 세 장이다.

        - **첫 결론** — `TaskMaster`에 집중한다.
        - 일반 불릿도 보존한다.

        **오늘의 하이라이트** — 가장 중요한 한 장부터 끝낸다.

        ## 2026-08-26 (수)

        **스냅샷** — 어제 기록.
        """)

        XCTAssertEqual(feedback?.date, "2026-08-27")
        XCTAssertEqual(feedback?.weekday, "목")
        XCTAssertEqual(feedback?.snapshot, "오늘 작업은 세 장이다.")
        XCTAssertEqual(feedback?.bullets.first?.lead, "첫 결론")
        XCTAssertEqual(feedback?.bullets.first?.body, "TaskMaster에 집중한다.")
        XCTAssertEqual(feedback?.highlight, "가장 중요한 한 장부터 끝낸다.")
    }

    func testLegacyConfigurationUsesAiFeedbackDefaults() throws {
        let configuration = try JSONDecoder().decode(
            RatkoConfiguration.self,
            from: Data(#"{"vaultPath":"/tmp/vault","dataRoot":"TaskMaster"}"#.utf8)
        )

        XCTAssertEqual(configuration.aiFeedbackPathResolved, "02_일상/03_성찰/일일-일정-피드백.md")
        XCTAssertEqual(configuration.aiFeedbackPromptResolved, "/daily-schedule-feedback")
        XCTAssertEqual(configuration.aiFeedbackTimeoutMinutesResolved, 10)
        XCTAssertEqual(configuration.taskAiTimeoutMinutesResolved, 5)
    }

    func testTaskAiParsesClaudeEnvelopeAndProposedChanges() throws {
        let inner = #"{"reply":"짧은 국면으로 바꿨어요.","steps":["[인간] 설계","[AI] 구현","[인간] 검증"],"memo":"검증 기준 확인","body":null}"#
        let outer: [String: Any] = [
            "type": "result",
            "is_error": false,
            "result": inner,
        ]
        let data = try JSONSerialization.data(withJSONObject: outer)
        let proposal = try TaskAiResponseParser.parse(String(decoding: data, as: UTF8.self))

        XCTAssertEqual(proposal.steps, ["[인간] 설계", "[AI] 구현", "[인간] 검증"])
        XCTAssertEqual(proposal.memo, "검증 기준 확인")
        XCTAssertNil(proposal.body)
        XCTAssertTrue(proposal.hasChanges)
    }

    func testTaskAiRejectsStepWithoutHumanOrAiOwner() throws {
        XCTAssertThrowsError(try TaskAiResponseParser.parse(#"{"reply":"제안","steps":["상세 구현"],"memo":null,"body":null}"#)) {
            XCTAssertTrue($0.localizedDescription.contains("실행 주체"))
        }
    }

    func testTaskAiPromptCarriesTaskContextAndCoarseMeasurementRule() throws {
        let task = try fixture()
        let prompt = TaskAiPrompt.build(
            task: task,
            messages: [TaskAiMessage(role: .user, text: "단계를 짧게 바꿔줘")]
        )

        XCTAssertTrue(prompt.contains(task.id))
        XCTAssertTrue(prompt.contains("랏코 이관"))
        XCTAssertTrue(prompt.contains("[인간] 설계"))
        XCTAssertTrue(prompt.contains("세부 체크리스트나 작업 지시서가 아니다"))
        XCTAssertTrue(prompt.contains("파일은 직접 수정하지 않는다"))
        XCTAssertTrue(prompt.contains("사용자: 단계를 짧게 바꿔줘"))
    }

    func testTaskAiStepReplacementPreservesRenamedAndReorderedTiming() {
        let state = remapStepState(
            oldSteps: ["[AI] 조사", "[AI] 구현", "[인간] 검증"],
            newSteps: ["[AI] 구현", "[인간] 검증", "[인간] 판단"],
            oldMilliseconds: [5_000, 10_000, 20_000],
            currentStep: 2
        )

        XCTAssertEqual(state.milliseconds, [10_000, 20_000, 5_000])
        XCTAssertEqual(state.currentStep, 1)
    }

    @MainActor
    func testTaskAiAppliesThroughStorePreservingTimerAndRejectsStaleProposal() throws {
        let original = try fixture()
        let store = RatkoStore(configuration: RatkoConfiguration(vaultPath: root.path))
        let proposal = TaskAiProposal(
            reply: "짧게 바꿉니다.",
            steps: ["[AI] 조사", "[인간] 검증"],
            memo: nil,
            body: nil
        )

        XCTAssertNil(store.applyTaskAiProposal(
            taskId: original.id,
            proposal: proposal,
            expectedUpdatedAt: original.updatedAt
        ))
        let updated = try repository.parseTask(at: original.url)
        XCTAssertEqual(updated.steps, ["[AI] 조사", "[인간] 검증"])
        XCTAssertEqual(updated.stepSeconds, [10, 0])
        XCTAssertEqual(updated.currentStep, 2)

        let staleError = store.applyTaskAiProposal(
            taskId: original.id,
            proposal: proposal,
            expectedUpdatedAt: original.updatedAt
        )
        XCTAssertTrue(staleError?.contains("태스크가 바뀌었습니다") == true)
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
