import AppKit
import Carbon.HIToolbox

enum RatkoGlobalShortcutSpec {
    static let displayName = "⌘T"
    static let keyCode = UInt32(kVK_ANSI_T)
    static let modifiers = UInt32(cmdKey)

    fileprivate static let signature: OSType = 0x52544B4F // RTKO
    fileprivate static let identifier: UInt32 = 1
}

final class RatkoGlobalHotKey {
    private let onTrigger: () -> Void
    private var hotKey: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?

    init?(onTrigger: @escaping () -> Void) {
        self.onTrigger = onTrigger

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let handlerStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, userData in
                guard let event, let userData else { return OSStatus(eventNotHandledErr) }
                let controller = Unmanaged<RatkoGlobalHotKey>
                    .fromOpaque(userData)
                    .takeUnretainedValue()
                var hotKeyID = EventHotKeyID()
                let parameterStatus = GetEventParameter(
                    event,
                    EventParamName(kEventParamDirectObject),
                    EventParamType(typeEventHotKeyID),
                    nil,
                    MemoryLayout<EventHotKeyID>.size,
                    nil,
                    &hotKeyID
                )
                guard parameterStatus == noErr,
                      hotKeyID.signature == RatkoGlobalShortcutSpec.signature,
                      hotKeyID.id == RatkoGlobalShortcutSpec.identifier
                else { return OSStatus(eventNotHandledErr) }

                DispatchQueue.main.async {
                    NSLog("[Ratko] 전역 단축키 %@ 입력", RatkoGlobalShortcutSpec.displayName)
                    controller.onTrigger()
                }
                return noErr
            },
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &eventHandler
        )
        guard handlerStatus == noErr else {
            NSLog("[Ratko] 전역 단축키 이벤트 핸들러 등록 실패: %d", handlerStatus)
            return nil
        }

        let hotKeyID = EventHotKeyID(
            signature: RatkoGlobalShortcutSpec.signature,
            id: RatkoGlobalShortcutSpec.identifier
        )
        let hotKeyStatus = RegisterEventHotKey(
            RatkoGlobalShortcutSpec.keyCode,
            RatkoGlobalShortcutSpec.modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKey
        )
        guard hotKeyStatus == noErr else {
            if let eventHandler { RemoveEventHandler(eventHandler) }
            self.eventHandler = nil
            NSLog(
                "[Ratko] 전역 단축키 %@ 등록 실패: %d",
                RatkoGlobalShortcutSpec.displayName,
                hotKeyStatus
            )
            return nil
        }
        NSLog("[Ratko] 전역 단축키 %@ 등록 완료", RatkoGlobalShortcutSpec.displayName)
    }

    deinit {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
    }
}
