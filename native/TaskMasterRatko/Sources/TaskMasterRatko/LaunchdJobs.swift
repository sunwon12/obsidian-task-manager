import Foundation

enum LaunchdJobHealth: String, CaseIterable, Sendable {
    case retrying
    case failed
    case running
    case waiting
    case unloaded

    var label: String {
        switch self {
        case .retrying: "재시도 중"
        case .failed: "실패"
        case .running: "실행 중"
        case .waiting: "대기 중"
        case .unloaded: "미등록"
        }
    }

    var sortOrder: Int {
        switch self {
        case .retrying: 0
        case .failed: 1
        case .running: 2
        case .waiting: 3
        case .unloaded: 4
        }
    }

    var isProblem: Bool { self == .retrying || self == .failed }
}

struct LaunchdJob: Identifiable, Equatable, Sendable {
    let label: String
    let plistURL: URL
    let command: String
    let schedule: String
    let standardOutPath: String?
    let standardErrorPath: String?
    let keepAlive: Bool
    let loaded: Bool
    let state: String?
    let pid: Int?
    let runCount: Int?
    let lastExitCode: Int?
    let lastTerminatingSignal: String?

    var id: String { label }
    var displayName: String { LaunchdJobNaming.displayName(for: label) }

    var health: LaunchdJobHealth {
        guard loaded else { return .unloaded }
        if state == "running" { return .running }
        if state == "spawn scheduled" || (keepAlive && lastExitCode.map { $0 != 0 } == true) {
            return .retrying
        }
        if lastExitCode.map({ $0 != 0 }) == true { return .failed }
        return .waiting
    }

    var lastResult: String {
        if let lastExitCode { return "종료 코드 \(lastExitCode)" }
        if let lastTerminatingSignal { return lastTerminatingSignal }
        return "종료 이력 없음"
    }
}

enum LaunchdJobNaming {
    private static let names: [String: String] = [
        "com.29gallerybot": "29갤러리 봇",
        "com.biz-e-cnc.admin-ui": "CNC 관리자 화면",
        "com.biz-e-cnc.documentation-draft-daily": "CNC 문의 지식 문서 초안",
        "com.biz-e-cnc.knowledge-curator": "CNC 문의 지식 선별",
        "com.biz-e-cnc.slack-bot": "CNC Slack 봇",
        "com.biz-e-cnc.team-ticket-daily": "CNC 팀 티켓 일일 점검",
        "com.claude.daily-report": "일일 업무 보고서",
        "com.claude.pr-review-watch": "PR 리뷰 답글 점검",
        "com.claude.sbi-logger": "SBI 업무 로그 기록",
        "com.claude.sprint-report": "스프린트 주간 보고서",
        "com.community-be-bot": "커뮤니티 BE Slack 봇",
        "com.sunwon.claude-telegram": "Claude 텔레그램 봇",
        "com.sunwon.daily-schedule-feedback": "일일 일정 피드백",
        "com.taskmaster.ratko": "랏코 자동 시작",
        "net.pulsesecure.SetupClient": "Pulse Secure 설정 클라이언트",
    ]

    private static let cookieProxyNames: [String: String] = [
        "confluence": "Confluence 쿠키 프록시",
        "grafana": "Grafana 쿠키 프록시",
        "jira": "Jira 쿠키 프록시",
        "kafka-ui": "Kafka UI 쿠키 프록시",
        "sdui-prd": "SDUI 운영 쿠키 프록시",
        "sdui-qa": "SDUI QA 쿠키 프록시",
    ]

    static func displayName(for label: String) -> String {
        if let name = names[label] { return name }
        let cookiePrefix = "com.sunwon.cookie-proxy."
        if label.hasPrefix(cookiePrefix) {
            let service = String(label.dropFirst(cookiePrefix.count))
            return cookieProxyNames[service] ?? "\(readableWords(service)) 쿠키 프록시"
        }
        let components = label.split(separator: ".").map(String.init)
        let meaningful = components.drop { ["com", "net", "org", "io", "dev"].contains($0.lowercased()) }
        return readableWords(meaningful.joined(separator: " "))
    }

    private static func readableWords(_ value: String) -> String {
        value
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { word in
                switch word.lowercased() {
                case "admin": "관리자"
                case "daily": "일일"
                case "report": "보고서"
                case "bot": "봇"
                case "logger": "로그 기록"
                case "setup": "설정"
                case "client": "클라이언트"
                default: String(word)
                }
            }
            .joined(separator: " ")
    }
}

struct LaunchdJobDefinition: Sendable {
    let label: String
    let plistURL: URL
    let command: String
    let schedule: String
    let standardOutPath: String?
    let standardErrorPath: String?
    let keepAlive: Bool
}

struct LaunchdRuntime: Equatable, Sendable {
    let loaded: Bool
    let state: String?
    let pid: Int?
    let runCount: Int?
    let lastExitCode: Int?
    let lastTerminatingSignal: String?
}

enum LaunchdRuntimeParser {
    static func parse(_ output: String, loaded: Bool) -> LaunchdRuntime {
        LaunchdRuntime(
            loaded: loaded,
            state: stringValue("state", in: output),
            pid: integerValue("pid", in: output),
            runCount: integerValue("runs", in: output),
            lastExitCode: integerValue("last exit code", in: output),
            lastTerminatingSignal: stringValue("last terminating signal", in: output)
        )
    }

    private static func stringValue(_ key: String, in output: String) -> String? {
        let prefix = "\(key) = "
        return output.split(separator: "\n").lazy
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { $0.hasPrefix(prefix) }
            .map { String($0.dropFirst(prefix.count)) }
    }

    private static func integerValue(_ key: String, in output: String) -> Int? {
        guard let value = stringValue(key, in: output) else { return nil }
        return Int(value)
    }
}

struct LaunchdInspector: Sendable {
    let homeURL: URL
    let userID: UInt32

    init(
        homeURL: URL = FileManager.default.homeDirectoryForCurrentUser,
        userID: UInt32 = getuid()
    ) {
        self.homeURL = homeURL
        self.userID = userID
    }

    func inspect() throws -> [LaunchdJob] {
        let launchAgentsURL = homeURL.appendingPathComponent("Library/LaunchAgents", isDirectory: true)
        let plistURLs = try FileManager.default.contentsOfDirectory(
            at: launchAgentsURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        return try plistURLs
            .filter { $0.pathExtension == "plist" }
            .compactMap { try definition(at: $0) }
            .map { definition in
                let runtime = runtime(for: definition.label)
                return LaunchdJob(
                    label: definition.label,
                    plistURL: definition.plistURL,
                    command: definition.command,
                    schedule: definition.schedule,
                    standardOutPath: definition.standardOutPath,
                    standardErrorPath: definition.standardErrorPath,
                    keepAlive: definition.keepAlive,
                    loaded: runtime.loaded,
                    state: runtime.state,
                    pid: runtime.pid,
                    runCount: runtime.runCount,
                    lastExitCode: runtime.lastExitCode,
                    lastTerminatingSignal: runtime.lastTerminatingSignal
                )
            }
            .sorted {
                if $0.health.sortOrder != $1.health.sortOrder {
                    return $0.health.sortOrder < $1.health.sortOrder
                }
                return $0.label.localizedStandardCompare($1.label) == .orderedAscending
            }
    }

    func definition(at plistURL: URL) throws -> LaunchdJobDefinition? {
        let data = try Data(contentsOf: plistURL)
        guard let plist = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let label = plist["Label"] as? String,
              !label.isEmpty
        else { return nil }
        let arguments = plist["ProgramArguments"] as? [String]
        let program = plist["Program"] as? String
        let command = arguments?.joined(separator: " ") ?? program ?? "명령 정보 없음"
        return LaunchdJobDefinition(
            label: label,
            plistURL: plistURL,
            command: command,
            schedule: Self.scheduleDescription(plist),
            standardOutPath: plist["StandardOutPath"] as? String,
            standardErrorPath: plist["StandardErrorPath"] as? String,
            keepAlive: Self.isEnabled(plist["KeepAlive"])
        )
    }

    private func runtime(for label: String) -> LaunchdRuntime {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["print", "gui/\(userID)/\(label)"]
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(decoding: data, as: UTF8.self)
            return LaunchdRuntimeParser.parse(output, loaded: process.terminationStatus == 0)
        } catch {
            return LaunchdRuntimeParser.parse("", loaded: false)
        }
    }

    static func scheduleDescription(_ plist: [String: Any]) -> String {
        var descriptions: [String] = []
        if isEnabled(plist["KeepAlive"]) { descriptions.append("상시 유지") }
        if plist["RunAtLoad"] as? Bool == true, descriptions.isEmpty { descriptions.append("로그인할 때") }
        if let seconds = plist["StartInterval"] as? Int {
            descriptions.append(intervalDescription(seconds))
        }
        if let calendar = plist["StartCalendarInterval"] as? [String: Any] {
            descriptions.append(calendarDescription(calendar))
        } else if let calendars = plist["StartCalendarInterval"] as? [[String: Any]] {
            descriptions.append(contentsOf: calendars.map(calendarDescription))
        }
        if plist["WatchPaths"] != nil { descriptions.append("파일 변경 시") }
        if plist["QueueDirectories"] != nil { descriptions.append("대기 파일이 있을 때") }
        return descriptions.isEmpty ? "수동 실행" : descriptions.joined(separator: " · ")
    }

    private static func isEnabled(_ value: Any?) -> Bool {
        if let value = value as? Bool { return value }
        if let value = value as? [String: Any] { return !value.isEmpty }
        return false
    }

    private static func intervalDescription(_ seconds: Int) -> String {
        if seconds >= 3_600, seconds.isMultiple(of: 3_600) { return "매 \(seconds / 3_600)시간" }
        if seconds >= 60, seconds.isMultiple(of: 60) { return "매 \(seconds / 60)분" }
        return "매 \(seconds)초"
    }

    private static func calendarDescription(_ calendar: [String: Any]) -> String {
        let hour = calendar["Hour"] as? Int
        let minute = calendar["Minute"] as? Int ?? 0
        let time = hour.map { String(format: "%02d:%02d", $0, minute) }
        if let weekday = calendar["Weekday"] as? Int {
            let names = ["일", "월", "화", "수", "목", "금", "토"]
            let normalized = weekday == 7 ? 0 : weekday
            let day = names.indices.contains(normalized) ? names[normalized] : "요일 \(weekday)"
            return time.map { "매주 \(day) \($0)" } ?? "매주 \(day)"
        }
        if let day = calendar["Day"] as? Int {
            return time.map { "매월 \(day)일 \($0)" } ?? "매월 \(day)일"
        }
        return time.map { "매일 \($0)" } ?? "달력 일정"
    }
}

enum LaunchdJobsScanState: Equatable {
    case idle
    case running
    case error(String)
}

private enum LaunchdInspectionResult: Sendable {
    case success([LaunchdJob])
    case failure(String)
}

@MainActor
final class LaunchdJobsStore: ObservableObject {
    @Published private(set) var jobs: [LaunchdJob] = []
    @Published private(set) var scanState: LaunchdJobsScanState = .idle
    @Published private(set) var lastScannedAt: Date?

    private let inspector: LaunchdInspector

    init(inspector: LaunchdInspector = LaunchdInspector()) {
        self.inspector = inspector
    }

    var runningCount: Int { jobs.filter { $0.health == .running }.count }
    var waitingCount: Int { jobs.filter { $0.health == .waiting }.count }
    var problemCount: Int { jobs.filter { $0.health.isProblem }.count }
    var unloadedCount: Int { jobs.filter { $0.health == .unloaded }.count }

    func refreshIfNeeded() {
        guard lastScannedAt == nil else { return }
        refresh()
    }

    func refresh() {
        guard scanState != .running else { return }
        scanState = .running
        let inspector = inspector
        Task { [weak self] in
            let result = await Task.detached(priority: .utility) {
                do {
                    return LaunchdInspectionResult.success(try inspector.inspect())
                } catch {
                    return LaunchdInspectionResult.failure(error.localizedDescription)
                }
            }.value
            guard let self else { return }
            switch result {
            case .success(let jobs):
                self.jobs = jobs
                self.lastScannedAt = Date()
                self.scanState = .idle
            case .failure(let message):
                self.scanState = .error(message)
            }
        }
    }
}
