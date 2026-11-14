// KeyboardDockModule.swift -- a screen that lifts the bar at its foot with the system's keyboard, read frame by frame from UIKit's keyboard layout guide, and tells JavaScript how far the keyboard stands over it.
//
// `@repo/ui-native`'s `GlassDock` stands its content and its bar inside this
// view (`keyboard-dock.ts`), the bar as its last child. React Native hears the
// keyboard only as it is announced to rise or fall, so a bar it lifts stands
// still while a drag pulls the keyboard down under the finger, then jumps.
// UIKit's keyboard layout guide follows the keyboard through that drag, the
// suggestion strip's growth and a form sheet's own lift, so the lift is read
// here at each layout pass and set on the bar as a transform, which React
// Native's layout leaves alone, inside the keyboard's own animation. JavaScript
// hears the same overlap, so the content under the bar leaves room for it.
//
// Note that the overlap is read against this view, which stands still, and
// never against the bar it moves, which would chase its own lift. A keyboard
// undocked or floating on an iPad stands over nothing (`followsUndockedKeyboard`
// off), and a form sheet that has lifted itself past the keyboard leaves no
// overlap to lift by.

import ExpoModulesCore
import UIKit

public final class KeyboardDockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KeyboardDock")

    View(KeyboardDockView.self) {
      Events("onOverlap")
    }
  }
}

/// The least change in the keyboard's overlap, in points, that is told to JavaScript, so a layout pass that moves nothing sends nothing.
private let overlapStep: CGFloat = 0.5

final class KeyboardDockView: ExpoView {
  let onOverlap = EventDispatcher()

  /// The overlap last told to JavaScript; none yet.
  private var told: CGFloat?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    keyboardLayoutGuide.followsUndockedKeyboard = false
    // Note that the guide's top then stands at this view's foot while the keyboard is down, rather than at the safe area's, so no keyboard reads as no overlap.
    keyboardLayoutGuide.usesBottomSafeArea = false
    NotificationCenter.default.addObserver(
      self, selector: #selector(keyboardWillMove), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  /// Lays the view out inside the keyboard's announced move, so the bar's lift rides the keyboard's own curve rather than landing after it.
  @objc private func keyboardWillMove() {
    setNeedsLayout()
    layoutIfNeeded()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    follow()
  }

  /// Lifts the bar by how far the keyboard stands over this view's foot, less the bottom safe area the bar already stands clear of, and tells JavaScript the overlap.
  private func follow() {
    guard window != nil else { return }
    let overlap = max(0, bounds.maxY - keyboardLayoutGuide.layoutFrame.minY)
    let lift = max(0, overlap - safeAreaInsets.bottom)

    if let bar = subviews.last {
      bar.transform = lift > 0 ? CGAffineTransform(translationX: 0, y: -lift) : .identity
    }

    if let was = told, abs(was - overlap) < overlapStep { return }
    told = overlap
    onOverlap(["overlap": overlap])
  }
}
