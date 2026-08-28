import Foundation

struct OrcaTerminalRecord: Decodable, Equatable {
    let handle: String
    let worktreePath: String
    let title: String
    let connected: Bool
    let lastOutputAt: Double?
    let preview: String
}

enum OrcaTerminalMatch: Equatable {
    case matched(String)
    case missing
    case ambiguous
}

enum OrcaTerminalMatcher {
    static func match(report: AiSessionReport, terminals: [OrcaTerminalRecord]) -> OrcaTerminalMatch {
        let reportPath = standardizedPath(report.cwd)
        let candidates = terminals.filter {
            $0.connected && standardizedPath($0.worktreePath) == reportPath
        }
        guard !candidates.isEmpty else { return .missing }
        guard candidates.count > 1 else { return .matched(candidates[0].handle) }

        if let sessionId = report.sessionKey?.split(separator: ":").last.map(String.init) {
            let exact = candidates.filter { terminalContext($0).contains(sessionId.lowercased()) }
            if exact.count == 1 { return .matched(exact[0].handle) }
        }

        let summaryTokens = meaningfulTokens(report.summary)
        let ranked = candidates.map { terminal in
            let overlap = summaryTokens.intersection(meaningfulTokens(terminalContext(terminal))).count
            let activityDelta = timeDelta(report: report, terminal: terminal)
            return (terminal: terminal, overlap: overlap, activityDelta: activityDelta)
        }.sorted {
            if $0.overlap != $1.overlap { return $0.overlap > $1.overlap }
            return $0.activityDelta < $1.activityDelta
        }

        if ranked[0].overlap >= 2, ranked[0].overlap > ranked[1].overlap {
            return .matched(ranked[0].terminal.handle)
        }
        if ranked[0].activityDelta <= 120_000,
           ranked[1].activityDelta - ranked[0].activityDelta >= 15_000 {
            return .matched(ranked[0].terminal.handle)
        }
        return .ambiguous
    }

    private static func standardizedPath(_ path: String) -> String {
        (path as NSString).standardizingPath
    }

    private static func terminalContext(_ terminal: OrcaTerminalRecord) -> String {
        "\(terminal.title) \(terminal.preview)".lowercased()
    }

    private static func meaningfulTokens(_ text: String) -> Set<String> {
        Set(text.lowercased().split { character in
            !character.isLetter && !character.isNumber
        }.map(String.init).filter { $0.count >= 3 })
    }

    private static func timeDelta(report: AiSessionReport, terminal: OrcaTerminalRecord) -> Double {
        guard let reportActivity = report.lastActivity, let terminalActivity = terminal.lastOutputAt else {
            return .greatestFiniteMagnitude
        }
        return abs(reportActivity.timeIntervalSince1970 * 1_000 - terminalActivity)
    }
}

enum OrcaTerminalOpenResult: Equatable {
    case success
    case failure(String)
}

enum OrcaTerminalNavigator {
    static func open(report: AiSessionReport) async -> OrcaTerminalOpenResult {
        await Task.detached(priority: .userInitiated) {
            openSynchronously(report: report)
        }.value
    }

    static func openSynchronously(
        report: AiSessionReport,
        executableURL: URL? = executableURL()
    ) -> OrcaTerminalOpenResult {
        guard let executableURL else {
            return .failure("Orca CLI를 찾지 못했습니다. Orca가 설치되어 있는지 확인해 주세요.")
        }
        do {
            let listData = try run(
                executableURL,
                arguments: ["terminal", "list", "--limit", "200", "--json"]
            )
            let response = try JSONDecoder().decode(TerminalListResponse.self, from: listData)
            guard response.ok, let terminals = response.result?.terminals else {
                return .failure(response.error?.message ?? "Orca 터미널 목록을 읽지 못했습니다.")
            }
            switch OrcaTerminalMatcher.match(report: report, terminals: terminals) {
            case .missing:
                return .failure("이 작업 폴더의 Orca 터미널을 찾지 못했습니다.")
            case .ambiguous:
                return .failure("같은 폴더의 Orca 터미널이 여러 개라 해당 세션을 확정하지 못했습니다.")
            case .matched(let handle):
                let switchData = try run(
                    executableURL,
                    arguments: ["terminal", "switch", "--terminal", handle, "--json"]
                )
                let switchResponse = try JSONDecoder().decode(CommandResponse.self, from: switchData)
                guard switchResponse.ok else {
                    return .failure(switchResponse.error?.message ?? "Orca 세션을 열지 못했습니다.")
                }
                return .success
            }
        } catch {
            return .failure("Orca 세션을 열지 못했습니다. \(error.localizedDescription)")
        }
    }

    private static func executableURL() -> URL? {
        let candidates = [
            "/usr/local/bin/orca",
            "/Applications/Orca.app/Contents/Resources/bin/orca",
            "/opt/homebrew/bin/orca",
        ]
        return candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) })
            .map { URL(fileURLWithPath: $0) }
    }

    private static func run(_ executableURL: URL, arguments: [String]) throws -> Data {
        let process = Process()
        let fileManager = FileManager.default
        let outputURL = fileManager.temporaryDirectory
            .appendingPathComponent("ratko-orca-stdout-\(UUID().uuidString)")
        let errorURL = fileManager.temporaryDirectory
            .appendingPathComponent("ratko-orca-stderr-\(UUID().uuidString)")
        guard fileManager.createFile(atPath: outputURL.path, contents: nil),
              fileManager.createFile(atPath: errorURL.path, contents: nil)
        else {
            throw OrcaTerminalNavigatorError.commandFailed("Orca CLI 출력 파일을 만들지 못했습니다.")
        }
        defer {
            try? fileManager.removeItem(at: outputURL)
            try? fileManager.removeItem(at: errorURL)
        }
        let stdout = try FileHandle(forWritingTo: outputURL)
        let stderr = try FileHandle(forWritingTo: errorURL)
        defer {
            try? stdout.close()
            try? stderr.close()
        }
        process.executableURL = executableURL
        process.arguments = arguments
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()
        process.waitUntilExit()
        try stdout.close()
        try stderr.close()
        let output = try Data(contentsOf: outputURL)
        let errorData = try Data(contentsOf: errorURL)
        guard process.terminationStatus == 0 else {
            let message = String(data: errorData.isEmpty ? output : errorData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw OrcaTerminalNavigatorError.commandFailed(message ?? "exit \(process.terminationStatus)")
        }
        return output
    }

    private struct TerminalListResponse: Decodable {
        let ok: Bool
        let result: TerminalListResult?
        let error: CommandError?
    }

    private struct TerminalListResult: Decodable {
        let terminals: [OrcaTerminalRecord]
    }

    private struct CommandResponse: Decodable {
        let ok: Bool
        let error: CommandError?
    }

    private struct CommandError: Decodable {
        let message: String
    }
}

private enum OrcaTerminalNavigatorError: LocalizedError {
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .commandFailed(let message): message
        }
    }
}
