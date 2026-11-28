// KeyboardDockModule.swift -- a screen that lifts the bar at its foot with the system's keyboard, followed by a view UIKit pins to the keyboard layout guide of the view controller that stands in the window, stands it as its content's bottom scroll edge, and tells JavaScript how far the keyboard stands over it.
//
// `@repo/ui-native`'s `GlassDock` stands its content and its bar inside this
// view (`keyboard-dock.ts`), the bar as its last child. React Native hears the
// keyboard only as it is announced to rise or fall, so a bar it lifts stands
// still while a drag pulls the keyboard down under the finger, then jumps.
// UIKit's keyboard layout guide follows the keyboard through that drag, the
// suggestion strip's growth and a form sheet's own lift, so a view of no
// height stands in the window with its foot pinned to such a guide, and
// UIKit moves it with the keyboard on every frame the keyboard moves, inside
// the keyboard's own animation; the dock hears it move and sets the bar's lift
// as a transform, which React Native's layout leaves alone. Note that the bar
// moves by a transform rather than a constraint on the guide, because it is
// React's view, whose frame Yoga sets on each commit, so a constraint would
// fight Fabric; the accessibility tree is told the layout changed wherever
// the lift settles, so VoiceOver and XCTest read the bar where it stands.
// Nothing polls and nothing counts frames: the bar moves only as UIKit moves
// the keyboard. A view that stops being the bar, as a page goes back with the keyboard up, is
// set down before Fabric can draw it anew elsewhere still lifted. The bar is
// the last child React mounted, never a view UIKit adds of its own, such as
// one a selection in the field stands beside it. JavaScript hears the same
// overlap where the keyboard settles, so the content under the bar leaves
// room for it.
//
// The guide followed is the root view controller's view's, never this view's.
// UIKit moves a view's keyboard layout guide only as the keyboard's notices
// post, and only for a view standing in a window then, so a dock out of its
// window as the keyboard fell kept the risen keyboard in its own guide: a
// Manager's chat come back to from a thread whose keyboard stood held its
// composer a keyboard's height up the screen, over its newest messages, until
// the keyboard next moved. The root view stands in the window while the app
// runs, so its guide stands where the keyboard does; where it leaves, under a
// page presented full screen, the tracker moves to the topmost presented
// view's guide, as react-native-keyboard-controller's tracker does on iOS 26.
// Note that the window's own guide is never followed: UIKit never moved it,
// its top standing at the window's top, so the bar stood lifted to the top of
// the screen with no keyboard up.
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

final class KeyboardDockView: ExpoView {
  let onOverlap = EventDispatcher()

  /// The overlap last told to JavaScript; none yet.
  private var told: CGFloat?

  /// The bottom safe area last told to JavaScript, which the bar pads its foot by while the dock lifts it, so the lift and the padding are one number; none yet.
  private var toldInset: CGFloat?

  /// The lift VoiceOver and the accessibility tree were last told of; none yet.
  private var announcedLift: CGFloat?

  /// Whether the dock is following the keyboard's tracker as it moves, when it moves the bar without telling JavaScript.
  private var tracking = false

  /// The view the dock last lifted, so a view that stops being the bar, as a page goes Back with the keyboard up, is set down before Fabric draws it anew elsewhere.
  private weak var lifted: UIView?

  /// The bar's standing as the content's bottom edge element, which draws the scroll edge under it.
  private let edge = UIScrollEdgeElementContainerInteraction()

  /// How many more times the content's scroll view is looked for while none is found, and whether a look is already on its way, so a layout pass on each frame doesn't spend them all at once.
  private var looksLeft = edgeLooks
  private var lookPending = false

  /// A view of no height standing in the dock's window with its foot pinned to a keyboard layout guide UIKit keeps moving, so UIKit moves it with the keyboard on every frame the keyboard moves, a drag that pulls it down under the finger included, and the bar follows it; none while the dock stands in no window.
  private var tracker: KeyboardTracker?

  /// Hears the tracker move, which UIKit's layout pass does as the guide moves.
  private var trackerMoves: NSKeyValueObservation?

  /// What last took the keyboard, read as the keyboard moves, whose input accessory the bar is lifted over too.
  private weak var typing: UIResponder?

  /// The children React mounted, in its order: the content, then the bar. Note that the bar is read from here rather than from the view's subviews, since a view UIKit adds of its own, as a selection in the composer's field stands one, became the last subview, which the dock lifted in the bar's place, setting the composer down behind the keyboard.
  private var mounted: [UIView] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(keyboardWillMove), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardDidMove), name: UIResponder.keyboardDidChangeFrameNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardDidHide), name: UIResponder.keyboardDidHideNotification, object: nil)
  }

  // Note that the tracker needs no letting go here, since a view stands in a window only while a superview holds it, so it has always left its window, and let the tracker go there, before it goes.
  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  /// Notes what took the keyboard as its move is announced, whose input accessory the bar stands over, and lays the window out inside the keyboard's own animation, so the tracker stands where the keyboard ends, the bar's lift rides its curve, and JavaScript hears where it ends as it starts.
  @objc private func keyboardWillMove() {
    typing = FirstResponder.current()
    window?.layoutIfNeeded()
    follow()
  }

  /// Reads the overlap again once the keyboard has settled, since a form sheet lifts itself after the keyboard's announced move, which only moves this view's place, not its size.
  @objc private func keyboardDidMove() {
    typing = FirstResponder.current()
    follow()
  }

  @objc private func keyboardDidHide() {
    follow()
  }

  /// Moves the bar with the tracker, never telling JavaScript, since every frame of a drag drew the whole transcript anew; it hears the overlap where the keyboard settles, from the keyboard's notices.
  private func trackerMoved() {
    tracking = true
    follow()
    tracking = false
  }

  /// Stands the tracker in the window, its foot on the keyboard layout guide of the view controller standing there, and follows where it stands now, as a page come back to over a keyboard that announced its fall before the dock could hear it.
  private func standTracker(in window: UIWindow) {
    letTrackerGo()
    let view = KeyboardTracker(frame: .zero)
    view.attach(in: window)
    tracker = view
    window.layoutIfNeeded()
    trackerMoves = view.observe(\.center, options: [.new]) { [weak self] _, _ in
      MainActor.assumeIsolated { self?.trackerMoved() }
    }
  }

  /// Lets the tracker go as the dock leaves its window.
  private func letTrackerGo() {
    trackerMoves?.invalidate()
    trackerMoves = nil
    tracker?.letGo()
    tracker = nil
  }

  /// Follows the keyboard as the dock comes into a window, from where the keyboard stands then, as a page does when the one over it goes back, or a start page whose field took the keyboard as it opened; lets it go as the dock leaves.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard let window else {
      letTrackerGo()
      setDown()
      return
    }
    looksLeft = edgeLooks
    typing = FirstResponder.current()
    standTracker(in: window)
    follow()
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
    // Note that a layout pass walks the content even once the timed looks are spent, so a list that mounts late, with the dock laid out after it, is still found; the walk is shallow and a move of the tracker never makes it.
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

  /// On a move of the tracker, lets a scroll view the content no longer holds go and looks for its successor a moment later, without walking the content on the move.
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

  /// Lifts the bar by how far the keyboard stands over this view's foot, less the bottom safe area the bar already stands clear of, and tells JavaScript the overlap where the keyboard has settled or is announced to move, never on a move of the tracker; answers the overlap read.
  @discardableResult
  private func follow() -> CGFloat {
    guard window != nil else { return 0 }
    let overlap = max(0, bounds.maxY - keyboardTop())
    let lift = max(0, overlap - safeAreaInsets.bottom)

    if let bar = mounted.last, mounted.count > 1 {
      if bar !== lifted { setDown() }
      bar.transform = lift > 0 ? CGAffineTransform(translationX: 0, y: -lift) : .identity
      lifted = bar
    }

    // Note that a move of the tracker only checks the content's scroll view still stands, which costs nothing, while a layout pass looks for it again where it does not.
    if tracking { keepEdge() } else { standAsEdge() }

    guard !tracking else { return overlap }

    // Note that the accessibility tree is told the layout changed wherever the lift settles, since a transform moves the bar without a layout pass, and VoiceOver and XCTest kept reading it where it stood before, at its foot under the keyboard, so a tap on Send in landscape landed on the keyboard.
    if abs((announcedLift ?? 0) - lift) >= overlapStep {
      announcedLift = lift
      UIAccessibility.post(notification: .layoutChanged, argument: nil)
    }

    // Note that a step to or from no overlap is always told, however small, so the content never keeps room for a keyboard that has gone, and so is a new bottom safe area, which the bar pads its foot by.
    let inset = safeAreaInsets.bottom
    let insetMoved = toldInset.map { abs($0 - inset) >= overlapStep } ?? true

    if !insetMoved, let was = told, abs(was - overlap) < overlapStep, (was == 0) == (overlap == 0) { return overlap }
    told = overlap
    toldInset = inset
    onOverlap(["overlap": overlap, "inset": inset])
    return overlap
  }
}

extension KeyboardDockView {
  /// Where the keyboard's top stands in this view: the tracker's, on its layout guide, or the typing field's input accessory's where one stands docked on it; this view's foot where it or the tracker stands in no window. Note that an accessory standing clear of the guide's top, over a keyboard floating on an iPad, is passed over, as the guide passes the keyboard over.
  fileprivate func keyboardTop() -> CGFloat {
    guard let window, let tracker, tracker.window === window else { return bounds.maxY }
    let guideTop = convert(tracker.bounds, from: tracker).maxY
    guard let accessory = typing?.inputAccessoryView, accessory.window != nil, !accessory.isHidden else {
      return guideTop
    }

    let placed = accessory.convert(accessory.bounds, to: self)
    return placed.maxY >= guideTop - overlapStep ? min(guideTop, placed.minY) : guideTop
  }
}

/// A view of no height, hidden and untouchable, whose foot is pinned to the keyboard layout guide of the root view controller's view, which stands in the window while the app runs, or, where a page presented full screen took the root's place, of the topmost presented view; it moves to the next as the one holding it leaves the window, until the dock lets it go.
private final class KeyboardTracker: UIView {
  /// Whether the dock still holds the tracker, which it lets go as it leaves its window; and whether it is moving to a view of its own accord, which is not a leave.
  private var held = true
  private var attaching = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    isHidden = true
    isUserInteractionEnabled = false
    translatesAutoresizingMaskIntoConstraints = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  /// Stands the tracker on the guide of the view controller standing in the window, passing over the view it is leaving with.
  func attach(in window: UIWindow, passingOver leaving: UIView? = nil) {
    guard held, let host = trackerHost(in: window, passingOver: leaving), host !== superview else { return }
    attaching = true
    defer { attaching = false }
    host.addSubview(self)
    let guide = host.keyboardLayoutGuide
    // Note that the guide follows a keyboard docked at the window's foot alone, a floating or undocked iPad keyboard standing over nothing, and its top stands at the view's foot while the keyboard is down, rather than at the safe area's, so no keyboard reads as no overlap.
    guide.followsUndockedKeyboard = false
    guide.usesBottomSafeArea = false
    NSLayoutConstraint.activate([
      leadingAnchor.constraint(equalTo: host.leadingAnchor),
      widthAnchor.constraint(equalToConstant: 0),
      heightAnchor.constraint(equalToConstant: 0),
      bottomAnchor.constraint(equalTo: guide.topAnchor),
    ])
  }

  /// Leaves the window for good.
  func letGo() {
    held = false
    removeFromSuperview()
  }

  /// Moves to the next view controller's view as the one holding it leaves the window, as the root's view does under a page presented full screen.
  override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    guard newWindow == nil, held, !attaching, let window else { return }
    attach(in: window, passingOver: superview)
  }
}

/// The view whose keyboard layout guide the tracker follows: the root view controller's while it stands in the window, else the topmost presented view controller's that does, never the one being left.
@MainActor
private func trackerHost(in window: UIWindow, passingOver leaving: UIView?) -> UIView? {
  guard let root = window.rootViewController else { return nil }
  let standing = sequence(first: root, next: { $0.presentedViewController })
    .compactMap(\.viewIfLoaded)
    .filter { $0.window === window && $0 !== leaving }
  guard let first = standing.first else { return nil }

  return first === root.viewIfLoaded ? first : standing.last
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
