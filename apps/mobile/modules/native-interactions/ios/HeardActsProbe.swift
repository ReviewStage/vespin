// HeardActsProbe.swift -- for measurement only, never merged: with `-logHeardActs true` beside `-fixture`, logs each accessibility element's VoiceOver Actions, as UIKit's own tree holds them, so a run before and after a change can compare what VoiceOver offers on each row.

import UIKit

enum HeardActsProbe {
  /// Each line logged, so a row is logged once per run whatever how often it's walked.
  private static var logged = Set<String>()

  /// Starts the walk where the launch asked for it, on a fixture only.
  static func startIfAsked() {
    let defaults = UserDefaults.standard
    guard defaults.bool(forKey: "logHeardActs"), defaults.string(forKey: "fixture") != nil else { return }
    DispatchQueue.main.async { tick() }
  }

  /// Walks every window's accessibility tree, then again in two seconds, as a flow moves on.
  private static func tick() {
    for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
      for window in scene.windows { visit(window, depth: 0) }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { tick() }
  }

  /// Logs an element's Actions by its label, then walks its subviews and accessibility elements.
  private static func visit(_ object: NSObject, depth: Int) {
    guard depth < 80 else { return }
    if let actions = object.accessibilityCustomActions, !actions.isEmpty {
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
