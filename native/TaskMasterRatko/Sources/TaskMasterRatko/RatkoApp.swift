import AppKit
import SwiftUI

enum RatkoPanelSizing {
    static let minimumHeight = 360.0
    static let defaultHeight = 520.0

    static func maximumHeight(visibleScreenHeight: Double) -> Double {
        max(minimumHeight, visibleScreenHeight - 16)
    }

    static func clamp(_ height: Double, visibleScreenHeight: Double) -> Double {
        min(maximumHeight(visibleScreenHeight: visibleScreenHeight), max(minimumHeight, height))
    }
}

enum RatkoDragAutoScroll {
    static let edgeSize = 56.0
    static let maximumPointsPerTick = 5.0

    static func velocity(pointerY: Double, viewportMinY: Double, viewportMaxY: Double) -> Double {
        guard viewportMaxY > viewportMinY else { return 0 }
        let threshold = min(edgeSize, (viewportMaxY - viewportMinY) / 2)
        let bottomIntensity = min(1, max(0, (threshold - (pointerY - viewportMinY)) / threshold))
        let topIntensity = min(1, max(0, (threshold - (viewportMaxY - pointerY)) / threshold))
        if bottomIntensity == topIntensity { return 0 }
        let signedIntensity = bottomIntensity > topIntensity ? bottomIntensity : -topIntensity
        let easedIntensity = signedIntensity * abs(signedIntensity)
        return maximumPointsPerTick * easedIntensity
    }

    static func nextOffset(current: Double, velocity: Double, minimum: Double, maximum: Double) -> Double {
        min(maximum, max(minimum, current + velocity))
    }
}

private final class RatkoDragAutoScroller: ObservableObject {
    weak var scrollView: NSScrollView?
    private var timer: Timer?
    private var pointsPerTick = 0.0
    private var pendingStop: DispatchWorkItem?

    func updateForPointer(_ pointer: NSPoint = NSEvent.mouseLocation) {
        pendingStop?.cancel()
        pendingStop = nil
        guard let scrollView,
              let window = scrollView.window
        else {
            stop()
            return
        }
        let clipView = scrollView.contentView
        let viewportInWindow = clipView.convert(clipView.bounds, to: nil)
        let viewportOnScreen = window.convertToScreen(viewportInWindow)
        let velocity = RatkoDragAutoScroll.velocity(
            pointerY: pointer.y,
            viewportMinY: viewportOnScreen.minY,
            viewportMaxY: viewportOnScreen.maxY
        )
        guard velocity != 0 else {
            stop()
            return
        }
        pointsPerTick = velocity
        if timer == nil {
            let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
                self?.scrollOneTick()
            }
            self.timer = timer
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    func scheduleStop() {
        pendingStop?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.stop() }
        pendingStop = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
    }

    func stop() {
        pendingStop?.cancel()
        pendingStop = nil
        timer?.invalidate()
        timer = nil
        pointsPerTick = 0
    }

    private func scrollOneTick() {
        guard let scrollView, let documentView = scrollView.documentView else {
            stop()
            return
        }
        let clipView = scrollView.contentView
        let minimum = Double(documentView.bounds.minY)
        let maximum = max(minimum, Double(documentView.bounds.maxY - clipView.bounds.height))
        let current = Double(clipView.bounds.origin.y)
        let next = RatkoDragAutoScroll.nextOffset(
            current: current,
            velocity: pointsPerTick,
            minimum: minimum,
            maximum: maximum
        )
        guard next != current else { return }
        clipView.scroll(to: NSPoint(x: clipView.bounds.origin.x, y: next))
        scrollView.reflectScrolledClipView(clipView)
    }
}

enum RatkoScrollViewLookup {
    static func largestContaining(pointInWindow: NSPoint, root: NSView) -> NSScrollView? {
        scrollViews(in: root)
            .filter { $0.convert($0.bounds, to: nil).contains(pointInWindow) }
            .max { left, right in
                left.bounds.width * left.bounds.height < right.bounds.width * right.bounds.height
            }
    }

    private static func scrollViews(in view: NSView) -> [NSScrollView] {
        let current = (view as? NSScrollView).map { [$0] } ?? []
        return current + view.subviews.flatMap { scrollViews(in: $0) }
    }
}

private struct RatkoScrollViewResolver: NSViewRepresentable {
    let onResolve: (NSScrollView) -> Void

    func makeNSView(context: Context) -> ResolverView {
        ResolverView(onResolve: onResolve)
    }

    func updateNSView(_ nsView: ResolverView, context: Context) {
        nsView.onResolve = onResolve
        nsView.resolve()
    }

    final class ResolverView: NSView {
        var onResolve: (NSScrollView) -> Void

        init(onResolve: @escaping (NSScrollView) -> Void) {
            self.onResolve = onResolve
            super.init(frame: .zero)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            resolve()
        }

        func resolve() {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                guard let scrollView = resolveScrollView() else { return }
                onResolve(scrollView)
            }
        }

        private func resolveScrollView() -> NSScrollView? {
            if let enclosingScrollView { return enclosingScrollView }
            guard let contentView = window?.contentView else { return nil }
            let pointInWindow = convert(NSPoint(x: bounds.midX, y: bounds.midY), to: nil)
            return RatkoScrollViewLookup.largestContaining(pointInWindow: pointInWindow, root: contentView)
        }
    }
}

private final class RatkoTaskPointerDragMonitor: ObservableObject {
    private weak var window: NSWindow?
    private var frames: [RatkoTaskDropFrame] = []
    private var onChanged: ((String, CGPoint) -> Void)?
    private var onEnded: ((String, CGPoint) -> Void)?
    private var eventMonitor: Any?
    private var pressedTaskId: String?
    private var startPoint: CGPoint?
    private var isDragging = false

    func connect(
        window: NSWindow,
        frames: [RatkoTaskDropFrame],
        onChanged: @escaping (String, CGPoint) -> Void,
        onEnded: @escaping (String, CGPoint) -> Void
    ) {
        self.frames = frames
        self.onChanged = onChanged
        self.onEnded = onEnded
        guard self.window !== window || eventMonitor == nil else { return }
        stopMonitoring()
        self.window = window
        eventMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]
        ) { [weak self] event in
            self?.handle(event)
            return event
        }
    }

    func stop() {
        stopMonitoring()
        window = nil
        resetDrag()
    }

    deinit {
        stopMonitoring()
    }

    private func handle(_ event: NSEvent) {
        guard let point = pointInSwiftUI(for: event) else { return }
        switch event.type {
        case .leftMouseDown:
            let task = RatkoTaskDropLayout(frames: frames).task(at: point)
            pressedTaskId = task?.id
            startPoint = point
            isDragging = false
            RatkoUiTestDiagnostics.log("pointer-down point=\(point) task=\(String(describing: task?.id))")
        case .leftMouseDragged:
            guard let taskId = pressedTaskId, let startPoint else { return }
            if !isDragging {
                let distance = hypot(point.x - startPoint.x, point.y - startPoint.y)
                guard distance >= 5 else { return }
                isDragging = true
            }
            onChanged?(taskId, point)
        case .leftMouseUp:
            if let taskId = pressedTaskId, isDragging {
                onEnded?(taskId, point)
            }
            resetDrag()
        default:
            break
        }
    }

    private func pointInSwiftUI(for event: NSEvent) -> CGPoint? {
        guard let window else { return nil }
        let pointInWindow: NSPoint
        if let eventWindow = event.window {
            guard eventWindow === window else { return nil }
            pointInWindow = event.locationInWindow
        } else {
            let pointOnScreen = event.locationInWindow
            guard pressedTaskId != nil || window.frame.contains(pointOnScreen) else { return nil }
            pointInWindow = window.convertPoint(fromScreen: pointOnScreen)
        }
        return CGPoint(x: pointInWindow.x, y: window.frame.height - pointInWindow.y)
    }

    private func resetDrag() {
        pressedTaskId = nil
        startPoint = nil
        isDragging = false
    }

    private func stopMonitoring() {
        if let eventMonitor { NSEvent.removeMonitor(eventMonitor) }
        eventMonitor = nil
    }
}

private struct RatkoTaskPointerDragResolver: NSViewRepresentable {
    let monitor: RatkoTaskPointerDragMonitor
    let frames: [RatkoTaskDropFrame]
    let onChanged: (String, CGPoint) -> Void
    let onEnded: (String, CGPoint) -> Void

    func makeNSView(context: Context) -> ResolverView {
        ResolverView(onResolve: connect)
    }

    func updateNSView(_ nsView: ResolverView, context: Context) {
        nsView.onResolve = connect
        nsView.resolve()
    }

    private func connect(window: NSWindow) {
        monitor.connect(window: window, frames: frames, onChanged: onChanged, onEnded: onEnded)
    }

    final class ResolverView: NSView {
        var onResolve: (NSWindow) -> Void

        init(onResolve: @escaping (NSWindow) -> Void) {
            self.onResolve = onResolve
            super.init(frame: .zero)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            resolve()
        }

        func resolve() {
            guard let window else { return }
            onResolve(window)
        }
    }
}

private struct RatkoTaskDropFramePreferenceKey: PreferenceKey {
    static var defaultValue: [RatkoTaskDropFrame] = []

    static func reduce(value: inout [RatkoTaskDropFrame], nextValue: () -> [RatkoTaskDropFrame]) {
        value.append(contentsOf: nextValue())
    }
}

private extension View {
    func ratkoTaskDropFrame(_ kind: RatkoTaskDropFrameKind) -> some View {
        background {
            GeometryReader { proxy in
                Color.clear.preference(
                    key: RatkoTaskDropFramePreferenceKey.self,
                    value: [RatkoTaskDropFrame(
                        kind: kind,
                        frame: proxy.frame(in: .global)
                    )]
                )
            }
        }
    }
}

enum RatkoUiTestDiagnostics {
    static var isEnabled: Bool {
        ProcessInfo.processInfo.environment["RATKO_UI_TEST"] == "1"
    }

    static func log(_ message: String) {
        guard isEnabled, let data = "[ratko-ui-test] \(message)\n".data(using: .utf8) else { return }
        FileHandle.standardError.write(data)
    }
}

private enum RatkoUiTestWindow {
    private static var window: NSWindow?

    static func open(store: RatkoStore) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 400, height: 760),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "랏코 UI 검증"
        window.contentView = NSHostingView(rootView: RatkoPanel(store: store))
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        self.window = window
    }
}

@MainActor
enum RatkoTaskAiWindowPresentation {
    static func identifier(for taskId: String) -> NSUserInterfaceItemIdentifier {
        NSUserInterfaceItemIdentifier("ratko-task-ai-\(taskId)")
    }

    static func open(taskId: String, using openWindow: OpenWindowAction) {
        openWindow(value: taskId)
        DispatchQueue.main.async {
            NSApplication.shared.activate(ignoringOtherApps: true)
            window(for: taskId)?.makeKeyAndOrderFront(nil)
        }
    }

    static func register(_ window: NSWindow, taskId: String) {
        window.identifier = identifier(for: taskId)
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    static func window(for taskId: String) -> NSWindow? {
        window(for: taskId, in: NSApplication.shared.windows)
    }

    static func window(for taskId: String, in windows: [NSWindow]) -> NSWindow? {
        windows.first { $0.identifier == identifier(for: taskId) }
    }
}

struct RatkoTaskAiWindowResolver: NSViewRepresentable {
    let taskId: String

    func makeNSView(context: Context) -> ResolverView {
        ResolverView(taskId: taskId)
    }

    func updateNSView(_ nsView: ResolverView, context: Context) {
        guard nsView.taskId != taskId else { return }
        nsView.taskId = taskId
        nsView.resolve()
    }

    final class ResolverView: NSView {
        var taskId: String

        init(taskId: String) {
            self.taskId = taskId
            super.init(frame: .zero)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            resolve()
        }

        func resolve() {
            guard let window else { return }
            DispatchQueue.main.async { [weak window] in
                guard let window else { return }
                RatkoTaskAiWindowPresentation.register(window, taskId: self.taskId)
            }
        }
    }
}

@main
struct TaskMasterRatkoApp: App {
    @NSApplicationDelegateAdaptor(RatkoApplicationDelegate.self) private var appDelegate
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
        appDelegate.onOpenAiSessions = { [weak model] in
            guard let model else { return }
            model.scanAiSessions()
            RatkoAiSessionsWindowPresentation.open(store: model)
        }
        if ProcessInfo.processInfo.environment["RATKO_UI_TEST"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                RatkoUiTestWindow.open(store: model)
            }
        }
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

        Window("AI 세션 점검", id: "ratko-ai-sessions") {
            AiSessionsView(store: store)
        }
        .defaultSize(width: 700, height: 720)

        WindowGroup("태스크 AI", for: String.self) { $taskId in
            if let taskId {
                TaskAiView(store: store, taskId: taskId)
            }
        }
        .defaultSize(width: 560, height: 680)
    }
}

struct RatkoPanel: View {
    @ObservedObject var store: RatkoStore
    @Environment(\.openWindow) private var openWindow
    @State private var newTask = ""
    @State private var feedbackExpanded = false
    @State private var draggingTaskId: String?
    @State private var taskDropLocation: RatkoTaskDropLocation?
    @State private var taskDropFrames: [RatkoTaskDropFrame] = []
    @StateObject private var dragAutoScroller = RatkoDragAutoScroller()
    @StateObject private var pointerDragMonitor = RatkoTaskPointerDragMonitor()
    @AppStorage("ratko.panel.height") private var panelHeight = RatkoPanelSizing.defaultHeight
    @State private var resizeStartHeight: Double?

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
                    dailyProductivitySection
                    aiSessionsSection
                    taskSections
                }
                .padding(14)
                .background {
                    RatkoScrollViewResolver { dragAutoScroller.scrollView = $0 }
                }
            }
            Divider()
            footer
            resizeHandle
        }
        .frame(width: 400)
        .frame(height: CGFloat(clampedPanelHeight))
        .onAppear {
            panelHeight = clampedPanelHeight
        }
        .onChange(of: draggingTaskId) { taskId in
            if taskId == nil {
                dragAutoScroller.stop()
                taskDropLocation = nil
            }
        }
        .onDisappear {
            dragAutoScroller.stop()
            pointerDragMonitor.stop()
            draggingTaskId = nil
            taskDropLocation = nil
        }
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

    private var aiSessionsSection: some View {
        Button {
            store.scanAiSessions()
            RatkoAiSessionsWindowPresentation.open(using: openWindow)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "waveform.path.ecg")
                    .font(.title3)
                    .foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text("AI 세션 점검").font(.caption).bold()
                        if store.aiSessionScanState == .running {
                            ProgressView().controlSize(.mini)
                        }
                    }
                    if store.aiSessionLastScannedAt == nil {
                        Text("요청할 때만 열린 Claude·Codex 로그를 읽습니다.")
                            .font(.caption2).foregroundStyle(.secondary)
                    } else {
                        Text("AI 진행 \(store.runningAiSessionCount) · 내 차례 \(store.waitingAiSessionCount) · 자동화 제외 \(store.automationAiSessionReports.count)")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption).foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityLabel("AI 세션 점검 열기")
    }

    private var dailyProductivitySection: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 7) {
                Image(systemName: "chart.bar.xaxis").foregroundStyle(.green)
                Text("인간·AI 일일 시간").font(.caption).bold()
                if store.dailyProductivityBatchState == .running {
                    ProgressView().controlSize(.mini)
                    Text("집계 중").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
            }

            if let latest = store.dailyProductivityLatest {
                Text("\(latest.date) 확정")
                    .font(.caption2).foregroundStyle(.secondary)
                HStack(spacing: 12) {
                    dailyTime(label: "[인간]", milliseconds: latest.humanMilliseconds, color: .green)
                    dailyTime(label: "[AI]", milliseconds: latest.interactiveAiMilliseconds, color: .blue)
                    if latest.automationAiMilliseconds + latest.subagentAiMilliseconds > 0 {
                        dailyTime(
                            label: "자동·자식",
                            milliseconds: latest.automationAiMilliseconds + latest.subagentAiMilliseconds,
                            color: .secondary
                        )
                    }
                }
                if latest.claudeProjectCount == 0 {
                    Text("Claude 로그 미연결 · Codex만 집계")
                        .font(.caption2).foregroundStyle(.orange)
                }
            } else {
                Text("첫 실행 시 최근 30일을 백필합니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            if case .error(let message) = store.dailyProductivityBatchState {
                Text(message).font(.caption2).foregroundStyle(.red).lineLimit(2)
            }

            HStack {
                Button("다시 집계") { store.retryDailyProductivityBatch() }
                    .buttonStyle(.plain)
                    .disabled(store.dailyProductivityBatchState == .running)
                Spacer()
                Button("전체 열기") { store.openDailyProductivitySummary() }
                    .buttonStyle(.plain)
                    .disabled(store.dailyProductivityLatest == nil)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private func dailyTime(label: String, milliseconds: Double, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(color)
            Text(compactDailyDuration(milliseconds)).font(.caption).bold()
        }
    }

    private func compactDailyDuration(_ milliseconds: Double) -> String {
        let minutes = max(0, Int((milliseconds / 60_000).rounded()))
        return minutes >= 60 ? "\(minutes / 60)시간 \(minutes % 60)분" : "\(minutes)분"
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
                    FocusCard(
                        store: store,
                        task: task,
                        timer: timer
                    )
                        .opacity(draggingTaskId == task.id ? 0.45 : 1)
                        .ratkoTaskDropFrame(.task(.focus, id: task.id))
                        .overlay(alignment: .top) {
                            taskDropIndicator(list: .focus, beforeTaskId: task.id)
                        }
                }
            }
            taskDropIndicator(list: .focus, beforeTaskId: nil)
                .frame(height: 3)
        }
        .ratkoTaskDropFrame(.section(.focus))
    }

    private var nextSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("다음 할 일", count: store.nextTasks.count)
            ForEach(store.nextTasks) { task in
                NextTaskRow(
                    store: store,
                    task: task
                )
                    .opacity(draggingTaskId == task.id ? 0.45 : 1)
                    .ratkoTaskDropFrame(.task(.next, id: task.id))
                    .overlay(alignment: .top) {
                        taskDropIndicator(list: .next, beforeTaskId: task.id)
                    }
            }
            taskDropIndicator(list: .next, beforeTaskId: nil)
                .frame(height: 3)
            HStack {
                TextField("새 작업", text: $newTask)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(createTask)
                Button(action: createTask) { Image(systemName: "plus") }
                    .buttonStyle(.borderedProminent)
            }
            .padding(.top, 2)
        }
        .ratkoTaskDropFrame(.section(.next))
    }

    private var taskSections: some View {
        VStack(alignment: .leading, spacing: 14) {
            focusSection
            nextSection
        }
        .onPreferenceChange(RatkoTaskDropFramePreferenceKey.self) { taskDropFrames = $0 }
        .background {
            RatkoTaskPointerDragResolver(
                monitor: pointerDragMonitor,
                frames: taskDropFrames,
                onChanged: updateTaskDrag,
                onEnded: finishTaskDrag
            )
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

    private var resizeHandle: some View {
        ZStack {
            Color.clear
            Capsule()
                .fill(.tertiary)
                .frame(width: 42, height: 4)
        }
        .frame(height: 16)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    if resizeStartHeight == nil { resizeStartHeight = panelHeight }
                    let start = resizeStartHeight ?? panelHeight
                    panelHeight = RatkoPanelSizing.clamp(
                        start + Double(value.translation.height),
                        visibleScreenHeight: visibleScreenHeight
                    )
                }
                .onEnded { _ in resizeStartHeight = nil }
        )
        .onHover { hovering in
            hovering ? NSCursor.resizeUpDown.set() : NSCursor.arrow.set()
        }
        .help("위아래로 드래그해 패널 높이 조절")
        .accessibilityLabel("패널 높이 조절")
        .accessibilityValue("\(Int(clampedPanelHeight)) 포인트")
    }

    private var visibleScreenHeight: Double {
        Double((NSScreen.main ?? NSScreen.screens.first)?.visibleFrame.height ?? 800)
    }

    private var clampedPanelHeight: Double {
        RatkoPanelSizing.clamp(panelHeight, visibleScreenHeight: visibleScreenHeight)
    }

    private func sectionHeader(_ title: String, count: Int) -> some View {
        HStack {
            Text(title).font(.caption).bold().foregroundStyle(.secondary)
            Spacer()
            Text(String(count)).font(.caption2).foregroundStyle(.tertiary)
        }
    }

    @ViewBuilder
    private func taskDropIndicator(list: RatkoTaskList, beforeTaskId: String?) -> some View {
        let location = RatkoTaskDropLocation(list: list, beforeTaskId: beforeTaskId)
        if taskDropLocation == location {
            HStack(spacing: 5) {
                Circle().frame(width: 7, height: 7)
                Capsule().frame(height: 3)
            }
            .frame(maxWidth: .infinity)
            .foregroundStyle(.purple)
            .padding(.horizontal, 2)
            .offset(y: -5)
            .allowsHitTesting(false)
            .zIndex(1)
            .transition(.opacity)
            .accessibilityHidden(true)
        }
    }

    private func createTask() {
        store.createTask(title: newTask)
        newTask = ""
    }

    private func updateTaskDrag(taskId: String, location: CGPoint) {
        let target = RatkoTaskDropLayout(frames: taskDropFrames).location(at: location)
        if draggingTaskId == nil {
            RatkoUiTestDiagnostics.log("drag-start task=\(taskId)")
        }
        if taskDropLocation != target {
            RatkoUiTestDiagnostics.log("drag-preview point=\(location) target=\(String(describing: target))")
        }
        draggingTaskId = taskId
        taskDropLocation = target
        dragAutoScroller.updateForPointer()
    }

    private func finishTaskDrag(taskId: String, location: CGPoint) {
        dragAutoScroller.stop()
        let target = RatkoTaskDropLayout(frames: taskDropFrames).location(at: location)
        RatkoUiTestDiagnostics.log("drag-end task=\(taskId) point=\(location) target=\(String(describing: target))")
        if let target, taskId != target.beforeTaskId {
            store.moveTask(taskId, to: target.list, before: target.beforeTaskId)
        }
        draggingTaskId = nil
        taskDropLocation = nil
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
    @Environment(\.openWindow) private var openWindow
    @State private var newStep = ""
    @State private var memo = ""
    @State private var showingMemo = false
    @State private var editingStepIndex: Int?
    @State private var editingStepText = ""
    @FocusState private var stepEditorFocused: Bool

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
                .help("버튼과 입력칸을 제외한 카드 공간을 끌어 순서 바꾸기")
                .accessibilityLabel("작업 카드 순서 바꾸기")
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Circle().fill(timer.phase == .running ? .green : timer.phase == .paused ? .orange : .gray)
                        .frame(width: 7, height: 7)
                    Text(phaseLabel).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Text(formattedElapsed(store.elapsed(for: timer))).font(.system(.body, design: .monospaced)).bold()
                }
                .contentShape(Rectangle())
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
                            TextField("[인간] 설계 / [AI] 구현", text: $editingStepText)
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
                                .contentShape(Rectangle())
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
                    TextField("[인간] 설계 / [AI] 구현", text: $newStep)
                        .textFieldStyle(.roundedBorder).font(.caption).onSubmit(addStep)
                    Button(action: addStep) { Image(systemName: "plus") }.buttonStyle(.borderless)
                }
                HStack {
                    Button {
                        store.requestTaskAiStepFill(task.id)
                        RatkoTaskAiWindowPresentation.open(taskId: task.id, using: openWindow)
                    } label: {
                        Label("AI 단계 채우기", systemImage: "sparkles")
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    Button { RatkoTaskAiWindowPresentation.open(taskId: task.id, using: openWindow) } label: {
                        Label("AI와 대화", systemImage: "bubble.left.and.bubble.right")
                    }
                    .buttonStyle(.plain)
                }
                .font(.caption)
                .foregroundStyle(.purple)
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
        }
        .contentShape(RoundedRectangle(cornerRadius: 12))
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

private struct NextTaskRow: View {
    @ObservedObject var store: RatkoStore
    let task: TaskCard
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 7)
                .fill(Color.primary.opacity(0.001))
                .help("버튼을 제외한 카드 공간을 끌어 순서 바꾸기")
                .accessibilityLabel("작업 카드 순서 바꾸기")
            HStack(spacing: 8) {
                Text(statusLabel(task.status))
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 48, alignment: .leading)
                    .contentShape(Rectangle())
                Button(task.title) { store.openTask(task) }
                    .buttonStyle(.plain)
                    .lineLimit(1)
                Spacer()
                Button {
                    store.requestTaskAiStepFill(task.id)
                    RatkoTaskAiWindowPresentation.open(taskId: task.id, using: openWindow)
                } label: { Image(systemName: "sparkles") }
                    .buttonStyle(.borderless).help("AI 단계 채우기")
                Button { RatkoTaskAiWindowPresentation.open(taskId: task.id, using: openWindow) } label: {
                    Image(systemName: "bubble.left.and.bubble.right")
                }
                .buttonStyle(.borderless).help("이 태스크로 AI와 대화")
                Button { store.focus(task.id) } label: { Image(systemName: "play.fill") }
                    .buttonStyle(.borderless).help("집중 시작")
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 2)
        }
        .contentShape(RoundedRectangle(cornerRadius: 7))
    }

}

struct FloatingFocusView: View {
    @ObservedObject var store: RatkoStore
    @Environment(\.openWindow) private var openWindow

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
                    Button { RatkoTaskAiWindowPresentation.open(taskId: task.id, using: openWindow) } label: {
                        Image(systemName: "bubble.left.and.bubble.right")
                    }
                    .buttonStyle(.borderless).help("이 태스크로 AI와 대화")
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
