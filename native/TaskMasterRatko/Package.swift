// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TaskMasterRatko",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "TaskMasterRatko", targets: ["TaskMasterRatko"]),
    ],
    targets: [
        .executableTarget(name: "TaskMasterRatko"),
        .testTarget(
            name: "TaskMasterRatkoTests",
            dependencies: ["TaskMasterRatko"]
        ),
    ],
    swiftLanguageModes: [.v5]
)
