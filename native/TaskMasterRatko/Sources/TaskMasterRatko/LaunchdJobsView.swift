import AppKit
import SwiftUI

@MainActor
enum RatkoLaunchdWindowPresentation {
    static let identifier = NSUserInterfaceItemIdentifier("ratko-launchd-jobs")

    static func open(using openWindow: OpenWindowAction) {
        openWindow(id: "ratko-launchd-jobs")
        DispatchQueue.main.async {
            NSApplication.shared.activate(ignoringOtherApps: true)
            NSApplication.shared.windows.first { $0.identifier == identifier }?.makeKeyAndOrderFront(nil)
        }
    }

    static func register(_ window: NSWindow) {
        window.identifier = identifier
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}

private struct RatkoLaunchdWindowResolver: NSViewRepresentable {
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
                RatkoLaunchdWindowPresentation.register(window)
            }
        }
    }
}

private enum LaunchdJobFilter: String, CaseIterable, Identifiable {
    case all = "전체"
    case running = "실행 중"
    case problems = "문제"

    var id: String { rawValue }
}

struct LaunchdJobsView: View {
    @ObservedObject var store: LaunchdJobsStore
    @State private var filter: LaunchdJobFilter = .all
    @State private var searchText = ""

    private var visibleJobs: [LaunchdJob] {
        store.jobs.filter { job in
            let matchesFilter: Bool
            switch filter {
            case .all: matchesFilter = true
            case .running: matchesFilter = job.health == .running
            case .problems: matchesFilter = job.health.isProblem || job.health == .unloaded
            }
            let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            return matchesFilter && (query.isEmpty
                || job.displayName.localizedCaseInsensitiveContains(query)
                || job.label.localizedCaseInsensitiveContains(query)
                || job.command.localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .frame(minWidth: 660, minHeight: 560)
        .background(RatkoLaunchdWindowResolver())
        .searchable(text: $searchText, placement: .toolbar, prompt: "라벨·명령 검색")
        .onAppear { store.refresh() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "gearshape.2.fill")
                    .font(.title2)
                    .foregroundStyle(.indigo)
                VStack(alignment: .leading, spacing: 2) {
                    Text("launchd 자동화").font(.headline)
                    Text("~/Library/LaunchAgents의 등록·실행 상태를 읽기 전용으로 점검합니다.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if store.scanState == .running { ProgressView().controlSize(.small) }
                Button {
                    store.refresh()
                } label: {
                    Label("새로고침", systemImage: "arrow.clockwise")
                }
                .disabled(store.scanState == .running)
            }
            HStack(spacing: 9) {
                summaryMetric(store.runningCount, "실행 중", .green)
                summaryMetric(store.waitingCount, "대기 중", .blue)
                summaryMetric(store.problemCount, "문제", .red)
                summaryMetric(store.unloadedCount, "미등록", .secondary)
                Spacer()
                if let date = store.lastScannedAt {
                    Text("\(date.formatted(date: .omitted, time: .standard)) 점검")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            Picker("표시", selection: $filter) {
                ForEach(LaunchdJobFilter.allCases) { item in
                    Text(item.rawValue).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 360)
        }
        .padding(16)
    }

    @ViewBuilder
    private var content: some View {
        if store.scanState == .running && store.jobs.isEmpty {
            VStack(spacing: 12) {
                ProgressView()
                Text("사용자 LaunchAgent 상태를 읽는 중입니다.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if case .error(let message) = store.scanState, store.jobs.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.title).foregroundStyle(.orange)
                Text(message).multilineTextAlignment(.center)
                Button("다시 점검") { store.refresh() }
            }
            .padding(30)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if visibleJobs.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.largeTitle).foregroundStyle(.secondary)
                Text("조건에 맞는 LaunchAgent가 없습니다.").font(.headline)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if store.problemCount > 0 { problemNotice }
                    ForEach(visibleJobs) { job in
                        LaunchdJobRow(job: job)
                    }
                }
                .padding(16)
            }
        }
    }

    private var problemNotice: some View {
        Label(
            "재시도·실패는 마지막 실행이 비정상 종료된 잡입니다. 미등록은 plist는 있지만 현재 launchd에 올라오지 않은 잡입니다.",
            systemImage: "exclamationmark.triangle.fill"
        )
        .font(.caption)
        .foregroundStyle(.orange)
        .fixedSize(horizontal: false, vertical: true)
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    private func summaryMetric(_ value: Int, _ label: String, _ color: Color) -> some View {
        HStack(spacing: 5) {
            Text("\(value)").font(.headline).foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(.quaternary.opacity(0.5), in: Capsule())
    }
}

private struct LaunchdJobRow: View {
    let job: LaunchdJob

    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 9) {
                detail("명령", job.command)
                detail("plist", job.plistURL.path)
                HStack(spacing: 12) {
                    if let runCount = job.runCount { Text("실행 \(runCount)회") }
                    Text(job.lastResult)
                    if let state = job.state { Text("launchd: \(state)") }
                }
                .font(.caption2).foregroundStyle(.secondary)
                HStack(spacing: 12) {
                    Button("plist 열기") { NSWorkspace.shared.open(job.plistURL) }
                    if let path = existingPath(job.standardOutPath) {
                        Button("출력 로그") { NSWorkspace.shared.open(URL(fileURLWithPath: path)) }
                    }
                    if let path = existingPath(job.standardErrorPath), path != job.standardOutPath {
                        Button("오류 로그") { NSWorkspace.shared.open(URL(fileURLWithPath: path)) }
                    }
                }
                .buttonStyle(.link)
                .font(.caption)
            }
            .padding(.top, 9)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Circle().fill(statusColor).frame(width: 9, height: 9).padding(.top, 4)
                VStack(alignment: .leading, spacing: 4) {
                    Text(job.displayName).font(.subheadline).bold()
                    Text(job.label)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    HStack(spacing: 7) {
                        Text(job.schedule)
                        if let pid = job.pid { Text("PID \(pid)") }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(job.health.label)
                    .font(.caption2).bold().foregroundStyle(statusColor)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(statusColor.opacity(0.1), in: Capsule())
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private var statusColor: Color {
        switch job.health {
        case .running: .green
        case .waiting: .blue
        case .retrying: .orange
        case .failed: .red
        case .unloaded: .secondary
        }
    }

    private func detail(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func existingPath(_ path: String?) -> String? {
        guard let path, FileManager.default.fileExists(atPath: path) else { return nil }
        return path
    }
}
