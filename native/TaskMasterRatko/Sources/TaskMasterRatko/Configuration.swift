import Foundation

struct RatkoConfiguration: Codable {
    let vaultPath: String
    var dataRoot: String = "TaskMaster"

    var vaultURL: URL {
        URL(fileURLWithPath: (vaultPath as NSString).expandingTildeInPath, isDirectory: true)
            .standardizedFileURL
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
