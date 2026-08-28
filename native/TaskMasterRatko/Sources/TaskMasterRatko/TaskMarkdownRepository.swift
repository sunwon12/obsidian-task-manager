import Foundation

struct TaskMarkdownRepository {
    let vaultURL: URL
    let dataRoot: String
    var fileManager: FileManager = .default

    var tasksURL: URL { vaultURL.appendingPathComponent(dataRoot).appendingPathComponent("Tasks") }
    var timersURL: URL { vaultURL.appendingPathComponent(dataRoot).appendingPathComponent(".timers.json") }
    var boardURL: URL { vaultURL.appendingPathComponent(dataRoot).appendingPathComponent(".board.json") }

    func loadTasks() throws -> [TaskCard] {
        guard fileManager.fileExists(atPath: tasksURL.path) else { return [] }
        return try fileManager.contentsOfDirectory(
            at: tasksURL,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        )
        .filter { $0.pathExtension.lowercased() == "md" && $0.lastPathComponent != "_index.md" }
        .compactMap { try? parseTask(at: $0) }
        .sorted { $0.updatedAt > $1.updatedAt }
    }

    func parseTask(at url: URL) throws -> TaskCard {
        let document = try MarkdownDocument(contentsOf: url)
        guard document.string("type") == "task",
              let id = document.string("id"),
              id.hasPrefix("task_"),
              let statusValue = document.string("status"),
              let status = TaskStatus(rawValue: statusValue)
        else { throw RatkoError.invalidTask(url.path) }

        let numberedSteps = document.frontmatter.compactMap { line -> (Int, String)? in
            guard let separator = line.firstIndex(of: ":") else { return nil }
            let key = String(line[..<separator])
            guard key.hasPrefix("step"), !key.hasSuffix("Seconds"),
                  let index = Int(key.dropFirst(4)), index > 0
            else { return nil }
            let value = String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
            return (index, MarkdownDocument.decodeScalar(value))
        }.filter { !$0.1.isEmpty }.sorted { $0.0 < $1.0 }
        let steps = numberedSteps.map { $0.1 }
        let seconds = steps.indices.map { index in document.int("step\(index + 1)Seconds") ?? 0 }
        let rawCurrent = document.int("currentStep")
        let current = rawCurrent.flatMap { (1...steps.count).contains($0) ? $0 : nil }
        let heading = document.body.split(separator: "\n", omittingEmptySubsequences: false)
            .first { $0.hasPrefix("# ") }
            .map { String($0.dropFirst(2)).trimmingCharacters(in: .whitespaces) }
        return TaskCard(
            id: id,
            title: heading?.isEmpty == false ? heading! : "Untitled",
            status: status,
            url: url,
            steps: steps,
            currentStep: current,
            stepSeconds: seconds,
            actualMd: document.double("actualMd"),
            due: document.string("due"),
            jiraKey: document.string("jiraKey"),
            aiSessionKey: document.string("ratkoAiSessionKey"),
            updatedAt: document.string("updatedAt") ?? "",
            body: document.body
        )
    }

    @discardableResult
    func updateTask(
        _ task: TaskCard,
        status: TaskStatus? = nil,
        steps: [String]? = nil,
        currentStep: Int?? = nil,
        stepSeconds: [Int]? = nil,
        actualMd: Double?? = nil,
        body: String? = nil
    ) throws -> TaskCard {
        var document = try MarkdownDocument(contentsOf: task.url)
        if let status { document.set("status", raw: status.rawValue) }
        if let steps {
            document.setSteps(
                steps,
                currentStep: currentStep ?? task.currentStep,
                stepSeconds: stepSeconds ?? task.stepSeconds
            )
        } else {
            if let currentStep { document.setOptionalInt("currentStep", value: currentStep) }
            if let stepSeconds {
                document.setStepSeconds(stepSeconds, stepCount: task.steps.count)
            }
        }
        if let actualMd {
            if let value = actualMd {
                document.set("actualMd", raw: Self.number(value))
            } else {
                document.remove(keys: ["actualMd"])
            }
        }
        if let body { document.body = body }
        document.set("updatedAt", raw: Self.isoNow())
        try document.writeAtomically(to: task.url)
        return try parseTask(at: task.url)
    }

    func createTask(
        title: String,
        status: TaskStatus = .todo,
        jiraKey: String? = nil,
        aiSessionKey: String? = nil,
        steps: [String] = [],
        currentStep: Int? = nil,
        bodyDetails: String? = nil
    ) throws -> TaskCard {
        try fileManager.createDirectory(at: tasksURL, withIntermediateDirectories: true)
        let normalized = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let id = "task_\(Self.randomCrockford(length: 26))"
        let shortId = String(id.prefix("task_".count + 8))
        let safeTitle = normalized
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .prefix(100)
        let url = tasksURL.appendingPathComponent("\(safeTitle) - \(shortId).md")
        let now = Self.isoNow()
        var frontmatter = [
            "schemaVersion: 1",
            "id: \(id)",
            "type: task",
            "status: \(status.rawValue)",
            "project: null",
            "priority: null",
            "createdAt: \(now)",
        ]
        if let jiraKey { frontmatter.append("jiraKey: \(MarkdownDocument.encodeScalar(jiraKey))") }
        if let aiSessionKey {
            frontmatter.append("ratkoAiSessionKey: \(MarkdownDocument.encodeScalar(aiSessionKey))")
        }
        for (index, step) in steps.enumerated() {
            frontmatter.append("step\(index + 1): \(MarkdownDocument.encodeScalar(step))")
        }
        if !steps.isEmpty {
            frontmatter.append("currentStep: \(min(max(1, currentStep ?? 1), steps.count))")
        }
        frontmatter.append("updatedAt: \(now)")
        let details = bodyDetails?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let body = details.isEmpty ? "# \(normalized)" : "# \(normalized)\n\n\(details)"
        let text = "---\n\(frontmatter.joined(separator: "\n"))\n---\n\n\(body)\n"
        try text.write(to: url, atomically: true, encoding: .utf8)
        return try parseTask(at: url)
    }

    func loadTimers() throws -> [TimerRecord] {
        guard fileManager.fileExists(atPath: timersURL.path) else { return [] }
        return try JSONDecoder().decode(TimerFile.self, from: Data(contentsOf: timersURL)).timers
    }

    func saveTimers(_ timers: [TimerRecord]) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(TimerFile(timers: timers))
        try data.write(to: timersURL, options: .atomic)
    }

    func loadRatkoTaskOrder(tasks: [TaskCard]) throws -> RatkoTaskOrder {
        let board = try loadBoardObject()
        let ratko = board?["ratkoOrder"] as? [String: Any]
        let stored = RatkoTaskOrder(
            focusTaskIds: ratko?["focusTaskIds"] as? [String] ?? [],
            nextTaskIds: ratko?["nextTaskIds"] as? [String] ?? []
        )
        return reconcileRatkoTaskOrder(stored, board: board, tasks: tasks)
    }

    func saveRatkoTaskOrder(_ order: RatkoTaskOrder, tasks: [TaskCard]) throws {
        try fileManager.createDirectory(at: boardURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        var board = (try loadBoardObject()) ?? Self.emptyBoard()
        let reconciled = reconcileRatkoTaskOrder(order, board: board, tasks: tasks)
        board["ratkoOrder"] = [
            "focusTaskIds": reconciled.focusTaskIds,
            "nextTaskIds": reconciled.nextTaskIds,
        ]
        board["updatedAt"] = Self.isoNow()

        let previousColumns = board["columns"] as? [[String: Any]] ?? []
        let existingByStatus = Dictionary(uniqueKeysWithValues: previousColumns.compactMap { column -> (String, [String])? in
            guard let id = column["id"] as? String else { return nil }
            return (id, column["taskIds"] as? [String] ?? [])
        })
        let preferred = reconciled.focusTaskIds + reconciled.nextTaskIds
        board["columns"] = TaskStatus.allCases.map { status -> [String: Any] in
            let valid = Set(tasks.filter { $0.status == status }.map(\.id))
            let ordered = Self.unique(
                preferred.filter(valid.contains)
                    + (existingByStatus[status.rawValue] ?? []).filter(valid.contains)
                    + tasks.filter { $0.status == status }.map(\.id)
            )
            return [
                "id": status.rawValue,
                "title": Self.boardTitle(for: status),
                "taskIds": ordered,
            ]
        }

        let data = try JSONSerialization.data(withJSONObject: board, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: boardURL, options: .atomic)
    }

    func reconcileRatkoTaskOrder(
        _ stored: RatkoTaskOrder,
        board: [String: Any]?,
        tasks: [TaskCard]
    ) -> RatkoTaskOrder {
        let activeTasks = tasks.filter { $0.status != .done }
        let focusIds = Set(activeTasks.filter { $0.status == .doing }.map(\.id))
        let nextIds = Set(activeTasks.filter { $0.status != .doing }.map(\.id))
        let columns = board?["columns"] as? [[String: Any]] ?? []
        let columnIds = Dictionary(uniqueKeysWithValues: columns.compactMap { column -> (String, [String])? in
            guard let id = column["id"] as? String else { return nil }
            return (id, column["taskIds"] as? [String] ?? [])
        })
        let boardIds = [TaskStatus.doing, .inReview, .todo, .hold, .backlog]
            .flatMap { columnIds[$0.rawValue] ?? [] }
        let fallback = boardIds + activeTasks.map(\.id)
        return RatkoTaskOrder(
            focusTaskIds: Self.unique(stored.focusTaskIds.filter(focusIds.contains) + fallback.filter(focusIds.contains)),
            nextTaskIds: Self.unique(stored.nextTaskIds.filter(nextIds.contains) + fallback.filter(nextIds.contains))
        )
    }

    func appendMemo(to task: TaskCard, text: String, now: Date = Date()) throws -> TaskCard {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return task }
        let calendar = Calendar.current
        let date = String(format: "%04d-%02d-%02d", calendar.component(.year, from: now), calendar.component(.month, from: now), calendar.component(.day, from: now))
        let time = String(format: "%02d:%02d", calendar.component(.hour, from: now), calendar.component(.minute, from: now))
        let bulletLines = trimmed.split(separator: "\n", omittingEmptySubsequences: false).enumerated().map {
            $0.offset == 0 ? "- \(time) \($0.element)" : "  \($0.element)"
        }
        var body = task.body.trimmingCharacters(in: .whitespacesAndNewlines)
        if !body.contains("\n## 메모") {
            body += "\n\n## 메모\n\n### \(date)\n" + bulletLines.joined(separator: "\n") + "\n"
        } else if body.contains("### \(date)") {
            body += "\n" + bulletLines.joined(separator: "\n") + "\n"
        } else {
            body += "\n\n### \(date)\n" + bulletLines.joined(separator: "\n") + "\n"
        }
        return try updateTask(task, body: body)
    }

    static func isoNow() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private func loadBoardObject() throws -> [String: Any]? {
        guard fileManager.fileExists(atPath: boardURL.path) else { return nil }
        let value = try JSONSerialization.jsonObject(with: Data(contentsOf: boardURL))
        return value as? [String: Any]
    }

    private static func emptyBoard() -> [String: Any] {
        [
            "version": 1,
            "columns": TaskStatus.allCases.map { status in
                ["id": status.rawValue, "title": boardTitle(for: status), "taskIds": []] as [String: Any]
            },
            "updatedAt": isoNow(),
        ]
    }

    private static func boardTitle(for status: TaskStatus) -> String {
        switch status {
        case .backlog: "BACKLOG"
        case .hold: "HOLD"
        case .todo: "TODO"
        case .doing: "DOING"
        case .inReview: "IN REVIEW"
        case .done: "DONE"
        }
    }

    private static func unique(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        return ids.filter { seen.insert($0).inserted }
    }

    private static func number(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(value)
    }

    private static func randomCrockford(length: Int) -> String {
        let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
        return String((0..<length).map { _ in alphabet.randomElement()! })
    }
}

struct MarkdownDocument {
    var frontmatter: [String]
    var body: String

    init(contentsOf url: URL) throws {
        let raw = try String(contentsOf: url, encoding: .utf8).replacingOccurrences(of: "\r\n", with: "\n")
        let lines = raw.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard lines.first == "---", let closing = lines.dropFirst().firstIndex(of: "---") else {
            throw RatkoError.invalidTask(url.path)
        }
        frontmatter = Array(lines[1..<closing])
        body = Array(lines[(closing + 1)...]).joined(separator: "\n").trimmingCharacters(in: .newlines)
    }

    func raw(_ key: String) -> String? {
        frontmatter.firstMatch { line in
            guard let separator = line.firstIndex(of: ":"), line[..<separator] == key[...] else { return nil }
            return String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
        }
    }

    func string(_ key: String) -> String? {
        guard let raw = raw(key), raw != "null", raw != "~" else { return nil }
        return Self.decodeScalar(raw)
    }

    func int(_ key: String) -> Int? { raw(key).flatMap(Int.init) }
    func double(_ key: String) -> Double? { raw(key).flatMap(Double.init) }

    mutating func set(_ key: String, raw value: String) {
        let replacement = "\(key): \(value)"
        if let index = frontmatter.firstIndex(where: { $0.hasPrefix("\(key):") }) {
            frontmatter[index] = replacement
        } else if let updated = frontmatter.firstIndex(where: { $0.hasPrefix("updatedAt:") }) {
            frontmatter.insert(replacement, at: updated)
        } else {
            frontmatter.append(replacement)
        }
    }

    mutating func setOptionalInt(_ key: String, value: Int?) {
        if let value { set(key, raw: String(value)) } else { remove(keys: [key]) }
    }

    mutating func remove(keys: Set<String>) {
        frontmatter.removeAll { line in
            guard let separator = line.firstIndex(of: ":") else { return false }
            return keys.contains(String(line[..<separator]))
        }
    }

    mutating func setStepSeconds(_ values: [Int], stepCount: Int) {
        let keys = Set((1...max(stepCount, 1)).map { "step\($0)Seconds" })
        remove(keys: keys)
        for index in 0..<min(values.count, stepCount) where values[index] > 0 {
            set("step\(index + 1)Seconds", raw: String(values[index]))
        }
    }

    mutating func setSteps(_ steps: [String], currentStep: Int?, stepSeconds: [Int]) {
        let stepKeys = Set(frontmatter.compactMap { line -> String? in
            guard let separator = line.firstIndex(of: ":") else { return nil }
            let key = String(line[..<separator])
            let numeric = key.hasSuffix("Seconds")
                ? key.dropFirst(4).dropLast("Seconds".count)
                : key.dropFirst(4)[...]
            return key.hasPrefix("step") && Int(numeric) != nil ? key : nil
        } + ["currentStep"])
        remove(keys: stepKeys)
        for (index, step) in steps.enumerated() {
            set("step\(index + 1)", raw: Self.encodeScalar(step))
            if stepSeconds.indices.contains(index), stepSeconds[index] > 0 {
                set("step\(index + 1)Seconds", raw: String(stepSeconds[index]))
            }
        }
        if let currentStep, !steps.isEmpty {
            set("currentStep", raw: String(min(max(1, currentStep), steps.count)))
        }
    }

    func serialized() -> String {
        "---\n" + frontmatter.joined(separator: "\n") + "\n---\n\n" + body.trimmingCharacters(in: .newlines) + "\n"
    }

    func writeAtomically(to url: URL) throws {
        try serialized().write(to: url, atomically: true, encoding: .utf8)
    }

    static func decodeScalar(_ raw: String) -> String {
        let value = raw.trimmingCharacters(in: .whitespaces)
        if value.hasPrefix("\"") && value.hasSuffix("\""),
           let data = value.data(using: .utf8),
           let decoded = try? JSONDecoder().decode(String.self, from: data) {
            return decoded
        }
        if value.hasPrefix("'") && value.hasSuffix("'") {
            return String(value.dropFirst().dropLast()).replacingOccurrences(of: "''", with: "'")
        }
        return value
    }

    static func encodeScalar(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value), let encoded = String(data: data, encoding: .utf8) else {
            return "\"\(value)\""
        }
        return encoded
    }
}

private extension Array where Element == String {
    func firstMatch<T>(_ transform: (String) -> T?) -> T? {
        for element in self {
            if let result = transform(element) { return result }
        }
        return nil
    }
}
