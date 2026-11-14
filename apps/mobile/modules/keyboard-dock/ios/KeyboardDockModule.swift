// KeyboardDockModule.swift -- a screen that lifts the bar at its foot with the system's keyboard, read frame by frame from UIKit's keyboard layout guide, and tells JavaScript how far the keyboard stands over it.
//
// `@repo/ui-native`'s `GlassDock` stands its content and its bar inside this
// view (`keyboard-dock.ts`), the bar as its last child. React Native hears the
// keyboard only as it is announced to rise or fall, so a bar it lifts stands
// still while a drag pulls the keyboard down under the finger, then jumps.
// UIKit's keyboard layout guide follows the keyboard through that drag, the
// suggestion strip's growth and a form sheet's own lift, so the lift is read
// here at each layout pass, inside the keyboard's own animation, after it
// settles, and on each frame drawn while the keyboard stands, and set on the
// bar as a transform, which React Native's layout leaves alone. A view that
// stops being the bar, as a page goes back with the keyboard up, is set down
// before Fabric can draw it anew elsewhere still lifted. Note that the display
// link holds this view while it runs, so it stops as the view leaves its
// window, which it does before it goes. JavaScript
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

  /// The view the dock last lifted, so a view that stops being the bar, as a page goes Back with the keyboard up, is set down before Fabric draws it anew elsewhere.
  private weak var lifted: UIView?

  /// Follows the keyboard each frame while it stands, since a drag that pulls it down moves the layout guide without asking this view for a layout pass.
  private var frames: CADisplayLink?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    keyboardLayoutGuide.followsUndockedKeyboard = false
    // Note that the guide's top then stands at this view's foot while the keyboard is down, rather than at the safe area's, so no keyboard reads as no overlap.
    keyboardLayoutGuide.usesBottomSafeArea = false
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(keyboardWillMove), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardDidMove), name: UIResponder.keyboardDidChangeFrameNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardDidShow), name: UIResponder.keyboardDidShowNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardDidHide), name: UIResponder.keyboardDidHideNotification, object: nil)
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    frames?.invalidate()
  }

  /// Lays the view out inside the keyboard's announced move, so the bar's lift rides the keyboard's own curve rather than landing after it.
  @objc private func keyboardWillMove() {
    setNeedsLayout()
    layoutIfNeeded()
  }

  /// Reads the overlap again once the keyboard has settled, since a form sheet lifts itself after the keyboard's announced move, which only moves this view's place, not its size.
  @objc private func keyboardDidMove() {
    follow()
  }

  /// Follows the keyboard frame by frame while it stands.
  @objc private func keyboardDidShow() {
    guard frames == nil, window != nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(frameDrawn))
    link.add(to: .main, forMode: .common)
    frames = link
  }

  @objc private func keyboardDidHide() {
    frames?.invalidate()
    frames = nil
    follow()
  }

  @objc private func frameDrawn() {
    follow()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window == nil else { return }
    frames?.invalidate()
    frames = nil
    setDown()
  }

  override func willRemoveSubview(_ subview: UIView) {
    super.willRemoveSubview(subview)
    if subview === lifted { setDown() }
  }

  /// Sets the lifted view back where its layout stands it.
  private func setDown() {
    lifted?.transform = .identity
    lifted = nil
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

    if let bar = subviews.last, subviews.count > 1 {
      if bar !== lifted { setDown() }
      bar.transform = lift > 0 ? CGAffineTransform(translationX: 0, y: -lift) : .identity
      lifted = bar
    }

    if let was = told, abs(was - overlap) < overlapStep { return }
    told = overlap
    onOverlap(["overlap": overlap])
  }
}
