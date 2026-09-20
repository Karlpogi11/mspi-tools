// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MSPIStorageLocator",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "MSPIStorageLocator",
            targets: ["MSPIStorageLocator"]
        ),
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "MSPIStorageLocator",
            path: "Sources/MSPIStorageLocator"
        ),
    ]
)
