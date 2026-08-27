import AppKit
import SwiftUI

@main
struct TaskMasterRatkoApp: App {
    @StateObject private var store: RatkoStore

    init() {
        MenuBarPlacement.pinNextToWiFi()
        let model: RatkoStore
        do {
            let configuration = try RatkoConfiguration.load()
            model = RatkoStore(configuration: configuration)
        } catch {
            model = RatkoStore(error: error)
        }
        _store = StateObject(wrappedValue: model)
    }

    var body: some Scene {
        MenuBarExtra {
            RatkoPanel(store: store)
        } label: {
            RatkoIconView(kind: .menuBar, size: 14)
                .accessibilityLabel("TaskMaster 랏코")
        }
        .menuBarExtraStyle(.window)

        Window("랏코 포커스", id: "ratko-focus") {
            FloatingFocusView(store: store)
        }
        .defaultSize(width: 420, height: 260)
        .windowStyle(.hiddenTitleBar)
    }
}

struct RatkoPanel: View {
    @ObservedObject var store: RatkoStore
    @Environment(\.openWindow) private var openWindow
    @State private var newTask = ""
    @State private var feedbackExpanded = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let error = store.lastError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.red)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    }
                    aiFeedbackSection
                    focusSection
                    nextSection
                }
                .padding(14)
            }
            Divider()
            footer
        }
        .frame(width: 400)
        .frame(maxHeight: 720)
    }

    private var aiFeedbackSection: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 7) {
                Image(systemName: "sparkles").foregroundStyle(.purple)
                Text("AI 피드백").font(.caption).bold()
                if store.isAiFeedbackStale {
                    Text("이전 기록")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.orange)
                }
                Spacer()
                if store.aiFeedback != nil {
                    Button { feedbackExpanded.toggle() } label: {
                        Image(systemName: feedbackExpanded ? "chevron.up" : "chevron.down")
                    }
                    .buttonStyle(.plain)
                    .help(feedbackExpanded ? "접기" : "전체 피드백 보기")
                }
            }

            if let feedback = store.aiFeedback {
                if feedbackExpanded {
                    Text("\(feedback.date)\(feedback.weekday.isEmpty ? "" : " (\(feedback.weekday))")")
                        .font(.caption2).foregroundStyle(.secondary)
                    if !feedback.snapshot.isEmpty {
                        Text(feedback.snapshot).font(.caption).fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(feedback.bullets) { bullet in
                        HStack(alignment: .top, spacing: 6) {
                            Text("•").foregroundStyle(.purple)
                            Text(bullet.lead.isEmpty ? bullet.body : "\(bullet.lead) — \(bullet.body)")
                                .font(.caption)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                if !feedback.highlight.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("오늘의 하이라이트").font(.caption2).bold().foregroundStyle(.purple)
                        Text(feedback.highlight).font(.caption).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.purple.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
            } else {
                Text("아직 생성된 피드백이 없습니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            if case .error(let message) = store.aiFeedbackState {
                Text(message).font(.caption2).foregroundStyle(.red).lineLimit(2)
            }

            HStack {
                Button {
                    store.runAiFeedback()
                } label: {
                    HStack(spacing: 5) {
                        if store.aiFeedbackState == .running {
                            ProgressView()
                                .controlSize(.small)
                            Text("생성 중 · \(store.aiFeedbackRunningSeconds)초")
                        } else {
                            Label("피드백 받기", systemImage: "arrow.clockwise")
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(store.aiFeedbackState == .running)
                Spacer()
                Button("전체 열기") { store.openAiFeedback() }.buttonStyle(.plain)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private var header: some View {
        HStack(spacing: 10) {
            RatkoIconView(kind: .portrait, size: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text("오늘의 랏코").font(.headline)
                Text("\(store.focusTasks.count)개 집중 · 오늘 \(store.doneToday)개 완료")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button { openWindow(id: "ratko-focus") } label: {
                Image(systemName: "pin.square")
            }
            .buttonStyle(.plain)
            .help("포커스 창 열기")
        }
        .padding(14)
    }

    private var focusSection: some View {
        VStack(alignment: .leading, spacing: 9) {
            sectionHeader("현재 작업", count: store.focusTasks.count)
            if store.focusTasks.isEmpty {
                VStack(spacing: 5) {
                    Image(systemName: "checkmark.circle").font(.title2).foregroundStyle(.green)
                    Text("집중 중인 작업이 없습니다").font(.subheadline).bold()
                    Text("다음 할 일의 재생 버튼을 누르세요").font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 18)
            } else {
                ForEach(store.focusTasks, id: \.0.id) { task, timer in
                    FocusCard(store: store, task: task, timer: timer)
                }
            }
        }
    }

    private var nextSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("다음 할 일", count: store.nextTasks.count)
            ForEach(store.nextTasks) { task in
                HStack(spacing: 8) {
                    Text(statusLabel(task.status))
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 54, alignment: .leading)
                    Button(task.title) { store.openTask(task) }
                        .buttonStyle(.plain)
                        .lineLimit(1)
                    Spacer()
                    Button { store.focus(task.id) } label: { Image(systemName: "play.fill") }
                        .buttonStyle(.borderless).help("집중 시작")
                }
                .padding(.vertical, 4)
            }
            HStack {
                TextField("새 작업", text: $newTask)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(createTask)
                Button(action: createTask) { Image(systemName: "plus") }
                    .buttonStyle(.borderedProminent)
            }
            .padding(.top, 2)
        }
    }

    private var footer: some View {
        HStack {
            Button("TaskMaster 열기") { store.openBoard() }.buttonStyle(.plain)
            Spacer()
            Button("종료") { NSApplication.shared.terminate(nil) }
                .buttonStyle(.plain).foregroundStyle(.secondary)
        }
        .font(.caption)
        .padding(12)
    }

    private func sectionHeader(_ title: String, count: Int) -> some View {
        HStack {
            Text(title).font(.caption).bold().foregroundStyle(.secondary)
            Spacer()
            Text(String(count)).font(.caption2).foregroundStyle(.tertiary)
        }
    }

    private func createTask() {
        store.createTask(title: newTask)
        newTask = ""
    }
}

private struct RatkoIconView: View {
    enum Kind {
        case menuBar
        case portrait
    }

    let kind: Kind
    let size: CGFloat

    var body: some View {
        Group {
            if let image = image {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
            } else {
                Image(systemName: "timer")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            }
        }
        .frame(width: size, height: size)
    }

    private var image: NSImage? {
        switch kind {
        case .menuBar: RatkoImages.menuBar
        case .portrait: RatkoImages.portrait
        }
    }
}

private enum RatkoImages {
    static let menuBar = load(named: "taskmaster-menubar-32")
    static let portrait = load(named: "taskmaster-menubar-otter")

    private static func load(named name: String) -> NSImage? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "png"),
              let image = NSImage(contentsOf: url)
        else { return nil }
        image.isTemplate = false
        return image
    }
}

struct FocusCard: View {
    @ObservedObject var store: RatkoStore
    let task: TaskCard
    let timer: TimerRecord
    @State private var newStep = ""
    @State private var memo = ""
    @State private var showingMemo = false
    @State private var editingStepIndex: Int?
    @State private var editingStepText = ""
    @FocusState private var stepEditorFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Circle().fill(timer.phase == .running ? .green : timer.phase == .paused ? .orange : .gray)
                    .frame(width: 7, height: 7)
                Text(phaseLabel).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(formattedElapsed(store.elapsed(for: timer))).font(.system(.body, design: .monospaced)).bold()
            }
            HStack(alignment: .firstTextBaseline) {
                Button(task.title) { store.openTask(task) }
                    .buttonStyle(.plain).font(.headline).lineLimit(2)
                Spacer()
                Button {
                    timer.phase == .running ? store.pause(task.id) : store.start(task.id)
                } label: {
                    Image(systemName: timer.phase == .running ? "pause.fill" : "play.fill")
                }
                .buttonStyle(.borderedProminent)
                Button(role: .destructive) { store.stop(task.id) } label: {
                    Image(systemName: "stop.fill")
                }
                .buttonStyle(.bordered)
            }
            ForEach(Array(task.steps.enumerated()), id: \.offset) { index, step in
                HStack(spacing: 7) {
                    Button { store.selectStep(taskId: task.id, step: index + 1) } label: {
                        Image(systemName: stepIcon(index))
                            .foregroundStyle(task.currentStep == index + 1 ? Color.accentColor : Color.secondary)
                    }.buttonStyle(.plain)
                    if editingStepIndex == index {
                        TextField("단계 내용", text: $editingStepText)
                            .textFieldStyle(.roundedBorder)
                            .font(.caption)
                            .focused($stepEditorFocused)
                            .onSubmit(saveEditedStep)
                            .onExitCommand(perform: cancelEditingStep)
                        Button(action: saveEditedStep) { Image(systemName: "checkmark") }
                            .buttonStyle(.plain)
                            .focusable(false)
                            .disabled(editingStepText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            .help("수정 저장")
                        Button(action: cancelEditingStep) { Image(systemName: "xmark") }
                            .buttonStyle(.plain)
                            .focusable(false)
                            .help("수정 취소")
                    } else {
                        Button { beginEditingStep(index: index, text: step) } label: {
                            HStack(spacing: 3) {
                                Text(step).font(.caption).lineLimit(2)
                                Image(systemName: "pencil").font(.system(size: 8))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .buttonStyle(.plain)
                        .help("단계 내용 수정")
                        Spacer()
                        Text(formattedElapsed(store.stepElapsed(for: timer, index: index)))
                            .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                        Button { store.moveStep(taskId: task.id, from: index, offset: -1) } label: {
                            Image(systemName: "chevron.up")
                        }.buttonStyle(.plain).disabled(index == 0)
                        Button { store.moveStep(taskId: task.id, from: index, offset: 1) } label: {
                            Image(systemName: "chevron.down")
                        }.buttonStyle(.plain).disabled(index == task.steps.count - 1)
                    }
                }
            }
            HStack {
                TextField(task.steps.isEmpty ? "첫 단계 추가" : "단계 추가", text: $newStep)
                    .textFieldStyle(.roundedBorder).font(.caption).onSubmit(addStep)
                Button(action: addStep) { Image(systemName: "plus") }.buttonStyle(.borderless)
            }
            HStack {
                Button("잠시 내려놓기") { store.park(task.id) }.buttonStyle(.plain)
                Spacer()
                Button(showingMemo ? "메모 닫기" : "메모") { showingMemo.toggle() }.buttonStyle(.plain)
            }
            .font(.caption).foregroundStyle(.secondary)
            if showingMemo {
                HStack(alignment: .bottom) {
                    TextEditor(text: $memo).font(.caption).frame(minHeight: 50, maxHeight: 90)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))
                    Button("저장") {
                        store.appendMemo(taskId: task.id, text: memo)
                        memo = ""
                    }.buttonStyle(.borderedProminent).disabled(memo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .onChange(of: stepEditorFocused) { focused in
            if !focused, editingStepIndex != nil { saveEditedStep() }
        }
        .onDisappear {
            if editingStepIndex != nil { saveEditedStep() }
        }
    }

    private var phaseLabel: String {
        switch timer.phase { case .idle: "준비"; case .running: "집중 중"; case .paused: "일시정지" }
    }

    private func stepIcon(_ index: Int) -> String {
        guard let current = task.currentStep else { return "circle" }
        if index + 1 < current { return "checkmark.circle.fill" }
        return index + 1 == current ? "record.circle" : "circle"
    }

    private func addStep() {
        store.addStep(taskId: task.id, value: newStep)
        newStep = ""
    }

    private func beginEditingStep(index: Int, text: String) {
        editingStepIndex = index
        editingStepText = text
        DispatchQueue.main.async { stepEditorFocused = true }
    }

    private func saveEditedStep() {
        guard let index = editingStepIndex,
              !editingStepText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }
        store.renameStep(taskId: task.id, index: index, value: editingStepText)
        cancelEditingStep()
    }

    private func cancelEditingStep() {
        editingStepIndex = nil
        editingStepText = ""
        stepEditorFocused = false
    }
}

struct FloatingFocusView: View {
    @ObservedObject var store: RatkoStore

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                RatkoIconView(kind: .portrait, size: 24)
                Text("집중 중").font(.headline)
                Spacer()
                Text("\(store.focusTasks.count)개").foregroundStyle(.secondary)
            }
            if store.focusTasks.isEmpty {
                Text("현재 작업이 없습니다").foregroundStyle(.secondary)
            }
            ForEach(store.focusTasks, id: \.0.id) { task, timer in
                HStack {
                    Button(task.title) { store.openTask(task) }.buttonStyle(.plain).lineLimit(1)
                    Spacer()
                    Text(formattedElapsed(store.elapsed(for: timer))).font(.system(.body, design: .monospaced)).bold()
                    Button { timer.phase == .running ? store.pause(task.id) : store.start(task.id) } label: {
                        Image(systemName: timer.phase == .running ? "pause.fill" : "play.fill")
                    }
                    .buttonStyle(.borderless)
                }
            }
        }
        .padding(16)
        .frame(minWidth: 360, minHeight: 120)
    }
}

private func statusLabel(_ status: TaskStatus) -> String {
    switch status {
    case .backlog: "BACKLOG"
    case .hold: "HOLD"
    case .todo: "TODO"
    case .doing: "DOING"
    case .inReview: "REVIEW"
    case .done: "DONE"
    }
}
