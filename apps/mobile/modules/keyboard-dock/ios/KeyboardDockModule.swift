// KeyboardDockModule.swift -- a screen that lifts the bar at its foot with the system's keyboard, read frame by frame from UIKit's keyboard layout guide, stands it as its content's bottom scroll edge, and tells JavaScript how far the keyboard stands over it.
//
// `@repo/ui-native`'s `GlassDock` stands its content and its bar inside this
// view (`keyboard-dock.ts`), the bar as its last child. React Native hears the
// keyboard only as it is announced to rise or fall, so a bar it lifts stands
// still while a drag pulls the keyboard down under the finger, then jumps.
// UIKit's keyboard layout guide follows the keyboard through that drag, the
// suggestion strip's growth and a form sheet's own lift, as Apple documents
// it, and a view constrained to it is laid out as it moves. So a hidden probe
// of the dock's own is pinned to the guide's top, which lays the dock out at
// each step of the keyboard, inside its own animation and through a drag
// alike, and the lift is read at each layout pass and set on the bar as a
// transform. Note that the bar itself can't be pinned to the guide, because
// React Native's layout sets its frame, and a transform is what that layout
// leaves alone. A view that stops being the bar, as a page goes back with the
// keyboard up, is set down before Fabric can draw it anew elsewhere still
// lifted. JavaScript hears the same overlap, so the content under the bar
// leaves room for it, but only where the keyboard holds still.
//
// The bar is lifted over the typing field's input accessory too, such as the
// Done bar SwiftUI stands over a number pad (`ToolbarItem(placement:
// .keyboard)`), which iOS 26 stands over the keyboard but outside the
// layout guide, so the composer stood under the Done bar, its Send half
// covered.
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

/// How long the keyboard holds still before JavaScript is told the overlap a layout pass read, so a drag that pulls it down tells once, where it ends, rather than on every step.
private let settlePause: TimeInterval = 0.12

/// When a reading of the overlap is told to JavaScript: at once, as the keyboard is announced to move or has settled, or once it holds still, as a layout pass in a drag reads it.
private enum Telling {
  case now
  case settled
}

/// How deep under the dock's content its scroll view is looked for, so a screen still reading, with no list yet, costs a layout pass little.
private let scrollViewDepth = 8

final class KeyboardDockView: ExpoView {
  let onOverlap = EventDispatcher()

  /// The overlap last told to JavaScript; none yet.
  private var told: CGFloat?

  /// A hidden view of the dock's own, never Fabric's, pinned to the keyboard layout guide's top, so the guide's every move lays the dock out.
  private let probe = UIView()

  /// The overlap waiting to be told to JavaScript once the keyboard holds still, so a drag that pulls it down tells only where it ends.
  private var pendingTell: DispatchWorkItem?

  /// The view the dock last lifted, so a view that stops being the bar, as a page goes Back with the keyboard up, is set down before Fabric draws it anew elsewhere.
  private weak var lifted: UIView?

  /// The bar's standing as the content's bottom edge element, which draws the scroll edge under it.
  private let edge = UIScrollEdgeElementContainerInteraction()

  /// How many more times the content's scroll view is looked for while none is found, and whether a look is already on its way, so a layout pass on each frame doesn't spend them all at once.
  private var looksLeft = edgeLooks
  private var lookPending = false

  /// What last took the keyboard, read as the keyboard moves, whose input accessory the bar is lifted over too.
  private weak var typing: UIResponder?

  /// The bar, Fabric's last child here, the probe passed over; none until the content and the bar both stand.
  private var bar: UIView? {
    let mounted = subviews.filter { $0 !== probe }
    return mounted.count > 1 ? mounted.last : nil
  }

  /// The content under the bar, Fabric's children before it, the probe passed over.
  private var content: [UIView] {
    Array(subviews.filter { $0 !== probe }.dropLast())
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    keyboardLayoutGuide.followsUndockedKeyboard = false
    // Note that the guide's top then stands at this view's foot while the keyboard is down, rather than at the safe area's, so no keyboard reads as no overlap.
    keyboardLayoutGuide.usesBottomSafeArea = false
    probe.isHidden = true
    probe.isUserInteractionEnabled = false
    probe.translatesAutoresizingMaskIntoConstraints = false
    addSubview(probe)
    NSLayoutConstraint.activate([
      probe.leadingAnchor.constraint(equalTo: leadingAnchor),
      probe.widthAnchor.constraint(equalToConstant: 0),
      probe.heightAnchor.constraint(equalToConstant: 0),
      probe.topAnchor.constraint(equalTo: keyboardLayoutGuide.topAnchor),
    ])
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(keyboardWillMove), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardDidMove), name: UIResponder.keyboardDidChangeFrameNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardDidHide), name: UIResponder.keyboardDidHideNotification, object: nil)
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    pendingTell?.cancel()
  }

  /// Lays the view out inside the keyboard's announced move, so the bar's lift rides the keyboard's own curve rather than landing after it.
  @objc private func keyboardWillMove() {
    typing = FirstResponder.current()
    setNeedsLayout()
    layoutIfNeeded()
    follow(telling: .now)
  }

  /// Reads the overlap again once the keyboard has settled, since a form sheet lifts itself after the keyboard's announced move, which only moves this view's place, not its size.
  @objc private func keyboardDidMove() {
    typing = FirstResponder.current()
    follow(telling: .now)
  }

  @objc private func keyboardDidHide() {
    follow(telling: .now)
  }

  /// Follows the keyboard again as the dock comes back into a window with the keyboard already standing, as a page does when the one over it goes back; sets the bar down as it leaves.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window == nil else {
      looksLeft = edgeLooks
      follow(telling: .now)
      return
    }
    pendingTell?.cancel()
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

  /// Follows the keyboard at each layout pass, which the probe asks for at each step of the keyboard, a drag's included; JavaScript hears the overlap once it holds still.
  override func layoutSubviews() {
    super.layoutSubviews()
    follow(telling: .settled)
  }

  /// Stands the bar as the bottom edge element of the first scroll view the content holds, as soon as both are mounted, and again once the content's scroll view is another, such as a list drawn in place of its skeleton.
  private func standAsEdge() {
    if edgeStands() { return }
    letEdgeGo()
    // Note that a layout pass walks the content even once the timed looks are spent, so a list that mounts late, with the dock laid out after it, is still found; the walk is shallow, and a pass in a drag never makes it, since the edge already stands.
    findEdge()
  }

  /// Walks the content for its first scroll view and stands the bar as its edge, or looks again a moment later where there is none yet.
  private func findEdge() {
    guard let bar else { return }

    guard let scroller = content.lazy.compactMap({ firstScrollView(in: $0) }).first else {
      lookAgainSoon()
      return
    }

    letEdgeGo()
    edge.edge = .bottom
    edge.scrollView = scroller
    scroller.bottomEdgeEffect.style = .soft
    // Note that its top edge fades softly under the navigation bar too, as Messages fades a conversation, since the stack's own scroll edge option reaches only the first scroll view down its first children, which a docked screen's content need not be.
    scroller.topEdgeEffect.style = .soft
    bar.addInteraction(edge)
    looksLeft = edgeLooks
  }

  /// Whether the bar stands as the edge of a scroll view the content still holds.
  private func edgeStands() -> Bool {
    guard let bar, let held = edge.scrollView, held.window != nil else {
      return false
    }

    return edge.view === bar && content.contains(where: { held.isDescendant(of: $0) })
  }

  /// Lets go of a scroll view the content no longer holds, setting its edges back to the system's, since Fabric may recycle it into a screen with no dock, and looks for its successor afresh.
  private func letEdgeGo() {
    guard let held = edge.scrollView else { return }
    held.bottomEdgeEffect.style = .automatic
    held.topEdgeEffect.style = .automatic
    edge.view?.removeInteraction(edge)
    edge.scrollView = nil
    looksLeft = edgeLooks
  }

  /// Looks for the content's scroll view again a moment later, a bounded number of times, since a list mounted deep in the content after its skeleton asks the dock for no layout pass of its own.
  private func lookAgainSoon() {
    guard looksLeft > 0, !lookPending, window != nil else { return }
    looksLeft -= 1
    lookPending = true
    DispatchQueue.main.asyncAfter(deadline: .now() + edgeLookPause) { [weak self] in
      guard let self else { return }
      self.lookPending = false
      // Note that a dock that left its window meanwhile looks again as it comes back, with its looks restored.
      if self.window != nil, !self.edgeStands() { self.findEdge() }
    }
  }

  /// Lifts the bar by how far the keyboard stands over this view's foot, less the bottom safe area the bar already stands clear of, and tells JavaScript the overlap: at once where the keyboard is announced to move or has settled, and once it holds still where a layout pass in a drag read it.
  private func follow(telling: Telling) {
    guard window != nil else { return }
    let overlap = max(0, bounds.maxY - keyboardTop())
    let lift = max(0, overlap - safeAreaInsets.bottom)

    if let bar {
      if bar !== lifted { setDown() }
      bar.transform = lift > 0 ? CGAffineTransform(translationX: 0, y: -lift) : .identity
      lifted = bar
    }

    standAsEdge()
    pendingTell?.cancel()

    switch telling {
    case .now:
      tell(overlap)
    case .settled:
      // Note that the overlap is read again as the wait ends, so what is told is where the keyboard came to rest.
      let later = DispatchWorkItem { [weak self] in
        guard let self, self.window != nil else { return }
        self.tell(max(0, self.bounds.maxY - self.keyboardTop()))
      }
      pendingTell = later
      DispatchQueue.main.asyncAfter(deadline: .now() + settlePause, execute: later)
    }
  }

  /// Tells JavaScript how far the keyboard stands over the dock, where that moved enough to matter.
  private func tell(_ overlap: CGFloat) {
    // Note that a step to or from no overlap is always told, however small, so the content never keeps room for a keyboard that has gone.
    if let was = told, abs(was - overlap) < overlapStep, (was == 0) == (overlap == 0) { return }
    told = overlap
    onOverlap(["overlap": overlap])
  }
}

extension KeyboardDockView {
  /// Where the keyboard's top stands in this view: the layout guide's, or the typing field's input accessory's where one stands docked on it. Note that an accessory standing clear of the guide's top, over a keyboard floating on an iPad, is passed over, as the guide passes the keyboard over.
  fileprivate func keyboardTop() -> CGFloat {
    let guideTop = keyboardLayoutGuide.layoutFrame.minY
    guard let accessory = typing?.inputAccessoryView, accessory.window != nil, !accessory.isHidden else {
      return guideTop
    }

    let placed = accessory.convert(accessory.bounds, to: self)
    return placed.maxY >= guideTop - overlapStep ? min(guideTop, placed.minY) : guideTop
  }
}

/// The app's first responder, found by the one action every responder answers, which UIKit sends to the first responder alone.
private final class FirstResponder: NSObject {
  static weak var found: UIResponder?

  static func current() -> UIResponder? {
    found = nil
    UIApplication.shared.sendAction(#selector(UIResponder.vespinDockClaimFirstResponder), to: nil, from: nil, for: nil)
    return found
  }
}

extension UIResponder {
  @objc fileprivate func vespinDockClaimFirstResponder() {
    FirstResponder.found = self
  }
}

/// The first scroll view at or under a view, the shallowest first, so a list's own scroller is found before any it holds in its rows. Note that a text view is a scroll view too, and is passed over, since a field in the content is never the content's scroller.
private func firstScrollView(in root: UIView) -> UIScrollView? {
  var level: [UIView] = [root]
  for _ in 0..<scrollViewDepth where !level.isEmpty {
    if let found = level.lazy.compactMap({ $0 as? UIScrollView }).first(where: { !($0 is UITextView) }) { return found }
    level = level.flatMap(\.subviews)
  }
  return nil
}
