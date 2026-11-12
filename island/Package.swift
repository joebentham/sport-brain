// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "SportBrainIsland",
    platforms: [.macOS(.v14)],
    targets: [.executableTarget(name: "SportBrainIsland", path: "Sources/SportBrainIsland")]
)
