import Foundation

struct RatkoConfiguration: Codable {
    let vaultPath: String
    var dataRoot: String = "TaskMaster"
    var aiFeedbackPath: String?
    var aiFeedbackBinary: String?
    var aiFeedbackPrompt: String?
    var aiFeedbackTimeoutMinutes: Int?
    var taskAiTimeoutMinutes: Int?
    var humanAiDailyBatchEnabled: Bool?
    var humanAiDailyBatchScheduleAt: String?
    var humanAiDailyBatchLookbackDays: Int?

    var vaultURL: URL {
        URL(fileURLWithPath: (vaultPath as NSString).expandingTildeInPath, isDirectory: true)
            .standardizedFileURL
    }

    var aiFeedbackPathResolved: String {
        nonEmpty(aiFeedbackPath) ?? "02_일상/03_성찰/일일-일정-피드백.md"
    }

    var aiFeedbackURL: URL {
        vaultURL.appendingPathComponent(aiFeedbackPathResolved)
    }

    var aiFeedbackBinaryResolved: String {
        if let configured = nonEmpty(aiFeedbackBinary) {
            return (configured as NSString).expandingTildeInPath
        }
        let localClaude = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".local/bin/claude").path
        return FileManager.default.isExecutableFile(atPath: localClaude) ? localClaude : "claude"
    }

    var aiFeedbackPromptResolved: String { nonEmpty(aiFeedbackPrompt) ?? "/daily-schedule-feedback" }

    var aiFeedbackTimeoutMinutesResolved: Int {
        min(60, max(1, aiFeedbackTimeoutMinutes ?? 10))
    }

    var taskAiTimeoutMinutesResolved: Int {
        min(30, max(1, taskAiTimeoutMinutes ?? 5))
    }

    var humanAiDailyBatchEnabledResolved: Bool { humanAiDailyBatchEnabled ?? true }

    var humanAiDailyBatchScheduleAtResolved: String {
        nonEmpty(humanAiDailyBatchScheduleAt) ?? "00:10"
    }

    var humanAiDailyBatchLookbackDaysResolved: Int {
        min(90, max(1, humanAiDailyBatchLookbackDays ?? 30))
    }

    static func load(
        arguments: [String] = CommandLine.arguments,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) throws -> RatkoConfiguration {
        if let index = arguments.firstIndex(of: "--vault"), arguments.indices.contains(index + 1) {
            return RatkoConfiguration(vaultPath: arguments[index + 1])
        }
        if let path = environment["RATKO_VAULT"], !path.isEmpty {
            return RatkoConfiguration(vaultPath: path)
        }

        let configURL = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/TaskMasterRatko/config.json")
        if fileManager.fileExists(atPath: configURL.path) {
            return try JSONDecoder().decode(
                RatkoConfiguration.self,
                from: Data(contentsOf: configURL)
            )
        }

        var candidate = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
        while candidate.path != "/" {
            if fileManager.fileExists(atPath: candidate.appendingPathComponent("TaskMaster/Tasks").path) {
                return RatkoConfiguration(vaultPath: candidate.path)
            }
            candidate.deleteLastPathComponent()
        }
        throw RatkoError.configurationMissing
    }
}

private func nonEmpty(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
}

enum RatkoError: LocalizedError {
    case configurationMissing
    case invalidTask(String)
    case taskNotFound(String)

    var errorDescription: String? {
        switch self {
        case .configurationMissing:
            return "Vault 경로가 없습니다. install-ratko.sh <vault-path>를 실행해 주세요."
        case .invalidTask(let path):
            return "Task 파일을 읽을 수 없습니다: \(path)"
        case .taskNotFound(let id):
            return "Task를 찾을 수 없습니다: \(id)"
        }
    }
}
