import AppKit
import CoreServices
import Foundation
import UserNotifications

enum AiSessionNotificationPermission: Equatable {
    case unknown
    case enabled
    case denied
}

struct AiSessionWaitingTracker {
    private var hasBaseline = false
    private var waitingActivityBySession: [String: Date] = [:]

    mutating func ingest(_ reports: [AiSessionReport]) -> [AiSessionReport] {
        let waiting = reports.filter {
            $0.kind == .interactive && $0.activity == .waitingForHuman
        }
        let waitingBySession = Dictionary(waiting.map { (sessionIdentity($0), $0) }) { left, right in
            (left.lastActivity ?? .distantPast) >= (right.lastActivity ?? .distantPast) ? left : right
        }
        let current = waitingBySession.mapValues { $0.lastActivity ?? .distantPast }
        guard hasBaseline else {
            hasBaseline = true
            waitingActivityBySession = current
            return []
        }

        let transitioned = waitingBySession.compactMap { identity, report -> AiSessionReport? in
            guard let previous = waitingActivityBySession[identity] else { return report }
            return (report.lastActivity ?? .distantPast) > previous ? report : nil
        }
        waitingActivityBySession.merge(current) { max($0, $1) }
        return transitioned
    }

    private func sessionIdentity(_ report: AiSessionReport) -> String {
        report.sessionKey ?? report.id
    }
}

enum AiSessionNotifications {
    static func requestPermission(completion: @escaping (AiSessionNotificationPermission) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in
            center.getNotificationSettings { settings in
                completion(permission(from: settings.authorizationStatus))
            }
        }
    }

    static func refreshPermission(completion: @escaping (AiSessionNotificationPermission) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            completion(permission(from: settings.authorizationStatus))
        }
    }

    static func deliverWaitingNotification(for report: AiSessionReport) {
        let folder = URL(fileURLWithPath: report.cwd).lastPathComponent
        deliver(
            title: "랏코 · 내 차례",
            body: "\(report.taskTitle ?? folder)에서 \(report.provider.rawValue) 응답이 끝났습니다. 확인·검증할 차례입니다.",
            userInfo: ["sessionKey": report.sessionKey ?? report.id]
        )
    }

    static func deliverTestNotification() {
        deliver(
            title: "랏코 · 내 차례",
            body: "알림 동작 점검입니다. 누르면 AI 세션 점검 창이 열립니다.",
            userInfo: ["sessionKey": "ratko-notification-test"]
        )
    }

    private static func deliver(title: String, body: String, userInfo: [AnyHashable: Any]) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = userInfo
        let request = UNNotificationRequest(
            identifier: "ratko-ai-waiting-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request) { error in
            RatkoUiTestDiagnostics.log(
                error.map { "notification error=\($0.localizedDescription)" }
                    ?? "notification delivered id=\(request.identifier)"
            )
        }
    }

    private static func permission(from status: UNAuthorizationStatus) -> AiSessionNotificationPermission {
        switch status {
        case .authorized, .provisional, .ephemeral:
            return .enabled
        case .denied:
            return .denied
        case .notDetermined:
            return .unknown
        @unknown default:
            return .unknown
        }
    }
}

final class RatkoApplicationDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    var onOpenAiSessions: (() -> Void)?
    var onToggleQuickPanel: (() -> Void)?
    private var globalHotKey: RatkoGlobalHotKey?

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        globalHotKey = RatkoGlobalHotKey { [weak self] in
            self?.onToggleQuickPanel?()
        }
        if ProcessInfo.processInfo.environment["RATKO_NOTIFICATION_TEST"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                AiSessionNotifications.deliverTestNotification()
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        DispatchQueue.main.async {
            NSApplication.shared.activate(ignoringOtherApps: true)
            self.onOpenAiSessions?()
        }
        completionHandler()
    }
}

final class AiSessionLogMonitor {
    private var stream: FSEventStreamRef?
    private let queue = DispatchQueue(label: "com.taskmaster.ratko.ai-session-log-monitor")
    private let onChange: () -> Void
    private var watchedPaths = Set<String>()

    init(onChange: @escaping () -> Void) {
        self.onChange = onChange
    }

    deinit { stop() }

    func restart(paths: [String]) {
        let existing = Set(paths.filter { FileManager.default.fileExists(atPath: $0) })
        guard existing != watchedPaths else { return }
        stop()
        watchedPaths = existing
        guard !existing.isEmpty else { return }

        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )
        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            let monitor = Unmanaged<AiSessionLogMonitor>.fromOpaque(info).takeUnretainedValue()
            DispatchQueue.main.async { monitor.onChange() }
        }
        let flags = FSEventStreamCreateFlags(
            kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer
        )
        guard let stream = FSEventStreamCreate(
            nil,
            callback,
            &context,
            Array(existing) as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.75,
            flags
        ) else { return }
        self.stream = stream
        FSEventStreamSetDispatchQueue(stream, queue)
        FSEventStreamStart(stream)
    }

    private func stop() {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }
}
