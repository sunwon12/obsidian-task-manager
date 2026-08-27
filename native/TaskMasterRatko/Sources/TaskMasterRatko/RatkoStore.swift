import AppKit
import Combine
import Foundation

@MainActor
final class RatkoStore: ObservableObject {
    @Published private(set) var tasks: [TaskCard] = []
    @Published private(set) var timers: [TimerRecord] = []
    @Published private(set) var now = Date()
    @Published var lastError: String?

    let configuration: RatkoConfiguration?
    private let repository: TaskMarkdownRepository?
    private var pollTimer: Timer?
    private var tickTimer: Timer?

    init(configuration: RatkoConfiguration) {
        self.configuration = configuration
        self.repository = TaskMarkdownRepository(
            vaultURL: configuration.vaultURL,
            dataRoot: configuration.dataRoot
        )
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
        return timers
            .sorted { $0.enteredDoingAt > $1.enteredDoingAt }
            .compactMap { timer in taskById[timer.taskId].map { ($0, timer) } }
    }

    var nextTasks: [TaskCard] {
        let active = Set(timers.map(\.taskId))
        let order: [TaskStatus: Int] = [.inReview: 0, .todo: 1, .hold: 2, .backlog: 3, .doing: 4, .done: 5]
        return tasks
            .filter { $0.status != .done && !active.contains($0.id) }
            .sorted {
                let left = order[$0.status] ?? 9
                let right = order[$1.status] ?? 9
                return left == right ? $0.updatedAt > $1.updatedAt : left < right
            }
            .prefix(6)
            .map { $0 }
    }

    var doneToday: Int {
        let calendar = Calendar.current
        return tasks.filter { task in
            guard task.status == .done, let date = ISO8601DateFormatter().date(from: task.updatedAt) else { return false }
            return calendar.isDate(date, inSameDayAs: now)
        }.count
    }

    func timer(for taskId: String) -> TimerRecord? {
        timers.first { $0.taskId == taskId }
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
            let doing = Dictionary(uniqueKeysWithValues: diskTasks.filter { $0.status == .doing }.map { ($0.id, $0) })
            let before = diskTimers
            diskTimers.removeAll { doing[$0.taskId] == nil }
            for task in doing.values where !diskTimers.contains(where: { $0.taskId == task.id }) {
                diskTimers.append(TimerRecord(
                    taskId: task.id,
                    stepAccumulatedMs: task.stepSeconds.map { Double($0) * 1_000 },
                    activeStep: task.currentStep
                ))
            }
            for index in diskTimers.indices {
                guard let task = doing[diskTimers[index].taskId] else { continue }
                diskTimers[index].stepAccumulatedMs = normalizedStepMilliseconds(
                    timer: diskTimers[index],
                    task: task
                )
                if let current = task.currentStep, current != diskTimers[index].activeStep,
                   diskTimers[index].phase != .running {
                    diskTimers[index].activeStep = current
                }
            }
            if diskTimers != before { try repository.saveTimers(diskTimers) }
            if diskTasks != tasks { tasks = diskTasks }
            if diskTimers != timers { timers = diskTimers }
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
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
        pause(taskId)
        setStatus(taskId, status: .todo, startTimer: false)
    }

    func focus(_ taskId: String) {
        setStatus(taskId, status: .doing, startTimer: true)
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

    private func setStatus(_ taskId: String, status: TaskStatus, startTimer: Bool) {
        guard let repository, let task = tasks.first(where: { $0.id == taskId }) else { return }
        do {
            _ = try repository.updateTask(task, status: status)
            if status == .doing {
                var timer = timers.first(where: { $0.taskId == taskId }) ?? TimerRecord(
                    taskId: taskId,
                    stepAccumulatedMs: task.stepSeconds.map { Double($0) * 1_000 },
                    activeStep: task.currentStep
                )
                if startTimer && timer.phase != .running {
                    let timestamp = Date().millisecondsSince1970
                    timer.phase = .running
                    timer.runningSince = timestamp
                    timer.stepRunningSince = timer.activeStep == nil ? nil : timestamp
                }
                timers.removeAll { $0.taskId == taskId }
                timers.append(timer)
            } else {
                timers.removeAll { $0.taskId == taskId }
            }
            try repository.saveTimers(timers)
            reload()
        } catch { lastError = error.localizedDescription }
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
}
