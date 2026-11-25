// ContextMenuView.swift -- a view of React Native views that a long press opens UIKit's own context menu on, built from the same tree a row's menu is (`treeUIMenu`), lifting the tree's preview where it has one (`treePreviewController`), so a mention's chip held in a message opens its own menu and never the message's too.
//
// Note that it is UIKit's `UIContextMenuInteraction` on the chip's own view
// rather than SwiftUI's `contextMenu` or `@expo/ui`'s `ContextMenu`, because
// those wrap a SwiftUI view, and a chip stands laid inline in a React
// Native `<Text>` line, which no SwiftUI view can wrap. UIKit gives a hold
// to the innermost interaction under the finger, as a link held in a
// Messages bubble opens its own menu rather than the bubble's, so the
// message's menu (`RowMenuModifier`, the same interaction on the view SwiftUI
// hosts it in) never opens with the chip's; no timing between JavaScript and
// SwiftUI decides it. A press sends the place of the item pressed, as a row's
// menu sends it, and its handler stays in JavaScript (`ContextMenu` in
// `@repo/ui-native`).

import ExpoModulesCore
import UIKit

final class ContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onPressPlace = EventDispatcher()
  let onPressPreview = EventDispatcher()

  /// The menu's tree as JSON, read only as a long press opens it.
  var menu = ""

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    let json = menu
    let built = treeUIMenu(json) { [weak self] place in self?.onPressPlace(["path": place]) }
    guard let built else { return nil }
    return UIContextMenuConfiguration(identifier: nil, previewProvider: { treePreviewController(json) }) { _ in built }
  }

  /// A press on the lifted preview: the menu closes, then what the preview shows opens, as Safari opens a held link's page from its preview. Note that it asks only once the menu is gone, so the page it opens is never pushed under the menu's own dismissal.
  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willPerformPreviewActionForMenuWith configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionCommitAnimating
  ) {
    animator.preferredCommitStyle = .dismiss
    animator.addCompletion { [weak self] in self?.onPressPreview([:]) }
  }
}
