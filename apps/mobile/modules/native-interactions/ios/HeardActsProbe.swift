// HeardActsProbe.swift -- for measurement only, never merged: with `-logHeardActs true` beside `-fixture`, logs each accessibility element's VoiceOver Actions, as UIKit's own tree holds them, so a run before and after a change can compare what VoiceOver offers on each row.

import Darwin
import UIKit

enum HeardActsProbe {
  /// Each line logged, so a row is logged once per run whatever how often it's walked.
  private static var logged = Set<String>()

  /// Starts the walk where the launch asked for it, on a fixture only.
  static func startIfAsked() {
    let defaults = UserDefaults.standard
    guard defaults.bool(forKey: "logHeardActs"), defaults.string(forKey: "fixture") != nil else { return }
    enableAutomation()
    DispatchQueue.main.async { tick() }
  }

  /// What the last walk found, so a change is logged once.
  private static var lastCount = (-1, -1)
  private static var visited = 0
  private static var withActions = 0

  /// Turns the app's accessibility automation on, as KIF does, so UIKit builds the accessibility tree SwiftUI otherwise builds only for an assistive technology.
  private static func enableAutomation() {
    guard let handle = dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW) else {
      NSLog("[Vespin] heard probe: libAccessibility did not open")
      return
    }
    typealias SetEnabled = @convention(c) (Int32) -> Void
    for name in ["_AXSSetAutomationEnabled", "_AXSApplicationAccessibilitySetEnabled"] {
      if let symbol = dlsym(handle, name) {
        unsafeBitCast(symbol, to: SetEnabled.self)(1)
        NSLog("[Vespin] heard probe: %@ on", name)
      }
    }
  }

  /// Walks every window's accessibility tree, then again in two seconds, as a flow moves on.
  private static func tick() {
    visited = 0
    withActions = 0
    for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
      for window in scene.windows { visit(window, depth: 0) }
    }
    if (visited, withActions) != lastCount {
      lastCount = (visited, withActions)
      NSLog("[Vespin] heard walk: %d elements, %d with actions", visited, withActions)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { tick() }
  }

  /// Logs an element's Actions by its label, then walks its subviews and accessibility elements.
  private static func visit(_ object: NSObject, depth: Int) {
    guard depth < 80 else { return }
    visited += 1
    if let actions = object.accessibilityCustomActions, !actions.isEmpty {
      withActions += 1
      let line = "\(object.accessibilityLabel ?? "?") :: " + actions.map { $0.name }.joined(separator: " | ")
      if logged.insert(line).inserted { NSLog("[Vespin] heard %@", line) }
    }
    var children: [NSObject] = []
    if let view = object as? UIView { children += view.subviews }
    if let elements = object.accessibilityElements as? [NSObject] {
      children += elements
    } else {
      let count = object.accessibilityElementCount()
      if count != NSNotFound && count > 0 {
        for index in 0..<count {
          if let element = object.accessibilityElement(at: index) as? NSObject { children.append(element) }
        }
      }
    }
    for child in children { visit(child, depth: depth + 1) }
  }
}
