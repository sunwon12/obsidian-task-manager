import Foundation
import Darwin

enum CodexLogLocations {
    static func sessionRoots(homeURL: URL = FileManager.default.homeDirectoryForCurrentUser) -> [URL] {
        [
            homeURL.appendingPathComponent(".codex/sessions", isDirectory: true),
            homeURL.appendingPathComponent(
                "Library/Application Support/orca/codex-runtime-home/home/sessions",
                isDirectory: true
            ),
        ]
    }
}

enum DailyAiKind: String, Codable, Equatable {
    case interactive
    case automation
    case subagent
}

enum DailyProductivityBatchState: Equatable {
    case idle
    case running
    case error(String)
}

struct HumanTimerSegment: Codable, Equatable {
    let taskId: String
    let taskTitle: String
    let stepName: String
    let startedAt: Date
    let endedAt: Date
}

struct ActiveHumanTimerSegment: Codable, Equatable {
    let taskId: String
    let taskTitle: String
    let stepName: String
    let step: Int
    let startedAt: Date
}

struct HumanTimerLedger: Codable, Equatable {
    var version = 1
    var segments: [HumanTimerSegment] = []
    var active: [String: ActiveHumanTimerSegment] = [:]
}

struct DailyHumanTaskMetric: Codable, Equatable {
    let taskId: String
    let taskTitle: String
    let milliseconds: Double
}

struct DailyAiSessionMetric: Codable, Equatable {
    let provider: String
    let sessionId: String
    let kind: DailyAiKind
    let milliseconds: Double
    let waitingMilliseconds: Double
    let phases: [String: Double]
}

struct DailyProductivityMetric: Codable, Equatable {
    let date: String
    let generatedAt: Date
    let humanMilliseconds: Double
    let interactiveAiMilliseconds: Double
    let automationAiMilliseconds: Double
    let subagentAiMilliseconds: Double
    let waitingMilliseconds: Double
    let humanTasks: [DailyHumanTaskMetric]
    let aiSessions: [DailyAiSessionMetric]
    let codexCovered: Bool
    let claudeProjectCount: Int
}

struct DailyProductivityArchive: Codable, Equatable {
    var version = 5
    var days: [DailyProductivityMetric] = []
}

struct DailyProductivityRepository {
    let vaultURL: URL
    let dataRoot: String
    var fileManager: FileManager = .default

    var metricsURL: URL { vaultURL.appendingPathComponent(dataRoot).appendingPathComponent("Metrics") }
    var humanLedgerURL: URL { metricsURL.appendingPathComponent("human-timer-ledger.json") }
    var archiveURL: URL { metricsURL.appendingPathComponent("human-ai-daily.json") }
    var summaryURL: URL { metricsURL.appendingPathComponent("human-ai-daily.md") }
    var transcriptCacheURL: URL { metricsURL.appendingPathComponent("ai-transcript-cache.json") }

    func loadHumanLedger() throws -> HumanTimerLedger {
        guard fileManager.fileExists(atPath: humanLedgerURL.path) else { return HumanTimerLedger() }
        return try decoder().decode(HumanTimerLedger.self, from: Data(contentsOf: humanLedgerURL))
    }

    func saveHumanLedger(_ ledger: HumanTimerLedger) throws {
        try fileManager.createDirectory(at: metricsURL, withIntermediateDirectories: true)
        try encoder().encode(ledger).write(to: humanLedgerURL, options: .atomic)
    }

    func loadArchive() throws -> DailyProductivityArchive {
        guard fileManager.fileExists(atPath: archiveURL.path) else { return DailyProductivityArchive() }
        let archive = try decoder().decode(DailyProductivityArchive.self, from: Data(contentsOf: archiveURL))
        return archive.version == DailyProductivityArchive().version ? archive : DailyProductivityArchive()
    }

    func saveArchive(_ archive: DailyProductivityArchive) throws {
        try fileManager.createDirectory(at: metricsURL, withIntermediateDirectories: true)
        try encoder().encode(archive).write(to: archiveURL, options: .atomic)
        try Self.markdown(archive).write(to: summaryURL, atomically: true, encoding: .utf8)
    }

    func synchronizeHumanTimers(tasks: [TaskCard], timers: [TimerRecord], at now: Date) throws {
        var ledger = try loadHumanLedger()
        let taskById = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0) })
        let timerById = Dictionary(uniqueKeysWithValues: timers.map { ($0.taskId, $0) })
        let identities = Set(ledger.active.keys).union(timerById.keys)

        for taskId in identities {
            var desired = desiredActiveSegment(task: taskById[taskId], timer: timerById[taskId], now: now)
            let current = ledger.active[taskId]
            if current == desired { continue }
            if let current {
                let end = max(current.startedAt, now)
                ledger.segments.append(HumanTimerSegment(
                    taskId: current.taskId,
                    taskTitle: current.taskTitle,
                    stepName: current.stepName,
                    startedAt: current.startedAt,
                    endedAt: end
                ))
                ledger.active.removeValue(forKey: taskId)
                if let replacement = desired {
                    desired = ActiveHumanTimerSegment(
                        taskId: replacement.taskId,
                        taskTitle: replacement.taskTitle,
                        stepName: replacement.stepName,
                        step: replacement.step,
                        startedAt: now
                    )
                }
            }
            if let desired { ledger.active[taskId] = desired }
        }

        let cutoff = Calendar.current.date(byAdding: .day, value: -45, to: now) ?? .distantPast
        ledger.segments.removeAll { $0.endedAt < cutoff }
        try saveHumanLedger(ledger)
    }

    static func timerFingerprint(tasks: [TaskCard], timers: [TimerRecord]) -> String {
        let taskById = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0) })
        return timers.sorted { $0.taskId < $1.taskId }.map { timer in
            let task = taskById[timer.taskId]
            let step = timer.activeStep.flatMap { value in
                task?.steps.indices.contains(value - 1) == true ? task?.steps[value - 1] : nil
            } ?? ""
            return [
                timer.taskId,
                timer.phase.rawValue,
                String(timer.activeStep ?? 0),
                String(timer.runningSince ?? 0),
                String(timer.stepRunningSince ?? 0),
                task?.title ?? "",
                step,
            ].joined(separator: "\u{1f}")
        }.joined(separator: "\u{1e}")
    }

    private func desiredActiveSegment(task: TaskCard?, timer: TimerRecord?, now: Date) -> ActiveHumanTimerSegment? {
        guard let task, let timer,
              timer.phase == .running,
              let step = timer.activeStep,
              task.steps.indices.contains(step - 1)
        else { return nil }
        let name = task.steps[step - 1].trimmingCharacters(in: .whitespacesAndNewlines)
        guard name.hasPrefix("[인간]") else { return nil }
        let rawStart = timer.stepRunningSince ?? timer.runningSince ?? now.millisecondsSince1970
        return ActiveHumanTimerSegment(
            taskId: task.id,
            taskTitle: task.title,
            stepName: name,
            step: step,
            startedAt: Date(timeIntervalSince1970: rawStart / 1_000)
        )
    }

    private func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private static func markdown(_ archive: DailyProductivityArchive) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        let created = formatter.string(from: archive.days.map(\.generatedAt).min() ?? Date())
        var lines = [
            "---",
            "title: \"일일 인간·AI 작업시간\"",
            "type: 생산성",
            "tags: [\"taskmaster\", \"생산성\", \"시간측정\"]",
            "created: \(created)",
            "summary: \"랏코 타이머의 인간 구간과 Codex·Claude transcript에서 확정한 날짜별 인간·AI 작업시간이다.\"",
            "---",
            "",
            "# 일일 인간·AI 작업시간",
            "",
            "> 랏코가 매일 전날의 로컬 타이머와 Codex·Claude transcript를 다시 읽어 확정한 집계. 응답 대기는 생산성 시간에서 제외한다.",
            "> AI 시간은 동시 실행한 세션별 실행량의 합이므로 하루 24시간을 넘을 수 있다.",
            "",
            "| 날짜 | 인간 | AI 대화형 | AI 자동화 | 서브에이전트 | 응답 대기(제외) | 세션 | 커버리지 |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
        ]
        for day in archive.days.sorted(by: { $0.date > $1.date }) {
            let coverage: String
            if day.codexCovered, day.claudeProjectCount > 0 {
                coverage = "Codex + Claude \(day.claudeProjectCount)개 프로젝트"
            } else if day.codexCovered {
                coverage = "Codex · Claude 미연결"
            } else if day.claudeProjectCount > 0 {
                coverage = "Claude \(day.claudeProjectCount)개 프로젝트 · Codex 미연결"
            } else {
                coverage = "Codex·Claude 미연결"
            }
            lines.append("| \(day.date) | \(duration(day.humanMilliseconds)) | \(duration(day.interactiveAiMilliseconds)) | \(duration(day.automationAiMilliseconds)) | \(duration(day.subagentAiMilliseconds)) | \(duration(day.waitingMilliseconds)) | \(day.aiSessions.count) | \(coverage) |")
        }
        lines.append("")
        lines.append("> Claude 커버리지가 `미연결`이면 `AI 세션 점검`에서 현재 폴더의 Claude 로그를 한 번 연결해야 한다. 자동화·서브에이전트 시간은 대화형 AI 시간에 합산하지 않는다.")
        lines.append("")
        return lines.joined(separator: "\n")
    }

    private static func duration(_ milliseconds: Double) -> String {
        let minutes = max(0, Int((milliseconds / 60_000).rounded()))
        return minutes >= 60 ? "\(minutes / 60)시간 \(minutes % 60)분" : "\(minutes)분"
    }
}

private struct DailyAiWorkSpan: Codable {
    let provider: String
    let sessionId: String
    let kind: DailyAiKind
    let start: Date
    let end: Date
    let measuredMilliseconds: Double
    let phases: [String]
}

private struct DailyAiWaitingSpan: Codable {
    let provider: String
    let sessionId: String
    let kind: DailyAiKind
    let start: Date
    let end: Date
}

private struct DailyAiTimeline: Codable {
    let work: [DailyAiWorkSpan]
    let waiting: [DailyAiWaitingSpan]
}

private struct DailyTranscriptCacheEntry: Codable {
    let modifiedAt: Date
    let size: Int
    let timeline: DailyAiTimeline
}

private struct DailyTranscriptCache: Codable {
    var version = 3
    var entries: [String: DailyTranscriptCacheEntry] = [:]
}

private enum DailyTranscriptProvider {
    case codex
    case claude

    private static let codexPatterns = [
        Data(#""type":"session_meta""#.utf8),
        Data(#""type":"task_started""#.utf8),
        Data(#""type":"task_complete""#.utf8),
    ]
    private static let claudePatterns = [
        Data(#""type":"user""#.utf8),
        Data(#""type":"assistant""#.utf8),
    ]

    func accepts(bytes: UnsafeMutableRawPointer, count: Int) -> Bool {
        let patterns: [Data]
        switch self {
        case .codex:
            patterns = Self.codexPatterns
        case .claude:
            patterns = Self.claudePatterns
        }
        let line = Data(bytesNoCopy: bytes, count: count, deallocator: .none)
        return patterns.contains { line.range(of: $0) != nil }
    }
}

private struct JsonLineSequence: Sequence {
    let url: URL
    let provider: DailyTranscriptProvider

    func makeIterator() -> JsonLineIterator {
        JsonLineIterator(url: url, provider: provider)
    }
}

private final class JsonLineIterator: IteratorProtocol {
    private var file: UnsafeMutablePointer<FILE>?
    private let provider: DailyTranscriptProvider
    private var linePointer: UnsafeMutablePointer<CChar>?
    private var lineCapacity = 0

    init(url: URL, provider: DailyTranscriptProvider) {
        file = fopen(url.path, "r")
        self.provider = provider
    }

    deinit {
        if let file { fclose(file) }
        free(linePointer)
    }

    func next() -> [String: Any]? {
        guard let file else { return nil }
        var length = getline(&linePointer, &lineCapacity, file)
        while length >= 0 {
            guard let currentLine = linePointer else { return nil }
            let count = Int(length)
            let bytes = UnsafeMutableRawPointer(currentLine)
            if provider.accepts(bytes: bytes, count: count) {
                let object: [String: Any]? = autoreleasepool {
                    let data = Data(bytes: bytes, count: count)
                    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                }
                if let object { return object }
            }
            length = getline(&linePointer, &lineCapacity, file)
        }
        fclose(file)
        self.file = nil
        return nil
    }
}

enum DailyProductivityBatch {
    static func dueDates(
        now: Date,
        scheduleAt: String,
        lookbackDays: Int,
        existingDates: Set<String>,
        calendar: Calendar = .current
    ) -> [Date] {
        guard let scheduledMinute = scheduleMinute(scheduleAt) else { return [] }
        let components = calendar.dateComponents([.hour, .minute], from: now)
        let currentMinute = (components.hour ?? 0) * 60 + (components.minute ?? 0)
        let latestOffset = currentMinute >= scheduledMinute ? -1 : -2
        guard let latest = calendar.date(byAdding: .day, value: latestOffset, to: calendar.startOfDay(for: now)) else { return [] }
        return (0..<max(1, lookbackDays)).compactMap { offset in
            calendar.date(byAdding: .day, value: -offset, to: latest)
        }
        .filter { !existingDates.contains(dateKey($0, calendar: calendar)) }
        .sorted()
    }

    static func run(
        dates: [Date],
        repository: DailyProductivityRepository,
        homeURL: URL = FileManager.default.homeDirectoryForCurrentUser,
        authorizedClaudeProjects: [String: URL],
        now: Date = Date(),
        calendar: Calendar = .current
    ) throws -> DailyProductivityArchive {
        guard !dates.isEmpty else { return try repository.loadArchive() }
        let ledger = try repository.loadHumanLedger()
        let timelines = try loadTimelines(
            dates: dates,
            repository: repository,
            homeURL: homeURL,
            authorizedClaudeProjects: authorizedClaudeProjects,
            calendar: calendar
        )
        var archive = try repository.loadArchive()
        var byDate = Dictionary(uniqueKeysWithValues: archive.days.map { ($0.date, $0) })
        for date in dates {
            let interval = DateInterval(
                start: calendar.startOfDay(for: date),
                end: calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: date))!
            )
            let humanTasks = humanMetrics(ledger: ledger, interval: interval, now: now)
            let sessions = aiMetrics(timelines: timelines, interval: interval)
            byDate[dateKey(date, calendar: calendar)] = DailyProductivityMetric(
                date: dateKey(date, calendar: calendar),
                generatedAt: now,
                humanMilliseconds: humanTasks.reduce(0) { $0 + $1.milliseconds },
                interactiveAiMilliseconds: sessions.filter { $0.kind == .interactive }.reduce(0) { $0 + $1.milliseconds },
                automationAiMilliseconds: sessions.filter { $0.kind == .automation }.reduce(0) { $0 + $1.milliseconds },
                subagentAiMilliseconds: sessions.filter { $0.kind == .subagent }.reduce(0) { $0 + $1.milliseconds },
                waitingMilliseconds: sessions.filter { $0.kind == .interactive }.reduce(0) { $0 + $1.waitingMilliseconds },
                humanTasks: humanTasks,
                aiSessions: sessions,
                codexCovered: CodexLogLocations.sessionRoots(homeURL: homeURL).contains {
                    FileManager.default.fileExists(atPath: $0.path)
                },
                claudeProjectCount: authorizedClaudeProjects.count
            )
        }
        archive.days = byDate.values.sorted { $0.date < $1.date }
        try repository.saveArchive(archive)
        return archive
    }

    static func parseClaude(data: Data) -> (work: Double, waiting: Double, kind: DailyAiKind) {
        let timeline = parseClaudeTimeline(data: data)
        return (
            timeline.work.reduce(0) { $0 + $1.measuredMilliseconds },
            timeline.waiting.reduce(0) { $0 + max(0, $1.end.timeIntervalSince($1.start) * 1_000) },
            timeline.work.first?.kind ?? timeline.waiting.first?.kind ?? .interactive
        )
    }

    static func parseCodex(data: Data) -> (work: Double, waiting: Double, kind: DailyAiKind) {
        let timeline = parseCodexTimeline(data: data)
        return (
            timeline.work.reduce(0) { $0 + $1.measuredMilliseconds },
            timeline.waiting.reduce(0) { $0 + max(0, $1.end.timeIntervalSince($1.start) * 1_000) },
            timeline.work.first?.kind ?? timeline.waiting.first?.kind ?? .interactive
        )
    }

    private static func humanMetrics(ledger: HumanTimerLedger, interval: DateInterval, now: Date) -> [DailyHumanTaskMetric] {
        let finished = ledger.segments.map { ($0.taskId, $0.taskTitle, $0.startedAt, $0.endedAt) }
        let active = ledger.active.values.map { ($0.taskId, $0.taskTitle, $0.startedAt, now) }
        var totals: [String: (title: String, milliseconds: Double)] = [:]
        for (taskId, title, start, end) in finished + active {
            let milliseconds = overlapMilliseconds(start: start, end: end, interval: interval)
            guard milliseconds > 0 else { continue }
            totals[taskId, default: (title, 0)].milliseconds += milliseconds
        }
        return totals.map { DailyHumanTaskMetric(taskId: $0.key, taskTitle: $0.value.title, milliseconds: $0.value.milliseconds) }
            .sorted { $0.milliseconds > $1.milliseconds }
    }

    private static func aiMetrics(timelines: [DailyAiTimeline], interval: DateInterval) -> [DailyAiSessionMetric] {
        struct Accumulator {
            var provider: String
            var sessionId: String
            var kind: DailyAiKind
            var milliseconds = 0.0
            var waitingMilliseconds = 0.0
            var phases: [String: Double] = [:]
        }
        var values: [String: Accumulator] = [:]
        var seenWork = Set<String>()
        var seenWaiting = Set<String>()
        for timeline in timelines {
            for span in timeline.work {
                let identity = "\(span.provider):\(span.sessionId):\(span.start.timeIntervalSince1970):\(span.end.timeIntervalSince1970):\(span.measuredMilliseconds)"
                guard seenWork.insert(identity).inserted else { continue }
                let wall = max(0, span.end.timeIntervalSince(span.start) * 1_000)
                let overlap = overlapMilliseconds(start: span.start, end: span.end, interval: interval)
                let measured = wall > 0 ? span.measuredMilliseconds * overlap / wall
                    : (interval.contains(span.end) ? span.measuredMilliseconds : 0)
                guard measured > 0 else { continue }
                let key = "\(span.provider):\(span.sessionId):\(span.kind.rawValue)"
                var value = values[key] ?? Accumulator(provider: span.provider, sessionId: span.sessionId, kind: span.kind)
                value.milliseconds += measured
                let phases = span.phases.isEmpty ? ["진행"] : span.phases
                let slice = measured / Double(phases.count)
                for phase in phases { value.phases[phase, default: 0] += slice }
                values[key] = value
            }
            for span in timeline.waiting where span.kind == .interactive {
                let identity = "\(span.provider):\(span.sessionId):\(span.start.timeIntervalSince1970):\(span.end.timeIntervalSince1970)"
                guard seenWaiting.insert(identity).inserted else { continue }
                let waiting = overlapMilliseconds(start: span.start, end: span.end, interval: interval)
                guard waiting > 0 else { continue }
                let key = "\(span.provider):\(span.sessionId):\(span.kind.rawValue)"
                var value = values[key] ?? Accumulator(provider: span.provider, sessionId: span.sessionId, kind: span.kind)
                value.waitingMilliseconds += waiting
                values[key] = value
            }
        }
        return values.values.map {
            DailyAiSessionMetric(
                provider: $0.provider,
                sessionId: $0.sessionId,
                kind: $0.kind,
                milliseconds: $0.milliseconds,
                waitingMilliseconds: $0.waitingMilliseconds,
                phases: $0.phases
            )
        }.sorted { $0.milliseconds > $1.milliseconds }
    }

    private static func loadTimelines(
        dates: [Date],
        repository: DailyProductivityRepository,
        homeURL: URL,
        authorizedClaudeProjects: [String: URL],
        calendar: Calendar
    ) throws -> [DailyAiTimeline] {
        guard let first = dates.min() else { return [] }
        let earliest = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: first)) ?? first
        var cache = loadTranscriptCache(at: repository.transcriptCacheURL)
        var timelines: [DailyAiTimeline] = []
        let files = codexFiles(dates: dates, homeURL: homeURL, calendar: calendar).map { ($0, "codex") }
            + claudeFiles(projects: authorizedClaudeProjects, modifiedAfter: earliest).map { ($0, "claude") }
        var parsedSinceSave = 0
        for (url, provider) in files {
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
            let modifiedAt = values?.contentModificationDate ?? .distantPast
            let size = values?.fileSize ?? 0
            if let cached = cache.entries[url.path], cached.modifiedAt == modifiedAt, cached.size == size {
                timelines.append(cached.timeline)
                continue
            }
            let timeline = provider == "codex" ? parseCodexTimeline(url: url) : parseClaudeTimeline(url: url)
            cache.entries[url.path] = DailyTranscriptCacheEntry(
                modifiedAt: modifiedAt,
                size: size,
                timeline: timeline
            )
            timelines.append(timeline)
            parsedSinceSave += 1
            if parsedSinceSave >= 100 {
                saveTranscriptCache(cache, to: repository.transcriptCacheURL)
                parsedSinceSave = 0
            }
        }
        saveTranscriptCache(cache, to: repository.transcriptCacheURL)
        return timelines
    }

    private static func loadTranscriptCache(at url: URL) -> DailyTranscriptCache {
        guard let data = try? Data(contentsOf: url) else { return DailyTranscriptCache() }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let cache = try? decoder.decode(DailyTranscriptCache.self, from: data),
              cache.version == DailyTranscriptCache().version
        else { return DailyTranscriptCache() }
        return cache
    }

    private static func saveTranscriptCache(_ cache: DailyTranscriptCache, to url: URL) {
        autoreleasepool {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            guard let data = try? encoder.encode(cache) else { return }
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: url, options: .atomic)
        }
    }

    private static func codexFiles(dates: [Date], homeURL: URL, calendar: Calendar) -> [URL] {
        let neighboring = dates.flatMap { date in [-1, 0, 1].compactMap { calendar.date(byAdding: .day, value: $0, to: date) } }
        var seen = Set<String>()
        return CodexLogLocations.sessionRoots(homeURL: homeURL).flatMap { root in
            neighboring.flatMap { date -> [URL] in
                let components = calendar.dateComponents([.year, .month, .day], from: date)
                guard let year = components.year, let month = components.month, let day = components.day else { return [] }
                let directory = root.appendingPathComponent(String(format: "%04d/%02d/%02d", year, month, day), isDirectory: true)
                return recursiveJsonlFiles(at: directory)
            }
        }.filter { seen.insert($0.path).inserted }
    }

    private static func claudeFiles(projects: [String: URL], modifiedAfter earliest: Date) -> [URL] {
        var seen = Set<String>()
        return projects.values.flatMap { recursiveJsonlFiles(at: $0) }.filter { url in
            guard seen.insert(url.path).inserted else { return false }
            let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return modified >= earliest
        }
    }

    private static func recursiveJsonlFiles(at root: URL) -> [URL] {
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }
        return enumerator.compactMap { $0 as? URL }.filter { $0.pathExtension == "jsonl" }
    }

    private static func parseClaudeTimeline(data: Data) -> DailyAiTimeline {
        parseClaudeTimeline(records: jsonLines(data))
    }

    private static func parseClaudeTimeline(url: URL) -> DailyAiTimeline {
        parseClaudeTimeline(records: JsonLineSequence(url: url, provider: .claude))
    }

    private static func parseClaudeTimeline<Records: Sequence>(records: Records) -> DailyAiTimeline
    where Records.Element == [String: Any] {
        var sessionId = "claude"
        var kind: DailyAiKind = .interactive
        var turnStart: Date?
        var lastAssistant: Date?
        var lastCompleted: Date?
        var phases: [String] = []
        var work: [DailyAiWorkSpan] = []
        var waiting: [DailyAiWaitingSpan] = []

        func closeTurn() {
            guard let start = turnStart, let end = lastAssistant, end >= start else { return }
            work.append(DailyAiWorkSpan(
                provider: "Claude", sessionId: sessionId, kind: kind,
                start: start, end: end,
                measuredMilliseconds: end.timeIntervalSince(start) * 1_000,
                phases: phases
            ))
            lastCompleted = end
        }

        for object in records {
            autoreleasepool {
                if let value = object["sessionId"] as? String { sessionId = value }
                if object["isSidechain"] as? Bool == true { kind = .subagent }
                else if object["entrypoint"] as? String == "sdk-cli", kind != .subagent { kind = .automation }
                if let date = parseDate(object["timestamp"]), let type = object["type"] as? String {
                    if type == "user", object["isMeta"] as? Bool != true,
                       userText(object["message"] as? [String: Any]) != nil {
                        closeTurn()
                        if let lastCompleted, date > lastCompleted {
                            waiting.append(DailyAiWaitingSpan(
                                provider: "Claude", sessionId: sessionId, kind: kind,
                                start: lastCompleted, end: date
                            ))
                        }
                        turnStart = date
                        lastAssistant = nil
                        phases = []
                    } else if type == "assistant", turnStart != nil,
                              let blocks = (object["message"] as? [String: Any])?["content"] as? [[String: Any]] {
                        lastAssistant = date
                        for block in blocks where block["type"] as? String == "tool_use" {
                            phases.append(classify(tool: block["name"] as? String, input: block["input"]))
                        }
                    }
                }
            }
        }
        closeTurn()
        return DailyAiTimeline(work: work, waiting: waiting)
    }

    private static func parseCodexTimeline(data: Data) -> DailyAiTimeline {
        parseCodexTimeline(records: jsonLines(data))
    }

    private static func parseCodexTimeline(url: URL) -> DailyAiTimeline {
        parseCodexTimeline(records: JsonLineSequence(url: url, provider: .codex))
    }

    private static func parseCodexTimeline<Records: Sequence>(records: Records) -> DailyAiTimeline
    where Records.Element == [String: Any] {
        var sessionId = "codex"
        var kind: DailyAiKind = .interactive
        var activeStart: Date?
        var phases: [String] = []
        var lastCompleted: Date?
        var work: [DailyAiWorkSpan] = []
        var waiting: [DailyAiWaitingSpan] = []

        for object in records {
            autoreleasepool {
                let recordDate = parseDate(object["timestamp"])
                if let type = object["type"] as? String,
                   let payload = object["payload"] as? [String: Any] {
                    if type == "session_meta" {
                        if let value = payload["id"] as? String { sessionId = value }
                        if payload["thread_source"] as? String == "subagent" || payload["source"] is [String: Any] {
                            kind = .subagent
                        } else if payload["originator"] as? String == "codex_exec" || payload["source"] as? String == "exec" {
                            kind = .automation
                        } else {
                            kind = .interactive
                        }
                    } else if type == "event_msg", let eventType = payload["type"] as? String {
                        if eventType == "task_started" {
                            let start = parseDate(payload["started_at"]) ?? recordDate
                            if let lastCompleted, let start, start > lastCompleted {
                                waiting.append(DailyAiWaitingSpan(
                                    provider: "Codex", sessionId: sessionId, kind: kind,
                                    start: lastCompleted, end: start
                                ))
                            }
                            activeStart = start
                            phases = []
                        } else if eventType == "task_complete" {
                            let end = parseDate(payload["completed_at"]) ?? recordDate
                            let measured = number(payload["duration_ms"]) ?? 0
                            if let end {
                                let start = activeStart ?? end.addingTimeInterval(-measured / 1_000)
                                let normalizedMeasured = measured > 0 ? measured : max(0, end.timeIntervalSince(start) * 1_000)
                                work.append(DailyAiWorkSpan(
                                    provider: "Codex", sessionId: sessionId, kind: kind,
                                    start: start, end: end,
                                    measuredMilliseconds: normalizedMeasured,
                                    phases: phases
                                ))
                                lastCompleted = end
                            }
                            activeStart = nil
                            phases = []
                        }
                    } else if type == "response_item",
                              ["function_call", "custom_tool_call"].contains(payload["type"] as? String) {
                        phases.append(classify(tool: payload["name"] as? String, input: payload["arguments"] ?? payload["input"]))
                    }
                }
            }
        }
        return DailyAiTimeline(work: work, waiting: waiting)
    }

    private static func scheduleMinute(_ value: String) -> Int? {
        let parts = value.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0..<24).contains(hour), (0..<60).contains(minute)
        else { return nil }
        return hour * 60 + minute
    }

    private static func dateKey(_ date: Date, calendar: Calendar) -> String {
        let values = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", values.year ?? 0, values.month ?? 0, values.day ?? 0)
    }

    private static func overlapMilliseconds(start: Date, end: Date, interval: DateInterval) -> Double {
        let lower = max(start, interval.start)
        let upper = min(end, interval.end)
        return max(0, upper.timeIntervalSince(lower) * 1_000)
    }

    private static func jsonLines(_ data: Data) -> [[String: Any]] {
        data.split(separator: 0x0A).compactMap { line in
            (try? JSONSerialization.jsonObject(with: line)) as? [String: Any]
        }
    }

    private static func parseDate(_ value: Any?) -> Date? {
        if let number = number(value) {
            return Date(timeIntervalSince1970: number > 10_000_000_000 ? number / 1_000 : number)
        }
        guard let value = value as? String else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private static func number(_ value: Any?) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? NSNumber { return value.doubleValue }
        return nil
    }

    private static func classify(tool: String?, input: Any?) -> String {
        let value = "\(tool ?? "") \(String(describing: input ?? ""))".lowercased()
        if value.contains("test") || value.contains("xcodebuild") || value.contains("gradle") { return "테스트" }
        if value.contains("apply_patch") || value.contains("edit") || value.contains("write") { return "구현" }
        if value.contains("git diff") || value.contains("git status") || value.contains("review") { return "검증" }
        if value.contains("read") || value.contains("grep") || value.contains("glob") || value.contains("find") || value.contains("search") { return "조사" }
        return "진행"
    }

    private static func userText(_ message: [String: Any]?) -> String? {
        let content = message?["content"]
        if let value = content as? String {
            return value.isEmpty || isInjectedContext(value) ? nil : value
        }
        guard let blocks = content as? [[String: Any]] else { return nil }
        return blocks.compactMap { block -> String? in
            guard ["text", "input_text"].contains(block["type"] as? String),
                  let value = block["text"] as? String,
                  !isInjectedContext(value)
            else { return nil }
            return value
        }.first
    }

    private static func isInjectedContext(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefixes = [
            "# AGENTS.md instructions",
            "<environment_context>",
            "<permissions instructions>",
            "<collaboration_mode>",
            "<skills_instructions>",
            "<apps_instructions>",
        ]
        return prefixes.contains { trimmed.hasPrefix($0) }
    }
}
