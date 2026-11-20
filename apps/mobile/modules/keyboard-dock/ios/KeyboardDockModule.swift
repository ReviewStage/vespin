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
// before Fabric can draw it anew elsewhere still lifted. The bar is the last
// child React mounted, never a view UIKit adds of its own, such as one a
// selection in the field stands beside it. Note that the display
// link holds this view while it runs, so it stops as the view leaves its
// window, which it does before it goes. JavaScript
// hears the same overlap, so the content under the bar leaves room for it.
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
// The bar's foot pads by the bottom safe area this view tells with the
// overlap, the same number the lift is less by, rather than by a safe area
// React Native reads for itself: on a page presented full screen, such as
// New task, the two differed by the home indicator's height, so the bar
// stood that much short of the keyboard and its row of capsules under it.
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

/// Whether the system's keyboard stands, as its own notices last said, kept for every dock and read and written only on the main thread, where UIKit posts them, since a dock that comes into its window after the keyboard rose, as a start page whose field takes the keyboard as it opens, heard none of them while it stood out of a window.
nonisolated(unsafe) private var keyboardStands = false

final class KeyboardDockView: ExpoView {
  let onOverlap = EventDispatcher()

  /// The overlap last told to JavaScript; none yet.
  private var told: CGFloat?

  /// The bottom safe area last told to JavaScript, which the bar pads its foot by while the dock lifts it, so the lift and the padding are one number; none yet.
  private var toldInset: CGFloat?

  /// Whether the dock is following a frame drawn, when it moves the bar without telling JavaScript.
  private var framing = false

  /// The view the dock last lifted, so a view that stops being the bar, as a page goes Back with the keyboard up, is set down before Fabric draws it anew elsewhere.
  private weak var lifted: UIView?

  /// The bar's standing as the content's bottom edge element, which draws the scroll edge under it.
  private let edge = UIScrollEdgeElementContainerInteraction()

  /// How many more times the content's scroll view is looked for while none is found, and whether a look is already on its way, so a layout pass on each frame doesn't spend them all at once.
  private var looksLeft = edgeLooks
  private var lookPending = false

  /// Follows the keyboard each frame while it stands, since a drag that pulls it down moves the layout guide without asking this view for a layout pass.
  private var frames: CADisplayLink?

  /// What last took the keyboard, read as the keyboard moves, whose input accessory the bar is lifted over too.
  private weak var typing: UIResponder?

  /// The children React mounted, in its order: the content, then the bar. Note that the bar is read from here rather than from the view's subviews, since a view UIKit adds of its own, as a selection in the composer's field stands one, became the last subview, which the dock lifted in the bar's place, setting the composer down behind the keyboard.
  private var mounted: [UIView] = []

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
    typing = FirstResponder.current()
    setNeedsLayout()
    layoutIfNeeded()
  }

  /// Reads the overlap again once the keyboard has settled, since a form sheet lifts itself after the keyboard's announced move, which only moves this view's place, not its size.
  @objc private func keyboardDidMove() {
    typing = FirstResponder.current()
    follow()
  }

  /// Follows the keyboard frame by frame while it stands.
  @objc private func keyboardDidShow() {
    keyboardStands = true
    typing = FirstResponder.current()
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
    keyboardStands = false
    frames?.invalidate()
    frames = nil
    follow()
  }

  /// Reads the keyboard on each frame drawn, moving the bar alone. Note that the view is laid out first, so the guide's frame is the keyboard's of this frame rather than the last layout pass's, and that JavaScript is not told each frame's overlap, since every frame of a drag drew the whole transcript anew; it hears the overlap where the keyboard settles.
  @objc private func frameDrawn() {
    framing = true
    layoutIfNeeded()
    follow()
    framing = false
  }

  /// Follows the keyboard as the dock comes into a window with the keyboard already standing, as a page does when the one over it goes back, or a start page whose field took the keyboard as it opened; stops following as it leaves.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window == nil else {
      looksLeft = edgeLooks
      // Note that the keyboard is followed frame by frame wherever it stands as the dock comes in, whether the dock lifted for it before or never heard it rise, so the suggestion strip growing over a start page's field lifts the bar with it.
      if keyboardStands { typing = FirstResponder.current() }
      follow()
      if keyboardStands || (told ?? 0) > 0 { followFrames() }
      return
    }
    frames?.invalidate()
    frames = nil
    setDown()
  }

  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    super.mountChildComponentView(childComponentView, index: index)
    mounted.insert(childComponentView, at: min(max(index, 0), mounted.count))
    setNeedsLayout()
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    mounted.removeAll { $0 === childComponentView }
    super.unmountChildComponentView(childComponentView, index: index)
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

  /// Tells JavaScript the bottom safe area again where it moves, as a page presented full screen settles into its window.
  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    follow()
  }

  /// Stands the bar as the bottom edge element of the first scroll view the content holds, as soon as both are mounted, and again once the content's scroll view is another, such as a list drawn in place of its skeleton.
  private func standAsEdge() {
    if edgeStands() { return }
    letEdgeGo()
    // Note that a layout pass walks the content even once the timed looks are spent, so a list that mounts late, with the dock laid out after it, is still found; the walk is shallow and a frame drawn never makes it.
    findEdge()
  }

  /// Walks the content for its first scroll view and stands the bar as its edge, or looks again a moment later where there is none yet.
  private func findEdge() {
    guard let bar = mounted.last, mounted.count > 1 else { return }

    guard let scroller = mounted.dropLast().lazy.compactMap({ firstScrollView(in: $0) }).first else {
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
    guard let bar = mounted.last, mounted.count > 1, let held = edge.scrollView, held.window != nil else {
      return false
    }

    return edge.view === bar && mounted.dropLast().contains(where: { held.isDescendant(of: $0) })
  }

  /// On a frame drawn, lets a scroll view the content no longer holds go and looks for its successor a moment later, without walking the content on the frame.
  private func keepEdge() {
    guard !edgeStands() else { return }
    letEdgeGo()
    lookAgainSoon()
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

  /// Lifts the bar by how far the keyboard stands over this view's foot, less the bottom safe area the bar already stands clear of, and tells JavaScript the overlap where the keyboard has settled or is announced to move, never on a frame drawn.
  private func follow() {
    guard window != nil else { return }
    let overlap = max(0, bounds.maxY - keyboardTop())
    let lift = max(0, overlap - safeAreaInsets.bottom)

    if let bar = mounted.last, mounted.count > 1 {
      if bar !== lifted { setDown() }
      bar.transform = lift > 0 ? CGAffineTransform(translationX: 0, y: -lift) : .identity
      lifted = bar
    }

    // Note that a frame drawn only checks the content's scroll view still stands, which costs nothing, while a layout pass looks for it again where it does not.
    if framing { keepEdge() } else { standAsEdge() }

    guard !framing else { return }

    // Note that a step to or from no overlap is always told, however small, so the content never keeps room for a keyboard that has gone, and so is a new bottom safe area, which the bar pads its foot by.
    let inset = safeAreaInsets.bottom
    let insetMoved = toldInset.map { abs($0 - inset) >= overlapStep } ?? true

    if !insetMoved, let was = told, abs(was - overlap) < overlapStep, (was == 0) == (overlap == 0) { return }
    told = overlap
    toldInset = inset
    onOverlap(["overlap": overlap, "inset": inset])
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
