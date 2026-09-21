import SwiftUI
import AppKit

@main
struct MSPIStorageLocatorApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var authManager = AuthManager()

    var body: some Scene {
        WindowGroup("Storage Locator") {
            ContentView()
                .environmentObject(authManager)
        }
        .defaultSize(width: 760, height: 600)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)

        // Xcode can leave the launched package executable behind the IDE or Terminal.
        // Activate it after SwiftUI has created the WindowGroup window.
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
            NSApp.windows.first?.makeKeyAndOrderFront(nil)
        }
    }
}
