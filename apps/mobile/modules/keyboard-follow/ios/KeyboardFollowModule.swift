// KeyboardFollowModule.swift -- a composer's dock lifted with the keyboard on every frame, as Messages' field rides it, its interactive dismissal included: the view `GlassDock` stands its bar in (`packages/ui-native/src/glass-bar.tsx`).
//
// iOS posts no keyboard notification while a scroll view's interactive
// dismissal drags the keyboard down, only once the finger lifts, so a dock
// JavaScript lifts by the keyboard's height stays where the keyboard was
// while the keyboard follows the finger away under it. The keyboard's layout
// guide tracks the keyboard on every frame of that drag, and of its own show
// and hide, so a probe pinned to the guide lays this view out each time the
// keyboard moves, and the layout lifts the dock's content by as far as the
// keyboard stands over its foot. Note that a layout the keyboard's own
// animation runs is set inside that animation, so the lift rides its
// duration and curve, as a view constrained to the guide does.

import ExpoModulesCore
import UIKit

public final class KeyboardFollowModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KeyboardFollow")

    View(KeyboardFollowView.self) {
      // The room the dock's bar keeps at its foot for the screen's bottom safe area, in points, which the keyboard covers once it rises.
      Prop("inset") { (view: KeyboardFollowView, inset: Double) in
        view.inset = CGFloat(inset)
      }
    }
  }
}

/// The dock's foot: its React Native children stand in `content`, lifted whole above the keyboard, while the view itself stays where its layout puts it, so its foot is read untransformed.
public final class KeyboardFollowView: ExpoView {
  /// The bottom safe area the dock's bar pads at its foot, which the lift gives up under the keyboard, since the keyboard covers it.
  var inset: CGFloat = 0 {
    didSet { setNeedsLayout() }
  }

  /// What the dock's children are mounted in, the one view the lift moves.
  private let content = UIView()

  /// An empty view pinned to the keyboard's top, whose every move lays this view out.
  private let probe = UIView()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addSubview(content)

    probe.isUserInteractionEnabled = false
    probe.translatesAutoresizingMaskIntoConstraints = false
    addSubview(probe)

    // Note that the guide stands at the window's foot while the keyboard is down, rather than at its safe area, so no lift is read from the home indicator's room.
    keyboardLayoutGuide.usesBottomSafeArea = false
    NSLayoutConstraint.activate([
      probe.topAnchor.constraint(equalTo: keyboardLayoutGuide.topAnchor),
      probe.leadingAnchor.constraint(equalTo: leadingAnchor),
      probe.widthAnchor.constraint(equalToConstant: 0),
      probe.heightAnchor.constraint(equalToConstant: 0),
    ])
  }

  public override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    content.insertSubview(childComponentView, at: index)
  }

  public override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    childComponentView.removeFromSuperview()
  }

  /// Lifts the content by as far as the keyboard stands over the dock's foot, less the safe area the bar already pads there.
  public override func layoutSubviews() {
    super.layoutSubviews()
    // Note that the content is placed by its center and bounds, since a frame set on a transformed view is undefined.
    content.bounds = CGRect(origin: .zero, size: bounds.size)
    content.center = CGPoint(x: bounds.midX, y: bounds.midY)

    let keyboardTop = keyboardLayoutGuide.layoutFrame.minY
    let lift = max(0, bounds.maxY - inset - keyboardTop)
    let shift = CGAffineTransform(translationX: 0, y: -lift)
    if content.transform != shift { content.transform = shift }
  }

  /// Finds a press on the content where the lift has moved it, past this view's own bounds, which React Native's hit test would otherwise refuse; a point on the content that no child takes stays this view's, as the dock's own view took it before.
  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard isUserInteractionEnabled, !isHidden, alpha > 0.01 else { return nil }
    let hit = content.hitTest(convert(point, to: content), with: event)
    return hit === content ? self : hit
  }
}
