// A11yProbe.swift -- throwaway probe (never to merge): logs, once a second while the window's presentations change, each window's presentation chain and every view marked accessibility-modal, so a CI run shows why the Model sheet over New agent stands outside the accessibility tree.

import UIKit

enum A11yProbe {
  private static var last = ""
  private static var timer: Timer?

  static func start() {
    DispatchQueue.main.async {
      guard timer == nil else { return }
      timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in dump() }
    }
  }

  private static func describe(_ view: UIView) -> String {
    let a11y = "modal=\(view.accessibilityViewIsModal) hidden=\(view.accessibilityElementsHidden) isEl=\(view.isAccessibilityElement)"
    return "\(type(of: view)) frame=\(view.frame.integral) \(a11y) superview=\(view.superview.map { "\(type(of: $0))" } ?? "nil")"
  }

  private static func modalViews(_ view: UIView, depth: Int, into lines: inout [String]) {
    if view.accessibilityViewIsModal || view.accessibilityElementsHidden {
      var chain: [String] = []
      var up: UIView? = view.superview
      while let current = up { chain.append("\(type(of: current))"); up = current.superview }
      lines.append("  MARKED depth=\(depth) \(describe(view)) chain=\(chain.joined(separator: "<"))")
    }
    for child in view.subviews { modalViews(child, depth: depth + 1, into: &lines) }
  }

  private static func dump() {
    var lines: [String] = []
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    for scene in scenes {
      for window in scene.windows {
        lines.append("WINDOW \(type(of: window)) level=\(window.windowLevel.rawValue) key=\(window.isKeyWindow) hidden=\(window.isHidden) \(describe(window))")
        for child in window.subviews { lines.append("  TOP \(describe(child))") }
        var vc = window.rootViewController
        var step = 0
        while let current = vc {
          let presenter = current.presentingViewController.map { "\(type(of: $0))" } ?? "nil"
          lines.append("  VC[\(step)] \(type(of: current)) style=\(current.modalPresentationStyle.rawValue) presenter=\(presenter) view: \(current.isViewLoaded ? describe(current.view) : "not loaded")")
          if let container = current.presentationController?.containerView { lines.append("    CONTAINER \(describe(container))") }
          vc = current.presentedViewController
          step += 1
        }
        modalViews(window, depth: 0, into: &lines)
      }
    }
    let text = lines.joined(separator: "\n")
    guard text != last else { return }
    last = text
    for line in lines { NSLog("A11YPROBE %@", line) }
    NSLog("A11YPROBE ---- end of dump")
  }
}
