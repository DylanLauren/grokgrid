// Read metadata for only the explicitly selected window. Never enumerate titles in output.
import AppKit
import CoreGraphics
import Foundation
let requested = UInt32(CommandLine.arguments.dropFirst().first ?? "") ?? 0
let items = CGWindowListCopyWindowInfo([.optionIncludingWindow], requested) as? [[String: Any]] ?? []
if let item = items.first(where: { ($0[kCGWindowNumber as String] as? UInt32) == requested }),
   let pid = item[kCGWindowOwnerPID as String] as? Int32,
   let app = NSRunningApplication(processIdentifier: pid),
   let raw = item[kCGWindowBounds as String] as? [String: Any] {
  let result: [String: Any] = [
    "id": requested, "pid": pid, "bundleId": app.bundleIdentifier ?? "",
    "title": item[kCGWindowName as String] as? String ?? "",
    "onScreen": item[kCGWindowIsOnscreen as String] as? Bool ?? false,
    "layer": item[kCGWindowLayer as String] as? Int ?? -1,
    "bounds": ["x": raw["X"] ?? 0, "y": raw["Y"] ?? 0, "width": raw["Width"] ?? 0, "height": raw["Height"] ?? 0]
  ]
  if let data = try? JSONSerialization.data(withJSONObject: result), let text = String(data: data, encoding: .utf8) { print(text) }
} else { print("null") }
