import Foundation

struct AiFeedbackBullet: Equatable, Identifiable {
    var id: String { "\(lead)\u{0}\(body)" }
    let lead: String
    let body: String
}

struct AiFeedback: Equatable {
    let date: String
    let weekday: String
    let snapshot: String
    let bullets: [AiFeedbackBullet]
    let highlight: String
}

enum AiFeedbackRunState: Equatable {
    case idle
    case running
    case error(String)
}

enum AiFeedbackParser {
    private static let sectionPattern = #"^##\s+(\d{4}-\d{2}-\d{2})(?:\s*\(([^)]*)\))?\s*$"#
    private static let bulletPattern = #"^\s*[-*]\s+(.*)$"#
    private static let bulletLeadPattern = #"^\*\*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$"#

    static func parse(_ markdown: String?) -> AiFeedback? {
        guard let markdown, !markdown.isEmpty else { return nil }
        let lines = markdown.components(separatedBy: .newlines)
        guard let start = lines.firstIndex(where: { groups(sectionPattern, in: $0) != nil }),
              let heading = groups(sectionPattern, in: lines[start])
        else { return nil }
        let end = lines.indices.first(where: { $0 > start && lines[$0].hasPrefix("## ") }) ?? lines.endIndex

        var bullets: [AiFeedbackBullet] = []
        var paragraphs: [String] = []
        var buffer: [String] = []
        var sawBullet = false

        func flush() {
            let text = buffer.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
            buffer.removeAll(keepingCapacity: true)
            if !text.isEmpty, text != "---" { paragraphs.append(text) }
        }

        for line in lines[(start + 1)..<end] {
            if let bullet = groups(bulletPattern, in: line)?.first {
                flush()
                sawBullet = true
                bullets.append(parseBullet(bullet))
                continue
            }
            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                flush()
                continue
            }
            if sawBullet, buffer.isEmpty, line.hasPrefix("  "), !bullets.isEmpty {
                let continuation = line.trimmingCharacters(in: .whitespacesAndNewlines)
                let last = bullets.removeLast()
                bullets.append(AiFeedbackBullet(
                    lead: last.lead,
                    body: "\(last.body) \(continuation)".trimmingCharacters(in: .whitespaces)
                ))
                continue
            }
            buffer.append(line.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        flush()

        let snapshotRaw = labelledParagraph("스냅샷", in: paragraphs) ?? paragraphs.first ?? ""
        let highlightRaw = labelledParagraph("하이라이트", in: paragraphs)
            ?? (paragraphs.count > 1 ? paragraphs.last ?? "" : "")
        let snapshot = snapshotRaw == highlightRaw && paragraphs.count < 2 ? "" : stripMarkdown(snapshotRaw)

        return AiFeedback(
            date: heading.first ?? "",
            weekday: heading.count > 1 ? heading[1].trimmingCharacters(in: .whitespaces) : "",
            snapshot: snapshot,
            bullets: bullets,
            highlight: stripMarkdown(highlightRaw)
        )
    }

    private static func parseBullet(_ raw: String) -> AiFeedbackBullet {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let match = groups(bulletLeadPattern, in: trimmed) else {
            return AiFeedbackBullet(lead: "", body: stripMarkdown(trimmed))
        }
        return AiFeedbackBullet(
            lead: stripMarkdown(match.first ?? ""),
            body: stripMarkdown(match.count > 1 ? match[1] : "")
        )
    }

    private static func labelledParagraph(_ label: String, in paragraphs: [String]) -> String? {
        guard let paragraph = paragraphs.first(where: { $0.hasPrefix("**") && $0.contains(label) }) else {
            return nil
        }
        return replacing(#"^\*\*[^*]*\*\*\s*(?:[—–-]\s*)?"#, in: paragraph, with: "")
    }

    private static func stripMarkdown(_ value: String) -> String {
        var result = value
        result = replacing(#"\*\*(.+?)\*\*"#, in: result, with: "$1")
        result = replacing(#"\*([^*\n]+)\*"#, in: result, with: "$1")
        result = replacing(#"`([^`]+)`"#, in: result, with: "$1")
        result = replacing(#"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]"#, in: result, with: "$1")
        result = replacing(#"\s+"#, in: result, with: " ")
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func groups(_ pattern: String, in value: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(
                in: value,
                range: NSRange(value.startIndex..<value.endIndex, in: value)
              ),
              match.range.location != NSNotFound
        else { return nil }
        return (1..<match.numberOfRanges).map { index in
            let range = match.range(at: index)
            guard range.location != NSNotFound, let swiftRange = Range(range, in: value) else { return "" }
            return String(value[swiftRange])
        }
    }

    private static func replacing(_ pattern: String, in value: String, with replacement: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]) else {
            return value
        }
        return regex.stringByReplacingMatches(
            in: value,
            range: NSRange(value.startIndex..<value.endIndex, in: value),
            withTemplate: replacement
        )
    }
}

struct AiFeedbackRunResult {
    let succeeded: Bool
    let message: String
}

enum AiFeedbackRunner {
    static func run(configuration: RatkoConfiguration) async -> AiFeedbackRunResult {
        await Task.detached(priority: .utility) {
            runSynchronously(configuration: configuration)
        }.value
    }

    private static func runSynchronously(configuration: RatkoConfiguration) -> AiFeedbackRunResult {
        let process = Process()
        let binary = configuration.aiFeedbackBinaryResolved
        if binary.hasPrefix("/") {
            process.executableURL = URL(fileURLWithPath: binary)
            process.arguments = feedbackArguments(configuration)
        } else {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = [binary] + feedbackArguments(configuration)
        }
        process.currentDirectoryURL = configuration.vaultURL
        var environment = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let preferredPath = "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        environment["PATH"] = "\(preferredPath):\(environment["PATH"] ?? "")"
        process.environment = environment

        let logURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/TaskMasterRatko/ai-feedback-run.log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let logHandle: FileHandle
        do {
            logHandle = try FileHandle(forWritingTo: logURL)
        } catch {
            return AiFeedbackRunResult(succeeded: false, message: error.localizedDescription)
        }
        process.standardOutput = logHandle
        process.standardError = logHandle

        do {
            try process.run()
        } catch {
            try? logHandle.close()
            return AiFeedbackRunResult(succeeded: false, message: error.localizedDescription)
        }

        let timeoutSeconds = TimeInterval(configuration.aiFeedbackTimeoutMinutesResolved * 60)
        let timeout = LockedFlag()
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeoutSeconds) {
            guard process.isRunning else { return }
            timeout.set()
            process.terminate()
        }
        process.waitUntilExit()
        try? logHandle.close()

        if timeout.value {
            return AiFeedbackRunResult(succeeded: false, message: "AI 피드백 생성 시간이 제한을 넘었습니다.")
        }
        guard process.terminationStatus == 0 else {
            return AiFeedbackRunResult(
                succeeded: false,
                message: lastLogLine(at: logURL) ?? "claude 종료 코드 \(process.terminationStatus)"
            )
        }
        return AiFeedbackRunResult(succeeded: true, message: "")
    }

    private static func feedbackArguments(_ configuration: RatkoConfiguration) -> [String] {
        [
            "-p", configuration.aiFeedbackPromptResolved,
            "--permission-mode", "acceptEdits",
        ]
    }

    private static func lastLogLine(at url: URL) -> String? {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return text.split(whereSeparator: \Character.isNewline).last.map { String($0.prefix(200)) }
    }
}

private final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var stored = false

    var value: Bool {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func set() {
        lock.lock()
        stored = true
        lock.unlock()
    }
}
