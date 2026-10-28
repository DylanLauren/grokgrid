// Native macOS permission owner for the local, pinned-window publisher.
// No wallet or ingestion secret is loaded by this app.
import AppKit
import CoreGraphics
import Foundation

final class PhoneApp: NSObject, NSApplicationDelegate {
    var child: Process?
    var item: NSStatusItem!
    var requestedPermission = false
    var quitting = false
    var timer: Timer?
    let runtime = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/grokgrid/runtime")
    var pauseFile: URL { runtime.appendingPathComponent("phone-app-paused") }

    func status(_ state: String) {
        let body: [String: Any] = ["state": state, "observedAt": ISO8601DateFormatter().string(from: Date()),
                                  "capturePermission": CGPreflightScreenCaptureAccess(), "publisherSupervisorRunning": child?.isRunning ?? false]
        if let data = try? JSONSerialization.data(withJSONObject: body) {
            let path = runtime.appendingPathComponent("phone-app-status.json")
            try? data.write(to: path, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        }
        item?.button?.toolTip = "GrokGrid Phone: " + state
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        umask(0o077)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "GG"
        let menu = NSMenu()
        for (title, action) in [("Resume / check capture permission", #selector(resume)), ("Pause screen publishing", #selector(pause)), ("Quit and keep publishing paused", #selector(quit))] {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
            entry.target = self; menu.addItem(entry)
        }
        item.menu = menu
        start()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            if self.child == nil && CGPreflightScreenCaptureAccess() && !FileManager.default.fileExists(atPath: self.pauseFile.path) { self.start() }
        }
    }
    func start() {
        guard !quitting && child == nil else { return }
        if FileManager.default.fileExists(atPath: pauseFile.path) { status("paused"); return }
        guard CGPreflightScreenCaptureAccess() else {
            status("screen-recording-permission-required")
            if !requestedPermission { requestedPermission = true; _ = CGRequestScreenCaptureAccess() }
            return
        }
        guard let node = Bundle.main.object(forInfoDictionaryKey: "GrokGridNodePath") as? String,
              let supervisor = Bundle.main.object(forInfoDictionaryKey: "GrokGridSupervisorPath") as? String,
              let config = Bundle.main.object(forInfoDictionaryKey: "GrokGridConfigPath") as? String else { status("installation-incomplete"); return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [supervisor, "--config", config]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        process.terminationHandler = { [weak self] _ in DispatchQueue.main.async {
            guard let self = self else { return }
            self.child = nil
            // An unexpectedly exiting supervisor requires operator review, not
            // an application-level loop around an authorization rejection.
            if !self.quitting { try? Data().write(to: self.pauseFile, options: .atomic); self.status("supervisor-stopped-review-required") }
        }}
        do { try process.run(); child = process; status("supervisor-running") }
        catch { status("supervisor-start-failed"); try? Data().write(to: pauseFile, options: .atomic) }
    }
    @objc func resume() { try? FileManager.default.removeItem(at: pauseFile); requestedPermission = false; start() }
    @objc func pause() { try? Data().write(to: pauseFile, options: .atomic); child?.terminate(); status("paused") }
    @objc func quit() { quitting = true; try? Data().write(to: pauseFile, options: .atomic); NSApplication.shared.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) {
        quitting = true; timer?.invalidate()
        if let process = child, process.isRunning { process.terminate(); process.waitUntilExit() }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = PhoneApp()
app.delegate = delegate
app.run()
