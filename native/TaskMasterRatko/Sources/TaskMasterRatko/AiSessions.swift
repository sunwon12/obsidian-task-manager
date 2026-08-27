import Foundation

enum AiSessionProvider: String, Equatable {
    case claude = "Claude"
    case codex = "Codex"
}

enum AiSessionKind: Equatable {
    case interactive
    case automation
    case subagent
}

enum AiSessionActivity: Equatable {
    case running
    case waitingForHuman
    case unknown
}

struct AiSessionPhase: Identifiable, Equatable {
    var id: String { name }
    let name: String
    let milliseconds: Double
}

struct AiSessionReport: Identifiable, Equatable {
    let id: String
    let provider: AiSessionProvider
    let kind: AiSessionKind
    let activity: AiSessionActivity
    let pid: Int
    let tty: String
    let cwd: String
    let transcriptPath: String?
    let summary: String
    let aiMilliseconds: Double
    let waitingMilliseconds: Double
    let phases: [AiSessionPhase]
    let taskId: String?
    let taskTitle: String?
    let humanMilliseconds: Double
    let lastActivity: Date?
}

enum AiSessionScanState: Equatable {
    case idle
    case running
    case loaded
    case error(String)
}

struct AiProcess: Equatable {
    let pid: Int
    let parentPid: Int
    let tty: String
    let command: String
    let provider: AiSessionProvider
    let kind: AiSessionKind
    var cwd: String?
}

struct AiTranscriptFacts: Equatable {
    let id: String
    let activity: AiSessionActivity
    let summary: String
    let aiMilliseconds: Double
    let waitingMilliseconds: Double
    let phases: [AiSessionPhase]
    let lastActivity: Date?
    let kind: AiSessionKind
}

enum AiSessionScanner {
    static func scan(tasks: [TaskCard], timers: [TimerRecord], now: Date = Date()) async -> Result<[AiSessionReport], Error> {
        await Task.detached(priority: .utility) {
            do {
                return .success(try scanSynchronously(tasks: tasks, timers: timers, now: now))
            } catch {
                return .failure(error)
            }
        }.value
    }

    static func scanSynchronously(
        tasks: [TaskCard],
        timers: [TimerRecord],
        now: Date = Date(),
        homeURL: URL = FileManager.default.homeDirectoryForCurrentUser
    ) throws -> [AiSessionReport] {
        let output = try run("/bin/ps", arguments: ["ax", "-o", "pid=,ppid=,tty=,command="])
        var processes = parseProcesses(output)
        for index in processes.indices {
            processes[index].cwd = processCwd(pid: processes[index].pid)
        }

        let unique = deduplicated(processes)
        return unique.map { process in
            let transcript = locateTranscript(for: process, homeURL: homeURL)
            let facts = transcript.flatMap { parseTranscript(at: $0, provider: process.provider, now: now) }
            RatkoUiTestDiagnostics.log(
                "ai-session pid=\(process.pid) provider=\(process.provider.rawValue) transcript=\(transcript?.lastPathComponent ?? "none") parsed=\(facts != nil)"
            )
            let link = linkTask(cwd: process.cwd ?? "", summary: facts?.summary ?? "", tasks: tasks)
            let human = link.flatMap { linked in
                timers.first(where: { $0.taskId == linked.id }).map { timer in
                    humanMilliseconds(task: linked, timer: timer, now: now)
                }
            } ?? 0
            return AiSessionReport(
                id: "\(process.provider.rawValue)-\(process.pid)",
                provider: process.provider,
                kind: facts?.kind == .subagent ? .subagent : process.kind,
                activity: facts?.activity ?? .unknown,
                pid: process.pid,
                tty: process.tty,
                cwd: process.cwd ?? "경로 확인 불가",
                transcriptPath: facts == nil ? nil : transcript?.path,
                summary: facts?.summary ?? missingTranscriptMessage(for: process.provider),
                aiMilliseconds: facts?.aiMilliseconds ?? 0,
                waitingMilliseconds: facts?.waitingMilliseconds ?? 0,
                phases: facts?.phases ?? [],
                taskId: link?.id,
                taskTitle: link?.title,
                humanMilliseconds: human,
                lastActivity: facts?.lastActivity
            )
        }
        .sorted { left, right in
            if left.kind != right.kind { return left.kind == .interactive }
            return (left.lastActivity ?? .distantPast) > (right.lastActivity ?? .distantPast)
        }
    }

    static func parseProcesses(_ output: String) -> [AiProcess] {
        output.split(whereSeparator: \Character.isNewline).compactMap { rawLine in
            let line = String(rawLine).trimmingCharacters(in: .whitespaces)
            let fields = line.split(maxSplits: 3, whereSeparator: \Character.isWhitespace)
            guard fields.count == 4,
                  let pid = Int(fields[0]),
                  let parent = Int(fields[1])
            else { return nil }
            let tty = String(fields[2])
            let command = String(fields[3])
            let executable = command.split(whereSeparator: \Character.isWhitespace).first.map(String.init) ?? ""
            let basename = URL(fileURLWithPath: executable).lastPathComponent
            if basename == "claude" {
                let automation = tty == "??" || command.range(of: #"(^|\s)-p(\s|$)"#, options: .regularExpression) != nil
                return AiProcess(
                    pid: pid,
                    parentPid: parent,
                    tty: tty,
                    command: command,
                    provider: .claude,
                    kind: automation ? .automation : .interactive
                )
            }
            if basename == "codex", !command.contains("codex-code-mode-host") {
                let automation = tty == "??"
                return AiProcess(
                    pid: pid,
                    parentPid: parent,
                    tty: tty,
                    command: command,
                    provider: .codex,
                    kind: automation ? .automation : .interactive
                )
            }
            return nil
        }
    }

    static func deduplicated(_ processes: [AiProcess]) -> [AiProcess] {
        var seen = Set<String>()
        return processes.filter { process in
            let key = "\(process.provider.rawValue)|\(process.tty)|\(process.cwd ?? process.pid.description)"
            return seen.insert(key).inserted
        }
    }

    static func parseClaude(data: Data, now: Date = Date()) -> AiTranscriptFacts? {
        let records = jsonLines(data)
        guard !records.isEmpty else { return nil }
        var id = "claude"
        var events: [(date: Date, kind: String, phase: String?, text: String?)] = []
        var isSubagent = false

        for object in records {
            if let sessionId = object["sessionId"] as? String { id = sessionId }
            if object["isSidechain"] as? Bool == true { isSubagent = true }
            guard let date = isoDate(object["timestamp"]), let type = object["type"] as? String else { continue }
            let message = object["message"] as? [String: Any]
            let content = message?["content"]
            if type == "user", content is String {
                events.append((date, "human", nil, content as? String))
            } else if type == "assistant", let blocks = content as? [[String: Any]] {
                var phase: String?
                var text: String?
                for block in blocks {
                    switch block["type"] as? String {
                    case "tool_use":
                        phase = classify(tool: block["name"] as? String, input: block["input"])
                    case "text":
                        text = block["text"] as? String
                    default: break
                    }
                }
                events.append((date, phase == nil && text != nil ? "assistantText" : "assistantWork", phase, text))
            }
        }
        guard let first = events.first else { return nil }

        var aiMs = 0.0
        var waitMs = 0.0
        var phaseMs: [String: Double] = [:]
        var lastSummary = "진행 내용을 요약할 응답이 아직 없습니다."
        var turnStart: Date?
        var lastAssistant: Date?
        var lastEventKind = ""
        var turnPhases: [String] = []
        for event in events {
            lastEventKind = event.kind
            if event.kind == "human" {
                if let previous = lastAssistant {
                    waitMs += max(0, event.date.timeIntervalSince(previous) * 1_000)
                }
                if let start = turnStart, let end = lastAssistant {
                    allocate(duration: end.timeIntervalSince(start) * 1_000, phases: turnPhases, into: &phaseMs)
                    aiMs += max(0, end.timeIntervalSince(start) * 1_000)
                }
                turnStart = event.date
                lastAssistant = nil
                turnPhases = []
            } else {
                lastAssistant = event.date
                if let phase = event.phase { turnPhases.append(phase) }
                if let text = normalizedSummary(event.text) { lastSummary = text }
            }
        }

        let active = turnStart != nil && (
            lastAssistant == nil
                || lastEventKind == "assistantWork"
                || now.timeIntervalSince(lastAssistant ?? first.date) < 20
        )
        if let start = turnStart {
            let end = active ? now : (lastAssistant ?? start)
            let duration = max(0, end.timeIntervalSince(start) * 1_000)
            aiMs += duration
            allocate(duration: duration, phases: turnPhases, into: &phaseMs)
            if !active, let lastAssistant { waitMs += max(0, now.timeIntervalSince(lastAssistant) * 1_000) }
        }
        return AiTranscriptFacts(
            id: id,
            activity: active ? .running : .waitingForHuman,
            summary: lastSummary,
            aiMilliseconds: aiMs,
            waitingMilliseconds: waitMs,
            phases: phaseReports(phaseMs, fallbackDuration: aiMs),
            lastActivity: events.last?.date,
            kind: isSubagent ? .subagent : .interactive
        )
    }

    static func parseCodex(data: Data, now: Date = Date()) -> AiTranscriptFacts? {
        let records = jsonLines(data)
        guard !records.isEmpty else { return nil }
        var id = "codex"
        var kind: AiSessionKind = .interactive
        var totalMs = 0.0
        var waitMs = 0.0
        var phaseMs: [String: Double] = [:]
        var phasesInTurn: [String] = []
        var activeStartedAt: Date?
        var lastCompletedAt: Date?
        var lastActivity: Date?
        var summary = "진행 내용을 요약할 응답이 아직 없습니다."

        for object in records {
            if let timestamp = isoDate(object["timestamp"]) { lastActivity = timestamp }
            guard let type = object["type"] as? String,
                  let payload = object["payload"] as? [String: Any]
            else { continue }
            if type == "session_meta" {
                if let value = payload["id"] as? String { id = value }
                if payload["source"] is [String: Any] { kind = .subagent }
            } else if type == "event_msg", let eventType = payload["type"] as? String {
                if eventType == "task_started" {
                    if let previous = lastCompletedAt, let started = isoDate(payload["started_at"]) {
                        waitMs += max(0, started.timeIntervalSince(previous) * 1_000)
                    }
                    activeStartedAt = isoDate(payload["started_at"]) ?? lastActivity
                    phasesInTurn = []
                } else if eventType == "task_complete" {
                    let duration = number(payload["duration_ms"]) ?? activeStartedAt.map { now.timeIntervalSince($0) * 1_000 } ?? 0
                    totalMs += max(0, duration)
                    allocate(duration: duration, phases: phasesInTurn, into: &phaseMs)
                    lastCompletedAt = isoDate(payload["completed_at"]) ?? lastActivity
                    activeStartedAt = nil
                    if let text = normalizedSummary(payload["last_agent_message"] as? String) { summary = text }
                }
            } else if type == "response_item", let itemType = payload["type"] as? String {
                if itemType == "function_call" || itemType == "custom_tool_call" {
                    phasesInTurn.append(classify(tool: payload["name"] as? String, input: payload["arguments"] ?? payload["input"]))
                } else if itemType == "message",
                          payload["role"] as? String == "assistant",
                          let content = payload["content"] as? [[String: Any]] {
                    let text = content.compactMap { $0["text"] as? String }.joined(separator: " ")
                    if let value = normalizedSummary(text) { summary = value }
                }
            }
        }
        if let activeStartedAt {
            let duration = max(0, now.timeIntervalSince(activeStartedAt) * 1_000)
            totalMs += duration
            allocate(duration: duration, phases: phasesInTurn, into: &phaseMs)
        } else if let lastCompletedAt {
            waitMs += max(0, now.timeIntervalSince(lastCompletedAt) * 1_000)
        }
        return AiTranscriptFacts(
            id: id,
            activity: activeStartedAt == nil ? .waitingForHuman : .running,
            summary: summary,
            aiMilliseconds: totalMs,
            waitingMilliseconds: waitMs,
            phases: phaseReports(phaseMs, fallbackDuration: totalMs),
            lastActivity: lastActivity,
            kind: kind
        )
    }

    static func humanMilliseconds(task: TaskCard, timer: TimerRecord, now: Date = Date()) -> Double {
        task.steps.indices.reduce(0) { total, index in
            guard task.steps[index].trimmingCharacters(in: .whitespaces).hasPrefix("[인간]") else { return total }
            var milliseconds = timer.stepAccumulatedMs.indices.contains(index) ? timer.stepAccumulatedMs[index] : 0
            if timer.phase == .running, timer.activeStep == index + 1, let since = timer.stepRunningSince {
                milliseconds += max(0, now.millisecondsSince1970 - since)
            }
            return total + milliseconds
        }
    }

    static func linkTask(cwd: String, summary: String, tasks: [TaskCard]) -> TaskCard? {
        let source = "\(cwd) \(summary)"
        guard let expression = try? NSRegularExpression(pattern: #"[A-Z][A-Z0-9]+-\d+"#) else { return nil }
        let keys = expression.matches(in: source, range: NSRange(source.startIndex..., in: source)).compactMap { match in
            Range(match.range, in: source).map { String(source[$0]).lowercased() }
        }
        return tasks.first { task in
            let searchable = "\(task.title) \(task.body) \(task.url.absoluteString)".lowercased()
            return keys.contains { searchable.contains($0) }
        }
    }

    private static func locateTranscript(for process: AiProcess, homeURL: URL) -> URL? {
        guard let cwd = process.cwd else { return nil }
        switch process.provider {
        case .codex:
            let paths = openJsonlPaths(pid: process.pid)
            return paths.compactMap { url -> (URL, Date)? in
                guard let first = firstJsonObject(at: url),
                      first["type"] as? String == "session_meta",
                      let payload = first["payload"] as? [String: Any],
                      payload["cwd"] as? String == cwd,
                      !(payload["source"] is [String: Any])
                else { return nil }
                return (url, modificationDate(url))
            }.max(by: { $0.1 < $1.1 })?.0
        case .claude:
            let projectDirectory = claudeProjectDirectory(cwd: cwd, homeURL: homeURL)
            if let resumeId = capture(#"--resume\s+([0-9a-f-]+)"#, in: process.command) {
                let direct = projectDirectory.appendingPathComponent("\(resumeId).jsonl")
                if pathExists(direct.path) { return direct }
            }
            var candidates = (try? FileManager.default.contentsOfDirectory(
                at: projectDirectory,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: [.skipsHiddenFiles]
            )) ?? []
            if candidates.isEmpty,
               let output = try? run("/usr/bin/find", arguments: [
                   projectDirectory.path, "-maxdepth", "1", "-type", "f", "-name", "*.jsonl", "-print",
               ]) {
                candidates = output.split(whereSeparator: \Character.isNewline)
                    .map { URL(fileURLWithPath: String($0)) }
            }
            return candidates.filter { $0.pathExtension == "jsonl" }
                .max { modificationDate($0) < modificationDate($1) }
        }
    }

    private static func parseTranscript(at url: URL, provider: AiSessionProvider, now: Date) -> AiTranscriptFacts? {
        guard let data = (try? Data(contentsOf: url, options: [.mappedIfSafe]))
            ?? (try? runData("/bin/cat", arguments: [url.path]))
        else { return nil }
        switch provider {
        case .claude: return parseClaude(data: data, now: now)
        case .codex: return parseCodex(data: data, now: now)
        }
    }

    private static func processCwd(pid: Int) -> String? {
        guard let output = try? run("/usr/sbin/lsof", arguments: ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]) else { return nil }
        return output.split(whereSeparator: \Character.isNewline)
            .first(where: { $0.hasPrefix("n") })
            .map { String($0.dropFirst()) }
    }

    private static func openJsonlPaths(pid: Int) -> [URL] {
        guard let output = try? run("/usr/sbin/lsof", arguments: ["-p", String(pid), "-Fn"]) else { return [] }
        return output.split(whereSeparator: \Character.isNewline).compactMap { line in
            guard line.hasPrefix("n") else { return nil }
            let path = String(line.dropFirst())
            guard path.hasSuffix(".jsonl"), path.contains("/sessions/") else { return nil }
            return URL(fileURLWithPath: path)
        }
    }

    private static func claudeProjectDirectory(cwd: String, homeURL: URL) -> URL {
        let encoded = cwd.replacingOccurrences(of: "/", with: "-")
        return homeURL.appendingPathComponent(".claude/projects/\(encoded)", isDirectory: true)
    }

    private static func firstJsonObject(at url: URL) -> [String: Any]? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        guard let data = try? handle.read(upToCount: 64 * 1_024),
              let newline = data.firstIndex(of: 0x0A)
        else { return nil }
        return (try? JSONSerialization.jsonObject(with: data[..<newline])) as? [String: Any]
    }

    private static func jsonLines(_ data: Data) -> [[String: Any]] {
        data.split(separator: 0x0A).compactMap { line in
            (try? JSONSerialization.jsonObject(with: line)) as? [String: Any]
        }
    }

    private static func isoDate(_ value: Any?) -> Date? {
        if let seconds = number(value) {
            return Date(timeIntervalSince1970: seconds > 10_000_000_000 ? seconds / 1_000 : seconds)
        }
        guard let string = value as? String else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: string) ?? ISO8601DateFormatter().date(from: string)
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

    private static func allocate(duration: Double, phases: [String], into totals: inout [String: Double]) {
        guard duration > 0 else { return }
        let values = phases.isEmpty ? ["진행"] : phases
        let slice = duration / Double(values.count)
        for phase in values { totals[phase, default: 0] += slice }
    }

    private static func phaseReports(_ values: [String: Double], fallbackDuration: Double) -> [AiSessionPhase] {
        let source = values.isEmpty && fallbackDuration > 0 ? ["진행": fallbackDuration] : values
        return source.map { AiSessionPhase(name: $0.key, milliseconds: $0.value) }
            .sorted { $0.milliseconds > $1.milliseconds }
    }

    private static func normalizedSummary(_ value: String?) -> String? {
        let oneLine = value?.split(whereSeparator: \Character.isWhitespace).joined(separator: " ") ?? ""
        guard !oneLine.isEmpty else { return nil }
        return String(oneLine.prefix(220))
    }

    private static func missingTranscriptMessage(for provider: AiSessionProvider) -> String {
        switch provider {
        case .claude:
            return "Claude 로그를 읽지 못했습니다. macOS 전체 디스크 접근 권한에서 TaskMasterRatko를 허용하면 진행·시간을 함께 표시합니다."
        case .codex:
            return "현재 프로세스에 연결된 Codex 대화 로그를 찾지 못했습니다."
        }
    }

    private static func capture(_ pattern: String, in value: String) -> String? {
        guard let expression = try? NSRegularExpression(pattern: pattern),
              let match = expression.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
              match.numberOfRanges > 1,
              let range = Range(match.range(at: 1), in: value)
        else { return nil }
        return String(value[range])
    }

    private static func modificationDate(_ url: URL) -> Date {
        if let date = try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate {
            return date
        }
        if let output = try? run("/usr/bin/stat", arguments: ["-f", "%m", url.path]),
           let seconds = TimeInterval(output.trimmingCharacters(in: .whitespacesAndNewlines)) {
            return Date(timeIntervalSince1970: seconds)
        }
        return .distantPast
    }

    private static func pathExists(_ path: String) -> Bool {
        FileManager.default.fileExists(atPath: path)
            || (try? run("/usr/bin/test", arguments: ["-f", path])) != nil
    }

    private static func run(_ executable: String, arguments: [String]) throws -> String {
        let data = try runData(executable, arguments: arguments)
        return String(data: data, encoding: .utf8) ?? ""
    }

    private static func runData(_ executable: String, arguments: [String]) throws -> Data {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let output = Pipe()
        process.standardOutput = output
        process.standardError = Pipe()
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw AiSessionScanError.commandFailed(executable) }
        return data
    }
}

enum AiSessionScanError: LocalizedError {
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .commandFailed(let command): "세션 확인 명령을 실행하지 못했습니다: \(command)"
        }
    }
}
