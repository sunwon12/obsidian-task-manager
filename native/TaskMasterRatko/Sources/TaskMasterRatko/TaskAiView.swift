import SwiftUI

struct TaskAiView: View {
    @ObservedObject var store: RatkoStore
    let taskId: String

    @State private var messages: [TaskAiMessage] = []
    @State private var input = ""
    @State private var pendingProposal: TaskAiProposal?
    @State private var proposalBaseUpdatedAt: String?
    @State private var isRunning = false
    @State private var startedAt: Date?
    @State private var errorMessage: String?
    @State private var lastUserText = ""
    @State private var lastHandledFillRequest: UUID?
    @FocusState private var inputFocused: Bool

    private let fillStepsMessage = "이 태스크의 현재 단계를 인간 시간과 AI 실행 시간을 나눠 측정할 수 있는 짧은 국면으로 다시 제안해줘."

    var body: some View {
        Group {
            if let task = store.task(for: taskId) {
                VStack(spacing: 0) {
                    header(task)
                    Divider()
                    conversation(task)
                    Divider()
                    composer(task)
                }
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(.orange)
                    Text("태스크를 찾지 못했습니다").font(.headline)
                    Text("보관되거나 삭제된 태스크인지 확인해 주세요.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 500, minHeight: 540)
        .background(RatkoTaskAiWindowResolver(taskId: taskId))
        .onAppear { handleFillRequest(store.taskAiStepFillRequests[taskId]) }
        .onChange(of: store.taskAiStepFillRequests[taskId]) { request in
            handleFillRequest(request)
        }
    }

    private func header(_ task: TaskCard) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                RatkoTaskAiIcon()
                VStack(alignment: .leading, spacing: 2) {
                    Text("태스크 AI").font(.headline)
                    Text(task.title).font(.subheadline).bold().lineLimit(2)
                    Text(currentContext(task)).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("태스크 열기") { store.openTask(task) }.buttonStyle(.plain)
            }
            HStack {
                Button {
                    send(fillStepsMessage, for: task)
                } label: {
                    Label("AI 단계 채우기", systemImage: "sparkles")
                }
                .buttonStyle(.bordered)
                .disabled(isRunning || pendingProposal != nil)
                Text("대화 내용은 이 태스크만 문맥으로 사용합니다.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(14)
    }

    private func conversation(_ task: TaskCard) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if messages.isEmpty {
                        Text("이 태스크를 문맥으로 열었습니다. 궁금한 점을 묻거나 단계·본문·메모 변경을 요청하세요.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    }
                    ForEach(messages) { message in
                        messageBubble(message)
                    }
                    if isRunning {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                Text("이 태스크를 읽고 답하는 중 · \(runningSeconds(at: context.date))초")
                            }
                        }
                        .font(.caption).foregroundStyle(.secondary)
                        .id("running")
                    }
                    if let pendingProposal {
                        proposalCard(pendingProposal, task: task).id("proposal")
                    }
                    if let errorMessage {
                        VStack(alignment: .leading, spacing: 6) {
                            Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                                .font(.caption).foregroundStyle(.red)
                            if !lastUserText.isEmpty, !isRunning {
                                Button("다시 시도") { send(lastUserText, for: task, appendUserMessage: false) }
                                    .buttonStyle(.plain).font(.caption)
                            }
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.red.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
                        .id("error")
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(14)
            }
            .onChange(of: messages.count) { _ in scrollToBottom(proxy) }
            .onChange(of: isRunning) { _ in scrollToBottom(proxy) }
            .onChange(of: pendingProposal?.reply) { _ in scrollToBottom(proxy) }
        }
    }

    private func composer(_ task: TaskCard) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            if pendingProposal != nil {
                Text("변경안을 적용하거나 버린 뒤 대화를 이어갈 수 있습니다.")
                    .font(.caption2).foregroundStyle(.orange)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextEditor(text: $input)
                    .font(.body)
                    .frame(minHeight: 52, maxHeight: 100)
                    .padding(5)
                    .background(.background, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(.quaternary))
                    .focused($inputFocused)
                    .disabled(isRunning || pendingProposal != nil)
                Button {
                    send(input, for: task)
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.title2)
                }
                .buttonStyle(.plain)
                .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isRunning || pendingProposal != nil)
                .help("보내기")
            }
        }
        .padding(12)
    }

    private func messageBubble(_ message: TaskAiMessage) -> some View {
        HStack {
            if message.role == .user { Spacer(minLength: 70) }
            Text(message.text)
                .font(.callout)
                .textSelection(.enabled)
                .padding(.horizontal, 11)
                .padding(.vertical, 8)
                .background(
                    message.role == .user ? Color.accentColor.opacity(0.16) : Color.secondary.opacity(0.1),
                    in: RoundedRectangle(cornerRadius: 10)
                )
            if message.role == .assistant { Spacer(minLength: 70) }
        }
    }

    private func proposalCard(_ proposal: TaskAiProposal, task: TaskCard) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Label("적용 전 변경안", systemImage: "doc.badge.gearshape").font(.caption).bold()
            if let steps = proposal.steps {
                VStack(alignment: .leading, spacing: 3) {
                    Text("단계 \(task.steps.isEmpty ? "추가" : "교체")").font(.caption2).foregroundStyle(.secondary)
                    if steps.isEmpty {
                        Text("모든 단계 제거").font(.caption)
                    } else {
                        ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                            Text("\(index + 1). \(step)").font(.caption)
                        }
                    }
                }
            }
            if let memo = proposal.memo {
                proposalText(label: "메모 추가", value: memo, lineLimit: 5)
            }
            if let body = proposal.body {
                proposalText(label: "본문 전체 교체", value: body, lineLimit: 8)
            }
            HStack {
                Button("변경 적용") { apply(proposal, task: task) }
                    .buttonStyle(.borderedProminent)
                Button("버리기") {
                    pendingProposal = nil
                    proposalBaseUpdatedAt = nil
                    messages.append(TaskAiMessage(role: .assistant, text: "변경안을 버렸습니다."))
                    inputFocused = true
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.purple.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.purple.opacity(0.25)))
    }

    private func proposalText(label: String, value: String, lineLimit: Int) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.caption).lineLimit(lineLimit).textSelection(.enabled)
        }
    }

    private func send(
        _ rawText: String,
        for task: TaskCard,
        appendUserMessage: Bool = true
    ) {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isRunning, pendingProposal == nil, let configuration = store.configuration else { return }

        var promptMessages = messages
        if appendUserMessage {
            let message = TaskAiMessage(role: .user, text: text)
            messages.append(message)
            promptMessages.append(message)
        }
        input = ""
        inputFocused = false
        errorMessage = nil
        lastUserText = text
        isRunning = true
        startedAt = Date()
        let baseUpdatedAt = task.updatedAt
        let prompt = TaskAiPrompt.build(task: task, messages: promptMessages)

        Task {
            let result = await TaskAiRunner.run(configuration: configuration, prompt: prompt)
            isRunning = false
            startedAt = nil
            switch result {
            case .success(let proposal):
                messages.append(TaskAiMessage(role: .assistant, text: proposal.reply))
                if proposal.hasChanges {
                    pendingProposal = proposal
                    proposalBaseUpdatedAt = baseUpdatedAt
                } else {
                    inputFocused = true
                }
            case .failure(let message):
                errorMessage = message
            }
        }
    }

    private func apply(_ proposal: TaskAiProposal, task: TaskCard) {
        guard let proposalBaseUpdatedAt else { return }
        if let error = store.applyTaskAiProposal(
            taskId: task.id,
            proposal: proposal,
            expectedUpdatedAt: proposalBaseUpdatedAt
        ) {
            errorMessage = error
            return
        }
        pendingProposal = nil
        self.proposalBaseUpdatedAt = nil
        errorMessage = nil
        messages.append(TaskAiMessage(role: .assistant, text: "확인한 변경안을 태스크에 적용했습니다."))
        inputFocused = true
    }

    private func handleFillRequest(_ request: UUID?) {
        guard let request, request != lastHandledFillRequest,
              let task = store.task(for: taskId), !isRunning, pendingProposal == nil
        else { return }
        lastHandledFillRequest = request
        send(fillStepsMessage, for: task)
    }

    private func currentContext(_ task: TaskCard) -> String {
        guard let current = task.currentStep, task.steps.indices.contains(current - 1) else {
            return "\(task.status.rawValue.uppercased()) · 현재 단계 없음"
        }
        return "\(task.status.rawValue.uppercased()) · \(task.steps[current - 1])"
    }

    private func runningSeconds(at date: Date) -> Int {
        guard let startedAt else { return 0 }
        return max(0, Int(date.timeIntervalSince(startedAt)))
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo("bottom", anchor: .bottom) }
        }
    }
}

private struct RatkoTaskAiIcon: View {
    var body: some View {
        Image(systemName: "bubble.left.and.bubble.right.fill")
            .font(.title2)
            .foregroundStyle(.purple)
            .frame(width: 32, height: 32)
            .background(.purple.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }
}
