import Foundation

enum MenuBarPlacement {
    static let ratkoPositionKey = "NSStatusItem Preferred Position Item-0"
    static let wifiPositionKey = "NSStatusItem Preferred Position WiFi"

    private static let fallbackWiFiPosition = 243
    private static let leadingOffset = 20

    /// Places Ratko immediately to the left of Wi-Fi, inside the always-visible
    /// portion of menu-bar managers such as Ice or Hidden Bar.
    @discardableResult
    static func pinNextToWiFi(
        ratkoDefaults: UserDefaults = .standard,
        controlCenterDefaults: UserDefaults? = UserDefaults(suiteName: "com.apple.controlcenter")
    ) -> Int {
        let wifiPosition = (controlCenterDefaults?.object(forKey: wifiPositionKey) as? NSNumber)?.intValue
            ?? fallbackWiFiPosition
        let ratkoPosition = wifiPosition + leadingOffset
        ratkoDefaults.set(ratkoPosition, forKey: ratkoPositionKey)
        return ratkoPosition
    }
}
