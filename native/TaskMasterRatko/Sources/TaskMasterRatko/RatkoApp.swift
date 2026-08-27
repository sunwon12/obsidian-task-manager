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
            Text("🦦")
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

    private var header: some View {
        HStack(spacing: 10) {
            Text("🦦").font(.title2)
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

struct FocusCard: View {
    @ObservedObject var store: RatkoStore
    let task: TaskCard
    let timer: TimerRecord
    @State private var newStep = ""
    @State private var memo = ""
    @State private var showingMemo = false

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
                    Text(step).font(.caption).lineLimit(2)
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
}

struct FloatingFocusView: View {
    @ObservedObject var store: RatkoStore

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text("🦦 집중 중").font(.headline); Spacer(); Text("\(store.focusTasks.count)개").foregroundStyle(.secondary) }
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
