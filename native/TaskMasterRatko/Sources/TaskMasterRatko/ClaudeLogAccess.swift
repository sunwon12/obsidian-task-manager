import AppKit
import Foundation

@MainActor
enum ClaudeLogAccess {
    private struct BookmarkEntry: Codable {
        let cwd: String
        let data: Data
    }

    private static var retainedURLs: [String: URL]?

    static var authorizedProjectURLs: [String: URL] {
        if let retainedURLs { return retainedURLs }
        let restored = restoreBookmarks()
        retainedURLs = restored
        return restored
    }

    static func request(cwds: [String]) throws {
        var urls = authorizedProjectURLs
        for cwd in cwds where urls[cwd] == nil {
            let selected = try requestProject(cwd: cwd)
            _ = selected.startAccessingSecurityScopedResource()
            urls[cwd] = selected
            retainedURLs = urls
            try? persistBookmarks(urls)
        }
    }

    private static func requestProject(cwd: String) throws -> URL {
        let expected = projectURL(cwd: cwd)
        let panel = NSOpenPanel()
        panel.title = "Claude 대화 기록 연결 · \(URL(fileURLWithPath: cwd).lastPathComponent)"
        panel.message = "목록에서 아래 이름의 기록 폴더를 선택해 주세요. Ratko는 요청할 때만 읽습니다.\n\(expected.lastPathComponent)"
        panel.prompt = "이 폴더 연결"
        panel.directoryURL = expected.deletingLastPathComponent()
        panel.nameFieldStringValue = expected.lastPathComponent
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.showsHiddenFiles = true

        NSApplication.shared.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK else { throw ClaudeLogAccessError.cancelled }
        guard let selected = panel.url?.standardizedFileURL,
              selected.resolvingSymlinksInPath() == expected.resolvingSymlinksInPath()
        else { throw ClaudeLogAccessError.wrongFolder(expected.lastPathComponent) }
        return selected
    }

    private static func projectURL(cwd: String) -> URL {
        let encoded = cwd.replacingOccurrences(of: "/", with: "-")
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/projects/\(encoded)", isDirectory: true)
            .standardizedFileURL
    }

    private static var bookmarksURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/TaskMasterRatko", isDirectory: true)
            .appendingPathComponent("claude-project-logs.json")
    }

    private static func persistBookmarks(_ urls: [String: URL]) throws {
        try FileManager.default.createDirectory(
            at: bookmarksURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let entries = try urls.map { cwd, url in
            BookmarkEntry(
                cwd: cwd,
                data: try url.bookmarkData(options: [
                    .withSecurityScope,
                    .securityScopeAllowOnlyReadAccess,
                ])
            )
        }
        let data = try JSONEncoder().encode(entries)
        try data.write(to: bookmarksURL, options: .atomic)
    }

    private static func restoreBookmarks() -> [String: URL] {
        guard let data = try? Data(contentsOf: bookmarksURL),
              let entries = try? JSONDecoder().decode([BookmarkEntry].self, from: data)
        else { return [:] }

        var result: [String: URL] = [:]
        for entry in entries {
            var stale = false
            guard let url = try? URL(
                resolvingBookmarkData: entry.data,
                options: [.withSecurityScope],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            ), url.standardizedFileURL == projectURL(cwd: entry.cwd)
            else { continue }
            _ = url.startAccessingSecurityScopedResource()
            result[entry.cwd] = url
        }
        return result
    }
}

enum ClaudeLogAccessError: LocalizedError {
    case cancelled
    case wrongFolder(String)

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return "Claude 로그 폴더 연결을 취소했습니다."
        case .wrongFolder(let name):
            return "Claude 프로젝트 기록 폴더 \(name)을 선택해 주세요."
        }
    }
}
