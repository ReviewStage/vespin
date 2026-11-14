// KeyboardDockModule.swift -- a screen that lifts the bar at its foot with the system's keyboard, read frame by frame from UIKit's keyboard layout guide, stands it as its content's bottom scroll edge, and tells JavaScript how far the keyboard stands over it.
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
// The bar also stands as the content's bottom edge element, so iOS 26 draws
// its soft scroll edge under the bar, as it does under its own bars: words
// scrolling under the composer's glass fade rather than standing sharp behind
// its placeholder and its +.
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

/// How many times, and how far apart, the content's scroll view is looked for while the content holds none yet, such as while a screen reads: about ten seconds.
private let edgeLooks = 20
private let edgeLookPause: TimeInterval = 0.5

/// How deep under the dock's content its scroll view is looked for, so a screen still reading, with no list yet, costs a layout pass little.
private let scrollViewDepth = 8

final class KeyboardDockView: ExpoView {
  let onOverlap = EventDispatcher()

  /// The overlap last told to JavaScript; none yet.
  private var told: CGFloat?

  /// The view the dock last lifted, so a view that stops being the bar, as a page goes Back with the keyboard up, is set down before Fabric draws it anew elsewhere.
  private weak var lifted: UIView?

  /// The bar's standing as the content's bottom edge element, which draws the scroll edge under it.
  private let edge = UIScrollEdgeElementContainerInteraction()

  /// How many more times the content's scroll view is looked for while none is found, and whether a look is already on its way, so a layout pass on each frame doesn't spend them all at once.
  private var looksLeft = edgeLooks
  private var lookPending = false

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
    followFrames()
  }

  /// Starts following the keyboard each frame, where it is not already followed.
  private func followFrames() {
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

  /// Reads the keyboard on each frame drawn. Note that the view is laid out first, so the guide's frame is the keyboard's of this frame rather than the last layout pass's.
  @objc private func frameDrawn() {
    layoutIfNeeded()
    follow()
  }

  /// Follows the keyboard again as the dock comes back into a window with the keyboard already standing, as a page does when the one over it goes back; stops following as it leaves.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window == nil else {
      looksLeft = edgeLooks
      follow()
      if (told ?? 0) > 0 { followFrames() }
      return
    }
    frames?.invalidate()
    frames = nil
    setDown()
  }

  override func willRemoveSubview(_ subview: UIView) {
    super.willRemoveSubview(subview)
    if subview === lifted { setDown() }
    if subview === edge.view { subview.removeInteraction(edge) }
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

  /// Stands the bar as the bottom edge element of the first scroll view the content holds, as soon as both are mounted, and again once the content's scroll view is another, such as a list drawn in place of its skeleton.
  private func standAsEdge() {
    guard let bar = subviews.last, subviews.count > 1 else { return }
    let content = subviews.dropLast()

    if let held = edge.scrollView, held.window != nil, content.contains(where: { held.isDescendant(of: $0) }),
      edge.view === bar
    {
      return
    }

    guard let scroller = content.lazy.compactMap({ firstScrollView(in: $0) }).first else {
      lookAgainSoon()
      return
    }

    edge.view?.removeInteraction(edge)
    edge.edge = .bottom
    edge.scrollView = scroller
    scroller.bottomEdgeEffect.style = .soft
    bar.addInteraction(edge)
    looksLeft = edgeLooks
  }

  /// Looks for the content's scroll view again a moment later, a bounded number of times, since a list mounted deep in the content after its skeleton asks the dock for no layout pass of its own.
  private func lookAgainSoon() {
    guard looksLeft > 0, !lookPending else { return }
    looksLeft -= 1
    lookPending = true
    DispatchQueue.main.asyncAfter(deadline: .now() + edgeLookPause) { [weak self] in
      self?.lookPending = false
      self?.standAsEdge()
    }
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

    standAsEdge()

    if let was = told, abs(was - overlap) < overlapStep { return }
    told = overlap
    onOverlap(["overlap": overlap])
  }
}

/// The first scroll view at or under a view, the shallowest first, so a list's own scroller is found before any it holds in its rows.
private func firstScrollView(in root: UIView) -> UIScrollView? {
  var level: [UIView] = [root]
  for _ in 0..<scrollViewDepth where !level.isEmpty {
    if let found = level.lazy.compactMap({ $0 as? UIScrollView }).first { return found }
    level = level.flatMap(\.subviews)
  }
  return nil
}
