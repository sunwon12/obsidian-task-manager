import Foundation

struct TaskAiMessage: Identifiable, Equatable {
    enum Role: String {
        case user
        case assistant
    }

    let id = UUID()
    let role: Role
    let text: String
}

struct TaskAiProposal: Equatable {
    let reply: String
    let steps: [String]?
    let memo: String?
    let body: String?

    var hasChanges: Bool {
        steps != nil || memo != nil || body != nil
    }
}

struct RemappedStepState: Equatable {
    let milliseconds: [Double]
    let currentStep: Int?
}

/// AI가 단계 이름·순서를 제안해도 이미 측정한 시간은 가능한 한 같은 국면에 붙여 둔다.
/// 동일 문자열을 먼저 찾고, 이름만 바뀐 항목은 같은 index를 rename으로 보며, 새 항목만 0초다.
func remapStepState(
    oldSteps: [String],
    newSteps: [String],
    oldMilliseconds: [Double],
    currentStep: Int?
) -> RemappedStepState {
    guard !newSteps.isEmpty else { return RemappedStepState(milliseconds: [], currentStep: nil) }

    var usedOld = Set<Int>()
    var sourceByNew: [Int?] = Array(repeating: nil, count: newSteps.count)

    for newIndex in newSteps.indices {
        if let oldIndex = oldSteps.indices.first(where: {
            !usedOld.contains($0) && oldSteps[$0] == newSteps[newIndex]
        }) {
            sourceByNew[newIndex] = oldIndex
            usedOld.insert(oldIndex)
        }
    }

    for newIndex in newSteps.indices where sourceByNew[newIndex] == nil {
        if oldSteps.indices.contains(newIndex), !usedOld.contains(newIndex) {
            sourceByNew[newIndex] = newIndex
            usedOld.insert(newIndex)
        } else if let oldIndex = oldSteps.indices.first(where: { !usedOld.contains($0) }) {
            sourceByNew[newIndex] = oldIndex
            usedOld.insert(oldIndex)
        }
    }

    let milliseconds = sourceByNew.map { source in
        guard let source, oldMilliseconds.indices.contains(source) else { return 0.0 }
        return oldMilliseconds[source]
    }

    let mappedCurrent: Int?
    if let currentStep, oldSteps.indices.contains(currentStep - 1) {
        let oldIndex = currentStep - 1
        if let newIndex = sourceByNew.firstIndex(where: { $0 == oldIndex }) {
            mappedCurrent = newIndex + 1
        } else {
            mappedCurrent = min(currentStep, newSteps.count)
        }
    } else {
        mappedCurrent = newSteps.isEmpty ? nil : 1
    }

    return RemappedStepState(milliseconds: milliseconds, currentStep: mappedCurrent)
}

enum TaskAiPrompt {
    static func build(task: TaskCard, messages: [TaskAiMessage]) -> String {
        let steps = task.steps.isEmpty
            ? "(없음)"
            : task.steps.enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: "\n")
        let conversation = messages.suffix(12).map { message in
            "\(message.role == .user ? "사용자" : "AI"): \(message.text)"
        }.joined(separator: "\n")

        return """
        너는 TaskMaster 랏코에서 **태스크 하나만 전담하는 AI 대화 상대**다.
        아래 태스크를 이미 알고 있는 상태로 사용자의 질문에 답한다. 필요하면 vault를 읽어 근거를 찾되,
        파일은 직접 수정하지 않는다. 수정 제안은 JSON 필드로만 반환하고 실제 적용은 랏코가 맡는다.

        ## 현재 태스크
        id: \(task.id)
        파일: \(task.url.path)
        제목: \(task.title)
        상태: \(task.status.rawValue)
        현재 단계: \(task.currentStep.map(String.init) ?? "없음")
        단계:
        \(steps)

        본문:
        <task-body>
        \(task.body)
        </task-body>

        ## 대화
        \(conversation.isEmpty ? "(첫 대화)" : conversation)

        ## 단계 규칙
        - 단계는 세부 체크리스트나 작업 지시서가 아니다. 인간이 생각·판단한 시간과 AI 실행 시간을
          분리하고 현재 국면을 알아차리기 위한 측정 단위다.
        - `[인간] 설계`, `[AI] 구현`, `[인간] 검증`처럼 실행 주체와 짧은 국면만 쓴다.
        - 방법·산출물·파일명·세부 절차를 단계명에 넣지 않는다.
        - 실행 주체가 바뀌거나 따로 측정할 큰 국면이 바뀔 때만 나눈다. 고정 개수나 첫 단계 규칙은 없다.

        ## 변경 제안 규칙
        - 질문에 답만 하면 `steps`, `memo`, `body`를 모두 null로 둔다.
        - 단계 생성·수정을 요청받으면 전체 단계 배열을 `steps`에 제안한다.
        - 메모 추가를 요청받으면 실제로 덧붙일 문구만 `memo`에 제안한다.
        - 본문 수정을 명시적으로 요청받았을 때만, 제목 heading과 기존 메모를 보존한 전체 본문을 `body`에 제안한다.
        - 변경을 이미 적용했다고 말하지 않는다. 사용자가 랏코에서 검토 후 적용한다.

        JSON 객체 하나만 출력한다. 코드펜스와 앞뒤 설명은 붙이지 않는다.
        {
          "reply": "사용자에게 보여줄 짧고 구체적인 답변",
          "steps": ["[인간] 설계", "[AI] 구현", "[인간] 검증"] 또는 null,
          "memo": "추가할 메모" 또는 null,
          "body": "교체할 전체 본문" 또는 null
        }
        """
    }
}

enum TaskAiResponseParser {
    static func parse(_ stdout: String) throws -> TaskAiProposal {
        let trimmed = stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw TaskAiError.invalidResponse("AI 응답이 비어 있습니다.") }

        let outer = jsonObject(in: trimmed)
        if let outer, outer["is_error"] as? Bool == true {
            throw TaskAiError.invalidResponse(oneLine(outer["result"] as? String ?? "AI 실행 오류"))
        }

        let inner = outer?["result"] as? String ?? trimmed
        guard let payload = jsonObject(in: inner) ?? directProposalObject(outer) else {
            throw TaskAiError.invalidResponse("AI 응답에서 JSON 제안을 찾지 못했습니다.")
        }

        let rawSteps = payload["steps"] as? [Any]
        let steps: [String]?
        if let rawSteps {
            let normalized = rawSteps.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            guard normalized.count <= 7 else {
                throw TaskAiError.invalidResponse("AI가 단계를 너무 잘게 나눴습니다. 다시 요청해 주세요.")
            }
            guard normalized.allSatisfy(isOwnedMeasurementStep) else {
                throw TaskAiError.invalidResponse("AI 단계에 [인간] 또는 [AI] 실행 주체가 빠졌습니다. 다시 요청해 주세요.")
            }
            steps = normalized
        } else {
            steps = nil
        }

        let memo = nonEmptyString(payload["memo"])
        let body = nonEmptyString(payload["body"])
        let fallback = steps != nil || memo != nil || body != nil ? "변경안을 준비했습니다." : "답변을 만들었습니다."
        let reply = nonEmptyString(payload["reply"]) ?? fallback
        return TaskAiProposal(reply: reply, steps: steps, memo: memo, body: body)
    }

    private static func isOwnedMeasurementStep(_ value: String) -> Bool {
        value.range(of: #"^\s*\[(인간|AI)\]\s+\S"#, options: .regularExpression) != nil
    }

    private static func nonEmptyString(_ value: Any?) -> String? {
        guard let string = value as? String else { return nil }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func directProposalObject(_ object: [String: Any]?) -> [String: Any]? {
        guard let object, object["reply"] != nil || object["steps"] != nil || object["memo"] != nil || object["body"] != nil else {
            return nil
        }
        return object
    }

    private static func jsonObject(in text: String) -> [String: Any]? {
        for candidate in [fencedBody(text), balancedObject(text)].compactMap({ $0 }) {
            guard let data = candidate.data(using: .utf8),
                  let value = try? JSONSerialization.jsonObject(with: data),
                  let object = value as? [String: Any]
            else { continue }
            return object
        }
        return nil
    }

    private static func fencedBody(_ text: String) -> String? {
        guard let start = text.range(of: "```") else { return nil }
        let afterFence = text[start.upperBound...]
        guard let end = afterFence.range(of: "```") else { return nil }
        var body = String(afterFence[..<end.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        if body.hasPrefix("json") { body = String(body.dropFirst(4)).trimmingCharacters(in: .whitespacesAndNewlines) }
        return balancedObject(body)
    }

    private static func balancedObject(_ text: String) -> String? {
        guard let start = text.firstIndex(of: "{") else { return nil }
        var depth = 0
        var inString = false
        var escaped = false
        var index = start
        while index < text.endIndex {
            let character = text[index]
            if escaped {
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == "\"" {
                inString.toggle()
            } else if !inString {
                if character == "{" { depth += 1 }
                if character == "}" {
                    depth -= 1
                    if depth == 0 { return String(text[start...index]) }
                }
            }
            index = text.index(after: index)
        }
        return nil
    }

    private static func oneLine(_ value: String) -> String {
        String(value.split(whereSeparator: \Character.isNewline).first?.prefix(200) ?? "AI 실행 오류")
    }
}

enum TaskAiRunResult {
    case success(TaskAiProposal)
    case failure(String)
}

enum TaskAiRunner {
    static func run(configuration: RatkoConfiguration, prompt: String) async -> TaskAiRunResult {
        await Task.detached(priority: .utility) {
            runSynchronously(configuration: configuration, prompt: prompt)
        }.value
    }

    private static func runSynchronously(configuration: RatkoConfiguration, prompt: String) -> TaskAiRunResult {
        let process = Process()
        let binary = configuration.aiFeedbackBinaryResolved
        let arguments = ["-p", prompt, "--output-format", "json", "--allowedTools", "Read,Grep,Glob"]
        if binary.hasPrefix("/") {
            process.executableURL = URL(fileURLWithPath: binary)
            process.arguments = arguments
        } else {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = [binary] + arguments
        }
        process.currentDirectoryURL = configuration.vaultURL
        var environment = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let preferredPath = "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        environment["PATH"] = "\(preferredPath):\(environment["PATH"] ?? "")"
        process.environment = environment

        let output = Pipe()
        process.standardOutput = output
        let errorURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/TaskMasterRatko/task-ai-run.log")
        FileManager.default.createFile(atPath: errorURL.path, contents: nil)
        guard let errorHandle = try? FileHandle(forWritingTo: errorURL) else {
            return .failure("AI 로그 파일을 열 수 없습니다.")
        }
        process.standardError = errorHandle

        do {
            try process.run()
        } catch {
            try? errorHandle.close()
            return .failure(error.localizedDescription)
        }

        let timeout = LockedTaskAiFlag()
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + TimeInterval(configuration.taskAiTimeoutMinutesResolved * 60)
        ) {
            guard process.isRunning else { return }
            timeout.set()
            process.terminate()
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        try? errorHandle.close()

        if timeout.value { return .failure("태스크 AI 응답 시간이 제한을 넘었습니다.") }
        guard process.terminationStatus == 0 else {
            return .failure(lastLine(at: errorURL) ?? "claude 종료 코드 \(process.terminationStatus)")
        }
        guard let stdout = String(data: data, encoding: .utf8) else {
            return .failure("AI 응답 인코딩을 읽지 못했습니다.")
        }
        do {
            return .success(try TaskAiResponseParser.parse(stdout))
        } catch {
            return .failure(error.localizedDescription)
        }
    }

    private static func lastLine(at url: URL) -> String? {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return text.split(whereSeparator: \Character.isNewline).last.map { String($0.prefix(200)) }
    }
}

enum TaskAiError: LocalizedError {
    case invalidResponse(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse(let message): message
        }
    }
}

private final class LockedTaskAiFlag: @unchecked Sendable {
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
