import AppKit
import SwiftUI

@MainActor
enum RatkoAiSessionsWindowPresentation {
    static let identifier = NSUserInterfaceItemIdentifier("ratko-ai-sessions")
    private static var appKitWindow: NSWindow?

    static func open(using openWindow: OpenWindowAction) {
        openWindow(id: "ratko-ai-sessions")
        DispatchQueue.main.async {
            NSApplication.shared.activate(ignoringOtherApps: true)
            NSApplication.shared.windows.first { $0.identifier == identifier }?.makeKeyAndOrderFront(nil)
        }
    }

    static func open(store: RatkoStore) {
        if let window = NSApplication.shared.windows.first(where: { $0.identifier == identifier }) {
            NSApplication.shared.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            return
        }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 700, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "AI 세션 점검"
        window.identifier = identifier
        window.contentView = NSHostingView(rootView: AiSessionsView(store: store))
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        appKitWindow = window
    }

    static func register(_ window: NSWindow) {
        window.identifier = identifier
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}

private struct RatkoAiSessionsWindowResolver: NSViewRepresentable {
    func makeNSView(context: Context) -> ResolverView { ResolverView() }
    func updateNSView(_ nsView: ResolverView, context: Context) { nsView.resolve() }

    final class ResolverView: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            resolve()
        }

        func resolve() {
            guard let window else { return }
            DispatchQueue.main.async { [weak window] in
                guard let window else { return }
                RatkoAiSessionsWindowPresentation.register(window)
            }
        }
    }
}

struct AiSessionsView: View {
    @ObservedObject var store: RatkoStore

    private var running: [AiSessionReport] {
        store.interactiveAiSessionReports.filter { $0.activity == .running }
    }

    private var waiting: [AiSessionReport] {
        store.interactiveAiSessionReports.filter { $0.activity != .running }
    }

    private var needsClaudeLogAccess: Bool {
        store.interactiveAiSessionReports.contains { $0.provider == .claude && $0.transcriptPath == nil }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .frame(minWidth: 620, minHeight: 560)
        .background(RatkoAiSessionsWindowResolver())
        .onAppear {
            store.refreshAiSessionNotificationPermission()
            if store.aiSessionScanState == .idle { store.scanAiSessions() }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "waveform.path.ecg")
                .font(.title2)
                .foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 2) {
                Text("AI 세션 점검").font(.headline)
                Text("직접 점검하거나 로그 변경이 있을 때만 로컬 Claude·Codex 기록을 읽습니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            notificationPermissionStatus
            if store.aiSessionScanState == .running {
                ProgressView().controlSize(.small)
            }
            Button {
                store.scanAiSessions()
            } label: {
                Label("새로 점검", systemImage: "arrow.clockwise")
            }
            .disabled(store.aiSessionScanState == .running)
        }
        .padding(16)
    }

    @ViewBuilder
    private var notificationPermissionStatus: some View {
        switch store.aiSessionNotificationPermission {
        case .enabled:
            Label("내 차례 알림", systemImage: "bell.fill")
                .font(.caption).foregroundStyle(.green)
        case .denied:
            Button("알림 켜기") { store.openNotificationSettings() }
                .font(.caption)
        case .unknown:
            EmptyView()
        }
    }

    @ViewBuilder
    private var content: some View {
        if store.aiSessionScanState == .running && store.aiSessionReports.isEmpty {
            VStack(spacing: 12) {
                ProgressView()
                Text("열려 있는 세션과 로컬 대화 기록을 맞추는 중입니다.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if case .error(let message) = store.aiSessionScanState, store.aiSessionReports.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill").font(.title).foregroundStyle(.orange)
                Text(message).multilineTextAlignment(.center)
                Button("다시 점검") { store.scanAiSessions() }
            }
            .padding(30)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if store.interactiveAiSessionReports.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: "moon.zzz").font(.largeTitle).foregroundStyle(.secondary)
                Text("열려 있는 대화형 AI 세션이 없습니다.").font(.headline)
                if !store.automationAiSessionReports.isEmpty {
                    Text("자동화·하위 에이전트 \(store.automationAiSessionReports.count)개는 WIP에서 제외했습니다.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if needsClaudeLogAccess { claudeLogAccessPrompt }
                    if store.aiSessionCreatedTaskCount > 0 { autoCreatedTasksNotice }
                    scanSummary
                    sessionSection(title: "AI가 진행 중", icon: "bolt.fill", color: .blue, reports: running)
                    sessionSection(title: "내 응답·검증 대기", icon: "person.fill", color: .orange, reports: waiting)
                    if !store.automationAiSessionReports.isEmpty { excludedAutomation }
                    measurementContract
                }
                .padding(16)
            }
        }
    }

    private var claudeLogAccessPrompt: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "folder.badge.questionmark")
                .font(.title2)
                .foregroundStyle(.purple)
            VStack(alignment: .leading, spacing: 3) {
                Text("Claude 대화 기록을 연결해 주세요").font(.subheadline).bold()
                Text("현재 열린 Claude 프로젝트의 기록 폴더를 한 번씩 연결하면, 이후에는 요청할 때만 읽습니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("현재 폴더 연결") { store.connectClaudeLogs() }
                .buttonStyle(.borderedProminent)
        }
        .padding(12)
        .background(.purple.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    private var scanSummary: some View {
        HStack(spacing: 10) {
            summaryMetric(value: store.runningAiSessionCount, label: "AI 진행", color: .blue)
            summaryMetric(value: store.waitingAiSessionCount, label: "내 차례", color: .orange)
            summaryMetric(
                value: store.interactiveAiSessionReports.filter { $0.taskId == nil }.count,
                label: "태스크 미연결",
                color: .secondary
            )
            Spacer()
            if let date = store.aiSessionLastScannedAt {
                Text("\(date.formatted(date: .omitted, time: .shortened)) 점검")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private var autoCreatedTasksNotice: some View {
        Label(
            "미연결 AI 세션 \(store.aiSessionCreatedTaskCount)개를 TaskMaster 태스크로 자동 생성했습니다.",
            systemImage: "checkmark.circle.fill"
        )
        .font(.caption)
        .foregroundStyle(.green)
        .padding(.horizontal, 2)
    }

    private func summaryMetric(value: Int, label: String, color: Color) -> some View {
        HStack(spacing: 5) {
            Text("\(value)").font(.headline).foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(.quaternary.opacity(0.5), in: Capsule())
    }

    @ViewBuilder
    private func sessionSection(title: String, icon: String, color: Color, reports: [AiSessionReport]) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Label("\(title) · \(reports.count)", systemImage: icon)
                .font(.subheadline).bold().foregroundStyle(color)
            if reports.isEmpty {
                Text("해당 세션이 없습니다.")
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(.leading, 2)
            } else {
                ForEach(reports) { report in
                    AiSessionCard(store: store, report: report)
                }
            }
        }
    }

    private var excludedAutomation: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "gearshape.2")
            Text("자동화·하위 에이전트 \(store.automationAiSessionReports.count)개는 사람의 열린 작업 수와 시간에서 제외했습니다.")
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.caption).foregroundStyle(.secondary)
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
    }

    private var measurementContract: some View {
        Text("[AI]는 대화 로그의 실행 구간, [인간]은 연결된 TaskMaster 단계 타이머입니다. 응답 대기 시간은 둘 다에 더하지 않습니다.")
            .font(.caption2).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct AiSessionCard: View {
    @ObservedObject var store: RatkoStore
    let report: AiSessionReport

    private var folderName: String {
        URL(fileURLWithPath: report.cwd).lastPathComponent
    }

    private var openState: AiSessionOrcaOpenState {
        store.aiSessionOrcaOpenState(for: report)
    }

    var body: some View {
        Button {
            store.openAiSessionInOrca(report)
        } label: {
            cardContent
        }
        .buttonStyle(.plain)
        .disabled(openState == .opening)
        .accessibilityLabel("\(folderName)의 \(report.provider.rawValue) 세션을 Orca에서 열기")
        .help("해당 AI 세션이 실행 중인 Orca 터미널로 이동")
    }

    private var cardContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 7) {
                Text(report.provider.rawValue).font(.caption).bold()
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(providerColor.opacity(0.12), in: Capsule())
                    .foregroundStyle(providerColor)
                Text(folderName).font(.subheadline).bold().lineLimit(1)
                Spacer()
                if report.taskId == nil {
                    Text("태스크 미연결").font(.caption2).foregroundStyle(.secondary)
                }
                orcaOpenIndicator
            }

            Text(report.summary)
                .font(.callout)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            if report.transcriptPath != nil {
                HStack(spacing: 12) {
                    measurement(label: "[AI]", value: report.aiMilliseconds, color: .blue)
                    if report.taskId != nil {
                        measurement(label: "[인간]", value: report.humanMilliseconds, color: .green)
                    }
                    if report.waitingMilliseconds > 0 {
                        Text("응답 대기 \(compactDuration(report.waitingMilliseconds)) · 제외")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }

            if !report.phases.isEmpty {
                HStack(spacing: 5) {
                    ForEach(report.phases.prefix(4)) { phase in
                        Text("\(phase.name) \(compactDuration(phase.milliseconds))")
                            .font(.caption2)
                            .padding(.horizontal, 7).padding(.vertical, 4)
                            .background(.quaternary.opacity(0.55), in: Capsule())
                    }
                }
            }

            if let taskTitle = report.taskTitle {
                Label(taskTitle, systemImage: "checklist")
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }

            if case .failure(let message) = openState {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private var orcaOpenIndicator: some View {
        switch openState {
        case .opening:
            ProgressView().controlSize(.small)
        case .idle, .failure:
            Label("Orca에서 열기", systemImage: "arrow.up.forward.app")
                .font(.caption2).foregroundStyle(.blue)
        }
    }

    private var providerColor: Color { report.provider == .claude ? .purple : .blue }

    private func measurement(label: String, value: Double, color: Color) -> some View {
        HStack(spacing: 4) {
            Text(label).bold().foregroundStyle(color)
            Text(compactDuration(value))
        }
        .font(.caption)
    }
}

enum AiSessionOrcaOpenState: Equatable {
    case idle
    case opening
    case failure(String)
}

private func compactDuration(_ milliseconds: Double) -> String {
    let totalMinutes = max(0, Int(milliseconds / 60_000))
    if totalMinutes >= 60 { return "\(totalMinutes / 60)시간 \(totalMinutes % 60)분" }
    if totalMinutes > 0 { return "\(totalMinutes)분" }
    return "<1분"
}
