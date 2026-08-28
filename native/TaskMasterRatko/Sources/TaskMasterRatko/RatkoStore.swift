import AppKit
import Combine
import Foundation

@MainActor
final class RatkoStore: ObservableObject {
    @Published private(set) var tasks: [TaskCard] = []
    @Published private(set) var timers: [TimerRecord] = []
    @Published private(set) var taskOrder: RatkoTaskOrder = .empty
    @Published private(set) var now = Date()
    @Published private(set) var aiFeedback: AiFeedback?
    @Published private(set) var aiFeedbackState: AiFeedbackRunState = .idle
    @Published private(set) var aiFeedbackStartedAt: Date?
    @Published private(set) var taskAiStepFillRequests: [String: UUID] = [:]
    @Published private(set) var aiSessionReports: [AiSessionReport] = []
    @Published private(set) var aiSessionScanState: AiSessionScanState = .idle
    @Published private(set) var aiSessionLastScannedAt: Date?
    @Published private(set) var aiSessionCreatedTaskCount = 0
    @Published var lastError: String?

    let configuration: RatkoConfiguration?
    private let repository: TaskMarkdownRepository?
    private var pollTimer: Timer?
    private var tickTimer: Timer?
    private var aiFeedbackModifiedAt: Date?

    init(configuration: RatkoConfiguration) {
        self.configuration = configuration
        self.repository = TaskMarkdownRepository(
            vaultURL: configuration.vaultURL,
            dataRoot: configuration.dataRoot
        )
        reloadAiFeedback(force: true)
        reload()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
        tickTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.now = Date() }
        }
    }

    init(error: Error) {
        configuration = nil
        repository = nil
        lastError = error.localizedDescription
    }

    deinit {
        pollTimer?.invalidate()
        tickTimer?.invalidate()
    }

    var focusTasks: [(TaskCard, TimerRecord)] {
        let taskById = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0) })
        let timerById = Dictionary(uniqueKeysWithValues: timers.map { ($0.taskId, $0) })
        let fallback = timers.sorted { $0.enteredDoingAt > $1.enteredDoingAt }.map(\.taskId)
        return uniqueTaskIds(taskOrder.focusTaskIds + fallback).compactMap { taskId in
            guard let task = taskById[taskId], task.status == .doing, let timer = timerById[taskId] else { return nil }
            return (task, timer)
        }
    }

    var nextTasks: [TaskCard] {
        let statusOrder: [TaskStatus: Int] = [.inReview: 0, .todo: 1, .hold: 2, .backlog: 3, .doing: 4, .done: 5]
        let candidates = tasks
            .filter { $0.status != .done && $0.status != .doing }
            .sorted {
                let left = statusOrder[$0.status] ?? 9
                let right = statusOrder[$1.status] ?? 9
                return left == right ? $0.updatedAt > $1.updatedAt : left < right
            }
        let byId = Dictionary(uniqueKeysWithValues: candidates.map { ($0.id, $0) })
        return uniqueTaskIds(taskOrder.nextTaskIds + candidates.map(\.id)).compactMap { byId[$0] }
    }

    var doneToday: Int {
        let calendar = Calendar.current
        return tasks.filter { task in
            guard task.status == .done, let date = ISO8601DateFormatter().date(from: task.updatedAt) else { return false }
            return calendar.isDate(date, inSameDayAs: now)
        }.count
    }

    var isAiFeedbackStale: Bool {
        guard let aiFeedback else { return true }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return aiFeedback.date != formatter.string(from: now)
    }

    var aiFeedbackRunningSeconds: Int {
        guard let aiFeedbackStartedAt else { return 0 }
        return max(0, Int(now.timeIntervalSince(aiFeedbackStartedAt)))
    }

    var interactiveAiSessionReports: [AiSessionReport] {
        aiSessionReports.filter { $0.kind == .interactive }
    }

    var automationAiSessionReports: [AiSessionReport] {
        aiSessionReports.filter { $0.kind != .interactive }
    }

    var runningAiSessionCount: Int {
        interactiveAiSessionReports.filter { $0.activity == .running }.count
    }

    var waitingAiSessionCount: Int {
        interactiveAiSessionReports.filter { $0.activity == .waitingForHuman }.count
    }

    func timer(for taskId: String) -> TimerRecord? {
        timers.first { $0.taskId == taskId }
    }

    func task(for taskId: String) -> TaskCard? {
        tasks.first { $0.id == taskId }
    }

    func requestTaskAiStepFill(_ taskId: String) {
        taskAiStepFillRequests[taskId] = UUID()
    }

    func elapsed(for timer: TimerRecord) -> Double {
        elapsedMilliseconds(for: timer, now: now.millisecondsSince1970)
    }

    func stepElapsed(for timer: TimerRecord, index: Int) -> Double {
        var value = timer.stepAccumulatedMs.indices.contains(index) ? timer.stepAccumulatedMs[index] : 0
        if timer.phase == .running,
           timer.activeStep == index + 1,
           let since = timer.stepRunningSince {
            value += max(0, now.millisecondsSince1970 - since)
        }
        return value
    }

    func reload() {
        guard let repository else { return }
        do {
            let diskTasks = try repository.loadTasks()
            var diskTimers = try repository.loadTimers()
            let diskOrder = try repository.loadRatkoTaskOrder(tasks: diskTasks)
            let active = Dictionary(uniqueKeysWithValues: diskTasks.filter { $0.status != .done }.map { ($0.id, $0) })
            let doing = active.filter { $0.value.status == .doing }
            let before = diskTimers
            diskTimers.removeAll { active[$0.taskId] == nil }
            for task in doing.values where !diskTimers.contains(where: { $0.taskId == task.id }) {
                diskTimers.append(TimerRecord(
                    taskId: task.id,
                    stepAccumulatedMs: task.stepSeconds.map { Double($0) * 1_000 },
                    activeStep: task.currentStep
                ))
            }
            for index in diskTimers.indices {
                guard let task = active[diskTimers[index].taskId] else { continue }
                diskTimers[index].stepAccumulatedMs = normalizedStepMilliseconds(
                    timer: diskTimers[index],
                    task: task
                )
                if task.status != .doing, diskTimers[index].phase == .running {
                    let timestamp = Date().millisecondsSince1970
                    let total = elapsedMilliseconds(for: diskTimers[index], now: timestamp)
                    Self.capture(timer: &diskTimers[index], at: timestamp)
                    diskTimers[index].accumulatedMs = total
                    diskTimers[index].runningSince = nil
                    diskTimers[index].phase = .paused
                } else if let current = task.currentStep, current != diskTimers[index].activeStep,
                   diskTimers[index].phase != .running {
                    diskTimers[index].activeStep = current
                }
            }
            if diskTimers != before { try repository.saveTimers(diskTimers) }
            if diskTasks != tasks { tasks = diskTasks }
            if diskTimers != timers { timers = diskTimers }
            if diskOrder != taskOrder { taskOrder = diskOrder }
            reloadAiFeedback()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func runAiFeedback() {
        guard let configuration, aiFeedbackState != .running else { return }
        aiFeedbackState = .running
        aiFeedbackStartedAt = Date()
        Task { [weak self] in
            let result = await AiFeedbackRunner.run(configuration: configuration)
            guard let self else { return }
            self.reloadAiFeedback(force: true)
            self.aiFeedbackStartedAt = nil
            self.aiFeedbackState = result.succeeded ? .idle : .error(result.message)
        }
    }

    func scanAiSessions() {
        aiSessionCreatedTaskCount = 0
        scanAiSessionsPass(autoCreateTasks: true)
    }

    private func scanAiSessionsPass(autoCreateTasks: Bool) {
        guard aiSessionScanState != .running else { return }
        aiSessionScanState = .running
        let taskSnapshot = tasks
        let timerSnapshot = timers
        let authorizedClaudeProjects = ClaudeLogAccess.authorizedProjectURLs
        RatkoUiTestDiagnostics.log(
            "claude-access main projects=\(authorizedClaudeProjects.count)"
        )
        Task { [weak self] in
            let result = await AiSessionScanner.scan(
                tasks: taskSnapshot,
                timers: timerSnapshot,
                authorizedClaudeProjects: authorizedClaudeProjects
            )
            guard let self else { return }
            switch result {
            case .success(let reports):
                if autoCreateTasks {
                    let creation = self.createMissingAiSessionTasks(from: reports)
                    if let error = creation.error { self.lastError = error }
                    if creation.created > 0 {
                        self.aiSessionCreatedTaskCount = creation.created
                        self.reload()
                        self.aiSessionScanState = .idle
                        self.scanAiSessionsPass(autoCreateTasks: false)
                        return
                    }
                }
                self.aiSessionReports = reports
                self.aiSessionLastScannedAt = Date()
                self.aiSessionScanState = .loaded
            case .failure(let error):
                self.aiSessionScanState = .error(error.localizedDescription)
            }
        }
    }

    private func createMissingAiSessionTasks(
        from reports: [AiSessionReport]
    ) -> (created: Int, error: String?) {
        guard let repository else { return (0, nil) }
        var identities = Set<String>()
        var created = 0
        var errors: [String] = []

        for draft in reports.compactMap(AiSessionTaskDraft.make) {
            let identity = draft.jiraKey?.lowercased() ?? draft.sessionKey
            guard identities.insert(identity).inserted else { continue }
            let alreadyExists = tasks.contains { task in
                if task.aiSessionKey == draft.sessionKey { return true }
                guard let jiraKey = draft.jiraKey, let taskJiraKey = task.jiraKey else { return false }
                return taskJiraKey.caseInsensitiveCompare(jiraKey) == .orderedSame
            }
            if alreadyExists { continue }
            do {
                _ = try repository.createTask(
                    title: draft.title,
                    status: draft.status,
                    jiraKey: draft.jiraKey,
                    aiSessionKey: draft.sessionKey,
                    steps: draft.steps,
                    currentStep: draft.currentStep,
                    bodyDetails: draft.bodyDetails
                )
                created += 1
            } catch {
                errors.append("\(draft.title): \(error.localizedDescription)")
            }
        }
        let message = errors.isEmpty ? nil : "AI 세션 태스크를 일부 생성하지 못했습니다. \(errors.joined(separator: " / "))"
        return (created, message)
    }

    func connectClaudeLogs() {
        do {
            let cwds = interactiveAiSessionReports
                .filter { $0.provider == .claude && $0.transcriptPath == nil }
                .map(\.cwd)
            RatkoUiTestDiagnostics.log("claude-connect cwds=\(cwds)")
            try ClaudeLogAccess.request(cwds: Array(Set(cwds)).sorted())
            lastError = nil
            scanAiSessions()
        } catch ClaudeLogAccessError.cancelled {
            RatkoUiTestDiagnostics.log("claude-connect cancelled")
            return
        } catch {
            RatkoUiTestDiagnostics.log("claude-connect error=\(error.localizedDescription)")
            lastError = error.localizedDescription
        }
    }

    func openAiFeedback() {
        guard let configuration else { return }
        var components = URLComponents()
        components.scheme = "obsidian"
        components.host = "open"
        components.queryItems = [
            URLQueryItem(name: "vault", value: configuration.vaultURL.lastPathComponent),
            URLQueryItem(name: "file", value: configuration.aiFeedbackPathResolved),
        ]
        if let url = components.url { NSWorkspace.shared.open(url) }
    }

    func start(_ taskId: String) {
        mutateTimer(taskId) { timer, task, timestamp in
            guard timer.phase != .running else { return }
            timer.phase = .running
            timer.runningSince = timestamp
            timer.activeStep = task.currentStep
            timer.stepRunningSince = task.currentStep == nil ? nil : timestamp
        }
    }

    func pause(_ taskId: String) {
        mutateTimer(taskId, saveSteps: true) { timer, _, timestamp in
            guard timer.phase == .running else { return }
            Self.capture(timer: &timer, at: timestamp)
            timer.accumulatedMs = elapsedMilliseconds(for: timer, now: timestamp)
            timer.runningSince = nil
            timer.phase = .paused
        }
    }

    func stop(_ taskId: String) {
        guard let repository,
              let task = tasks.first(where: { $0.id == taskId }),
              var timer = timers.first(where: { $0.taskId == taskId })
        else { return }
        do {
            let timestamp = Date().millisecondsSince1970
            let total = elapsedMilliseconds(for: timer, now: timestamp)
            if timer.phase == .running { Self.capture(timer: &timer, at: timestamp) }
            let seconds = stepSeconds(timer, count: task.steps.count, now: timestamp)
            let actual = (((task.actualMd ?? 0) + elapsedMd(total)) * 100).rounded() / 100
            _ = try repository.updateTask(
                task,
                status: .done,
                stepSeconds: seconds,
                actualMd: actual
            )
            timers.removeAll { $0.taskId == taskId }
            try repository.saveTimers(timers)
            reload()
        } catch { lastError = error.localizedDescription }
    }

    func selectStep(taskId: String, step: Int) {
        guard let repository,
              let task = tasks.first(where: { $0.id == taskId }),
              task.steps.indices.contains(step - 1),
              let index = timers.firstIndex(where: { $0.taskId == taskId })
        else { return }
        do {
            let timestamp = Date().millisecondsSince1970
            if timers[index].phase == .running { Self.capture(timer: &timers[index], at: timestamp) }
            timers[index].activeStep = step
            timers[index].stepRunningSince = timers[index].phase == .running ? timestamp : nil
            let seconds = stepSeconds(timers[index], count: task.steps.count, now: timestamp)
            _ = try repository.updateTask(task, currentStep: .some(step), stepSeconds: seconds)
            try repository.saveTimers(timers)
            reload()
        } catch { lastError = error.localizedDescription }
    }

    func addStep(taskId: String, value: String) {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, let repository,
              let task = tasks.first(where: { $0.id == taskId })
        else { return }
        do {
            var steps = task.steps
            steps.append(String(value.prefix(240)))
            var seconds = task.stepSeconds
            seconds.append(0)
            _ = try repository.updateTask(
                task,
                steps: steps,
                currentStep: .some(task.currentStep ?? 1),
                stepSeconds: seconds
            )
            reload()
        } catch { lastError = error.localizedDescription }
    }

    func renameStep(taskId: String, index: Int, value: String) {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, let repository,
              let task = tasks.first(where: { $0.id == taskId }),
              task.steps.indices.contains(index)
        else { return }
        do {
            var steps = task.steps
            steps[index] = String(value.prefix(240))
            _ = try repository.updateTask(task, steps: steps)
            reload()
        } catch { lastError = error.localizedDescription }
    }

    func moveStep(taskId: String, from: Int, offset: Int) {
        guard let repository,
              let task = tasks.first(where: { $0.id == taskId }),
              task.steps.indices.contains(from),
              task.steps.indices.contains(from + offset)
        else { return }
        do {
            var steps = task.steps
            var seconds = task.stepSeconds
            let target = from + offset
            steps.swapAt(from, target)
            if seconds.count == steps.count { seconds.swapAt(from, target) }
            var current = task.currentStep
            if current == from + 1 { current = target + 1 }
            else if current == target + 1 { current = from + 1 }
            _ = try repository.updateTask(task, steps: steps, currentStep: .some(current), stepSeconds: seconds)
            if let timerIndex = timers.firstIndex(where: { $0.taskId == taskId }) {
                while timers[timerIndex].stepAccumulatedMs.count < steps.count { timers[timerIndex].stepAccumulatedMs.append(0) }
                timers[timerIndex].stepAccumulatedMs.swapAt(from, target)
                timers[timerIndex].activeStep = current
                try repository.saveTimers(timers)
            }
            reload()
        } catch { lastError = error.localizedDescription }
    }

    func park(_ taskId: String) {
        moveTask(taskId, to: .next, before: nil)
    }

    func focus(_ taskId: String) {
        moveTask(taskId, to: .focus, before: nil)
    }

    func moveTask(_ taskId: String, to list: RatkoTaskList, before beforeTaskId: String?) {
        guard taskId != beforeTaskId,
              let repository,
              let task = tasks.first(where: { $0.id == taskId }),
              task.status != .done
        else { return }
        do {
            var updatedTasks = tasks
            var updatedTimers = timers
            var updatedOrder = taskOrder
            let movingToFocus = list == .focus

            if movingToFocus, task.status != .doing {
                let updatedTask = try repository.updateTask(task, status: .doing)
                if let index = updatedTasks.firstIndex(where: { $0.id == taskId }) { updatedTasks[index] = updatedTask }
                var timer = updatedTimers.first(where: { $0.taskId == taskId }) ?? TimerRecord(
                    taskId: taskId,
                    stepAccumulatedMs: task.stepSeconds.map { Double($0) * 1_000 },
                    activeStep: task.currentStep
                )
                let timestamp = Date().millisecondsSince1970
                timer.phase = .running
                timer.runningSince = timestamp
                timer.stepRunningSince = timer.activeStep == nil ? nil : timestamp
                updatedTimers.removeAll { $0.taskId == taskId }
                updatedTimers.append(timer)
            } else if !movingToFocus, task.status == .doing {
                let timestamp = Date().millisecondsSince1970
                var seconds = task.stepSeconds
                var pausedTimer = updatedTimers.first(where: { $0.taskId == taskId })
                if var timer = pausedTimer {
                    if timer.phase == .running {
                        let total = elapsedMilliseconds(for: timer, now: timestamp)
                        Self.capture(timer: &timer, at: timestamp)
                        timer.accumulatedMs = total
                        timer.runningSince = nil
                        timer.phase = .paused
                    }
                    seconds = stepSeconds(timer, count: task.steps.count, now: timestamp)
                    pausedTimer = timer
                }
                let updatedTask = try repository.updateTask(task, status: .todo, stepSeconds: seconds)
                if let index = updatedTasks.firstIndex(where: { $0.id == taskId }) { updatedTasks[index] = updatedTask }
                updatedTimers.removeAll { $0.taskId == taskId }
                if let pausedTimer { updatedTimers.append(pausedTimer) }
            }

            updatedOrder.move(taskId, to: list, before: beforeTaskId)
            try repository.saveTimers(updatedTimers)
            try repository.saveRatkoTaskOrder(updatedOrder, tasks: updatedTasks)
            tasks = updatedTasks
            timers = updatedTimers
            taskOrder = updatedOrder
            lastError = nil
            reload()
        } catch {
            lastError = "순서를 바꾸지 못했습니다: \(error.localizedDescription)"
            reload()
        }
    }

    func createTask(title: String) {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let repository else { return }
        do {
            _ = try repository.createTask(title: String(title.prefix(240)))
            reload()
        } catch { lastError = error.localizedDescription }
    }

    func appendMemo(taskId: String, text: String) {
        guard let repository, let task = tasks.first(where: { $0.id == taskId }) else { return }
        do {
            _ = try repository.appendMemo(to: task, text: text)
            reload()
        } catch { lastError = error.localizedDescription }
    }

    /// AI는 JSON 제안만 만들고, 최신 파일 확인과 타이머 보존을 포함한 실제 적용은 랏코가 맡는다.
    /// nil이면 성공, 문자열이면 적용하지 않은 사유다.
    func applyTaskAiProposal(
        taskId: String,
        proposal: TaskAiProposal,
        expectedUpdatedAt: String
    ) -> String? {
        guard let repository, var task = tasks.first(where: { $0.id == taskId }) else {
            return "태스크를 찾지 못했습니다."
        }
        guard task.updatedAt == expectedUpdatedAt else {
            return "AI가 답하는 동안 태스크가 바뀌었습니다. 최신 내용으로 다시 요청해 주세요."
        }
        if let body = proposal.body,
           !body.split(separator: "\n", omittingEmptySubsequences: false).contains(where: { $0.hasPrefix("# ") }) {
            return "본문 변경안에 태스크 제목이 없어 적용하지 않았습니다."
        }

        do {
            if let newSteps = proposal.steps {
                let timestamp = Date().millisecondsSince1970
                var oldMilliseconds = task.stepSeconds.map { Double($0) * 1_000 }
                let timerIndex = timers.firstIndex(where: { $0.taskId == taskId })
                if let index = timerIndex {
                    if timers[index].phase == .running { Self.capture(timer: &timers[index], at: timestamp) }
                    oldMilliseconds = normalizedStepMilliseconds(timer: timers[index], task: task)
                }
                let remapped = remapStepState(
                    oldSteps: task.steps,
                    newSteps: newSteps,
                    oldMilliseconds: oldMilliseconds,
                    currentStep: task.currentStep
                )
                let seconds = remapped.milliseconds.map { $0 <= 0 ? 0 : max(1, Int(($0 / 1_000).rounded())) }
                task = try repository.updateTask(
                    task,
                    steps: newSteps,
                    currentStep: .some(remapped.currentStep),
                    stepSeconds: seconds
                )
                if let index = timerIndex {
                    timers[index].stepAccumulatedMs = remapped.milliseconds
                    timers[index].activeStep = remapped.currentStep
                    timers[index].stepRunningSince = timers[index].phase == .running && remapped.currentStep != nil
                        ? timestamp
                        : nil
                    try repository.saveTimers(timers)
                }
            }
            if let body = proposal.body { task = try repository.updateTask(task, body: body) }
            if let memo = proposal.memo { task = try repository.appendMemo(to: task, text: memo) }
            lastError = nil
            reload()
            return nil
        } catch {
            lastError = error.localizedDescription
            return error.localizedDescription
        }
    }

    func openTask(_ task: TaskCard) {
        guard let configuration else { return }
        var components = URLComponents()
        components.scheme = "obsidian"
        components.host = "open"
        components.queryItems = [
            URLQueryItem(name: "vault", value: configuration.vaultURL.lastPathComponent),
            URLQueryItem(name: "file", value: relativePath(of: task.url)),
        ]
        if let url = components.url { NSWorkspace.shared.open(url) }
    }

    func openBoard() {
        guard configuration != nil else { return }
        NSWorkspace.shared.openApplication(
            at: URL(fileURLWithPath: "/Applications/Obsidian.app"),
            configuration: NSWorkspace.OpenConfiguration()
        )
    }

    private func relativePath(of url: URL) -> String {
        guard let configuration else { return url.path }
        return String(url.standardizedFileURL.path.dropFirst(configuration.vaultURL.path.count + 1))
    }

    private func mutateTimer(
        _ taskId: String,
        saveSteps: Bool = false,
        mutation: (inout TimerRecord, TaskCard, Double) -> Void
    ) {
        guard let repository,
              let task = tasks.first(where: { $0.id == taskId }),
              let index = timers.firstIndex(where: { $0.taskId == taskId })
        else { return }
        do {
            mutation(&timers[index], task, Date().millisecondsSince1970)
            try repository.saveTimers(timers)
            if saveSteps {
                let seconds = stepSeconds(timers[index], count: task.steps.count)
                _ = try repository.updateTask(task, stepSeconds: seconds)
            }
            reload()
        } catch { lastError = error.localizedDescription }
    }

    private func normalizedStepMilliseconds(timer: TimerRecord, task: TaskCard) -> [Double] {
        (0..<task.steps.count).map { index in
            max(
                timer.stepAccumulatedMs.indices.contains(index) ? timer.stepAccumulatedMs[index] : 0,
                task.stepSeconds.indices.contains(index) ? Double(task.stepSeconds[index]) * 1_000 : 0
            )
        }
    }

    private func reloadAiFeedback(force: Bool = false) {
        guard let configuration else { return }
        let url = configuration.aiFeedbackURL
        guard FileManager.default.fileExists(atPath: url.path) else {
            aiFeedback = nil
            aiFeedbackModifiedAt = nil
            return
        }
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            let modifiedAt = attributes[.modificationDate] as? Date
            if !force, modifiedAt == aiFeedbackModifiedAt { return }
            aiFeedback = AiFeedbackParser.parse(try String(contentsOf: url, encoding: .utf8))
            aiFeedbackModifiedAt = modifiedAt
        } catch {
            if aiFeedbackState != .running { aiFeedbackState = .error(error.localizedDescription) }
        }
    }

    private func stepSeconds(_ timer: TimerRecord, count: Int, now: Double = Date().millisecondsSince1970) -> [Int] {
        var values = Array(timer.stepAccumulatedMs.prefix(count))
        while values.count < count { values.append(0) }
        if timer.phase == .running, let step = timer.activeStep, values.indices.contains(step - 1), let since = timer.stepRunningSince {
            values[step - 1] += max(0, now - since)
        }
        return values.map { $0 <= 0 ? 0 : max(1, Int(($0 / 1_000).rounded())) }
    }

    private static func capture(timer: inout TimerRecord, at timestamp: Double) {
        if let step = timer.activeStep, let since = timer.stepRunningSince {
            while timer.stepAccumulatedMs.count < step { timer.stepAccumulatedMs.append(0) }
            timer.stepAccumulatedMs[step - 1] += max(0, timestamp - since)
        }
        timer.stepRunningSince = nil
    }

    private func uniqueTaskIds(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        return ids.filter { seen.insert($0).inserted }
    }
}
