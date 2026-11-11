// ShareViewController.swift -- the share extension's principal class: the system's share sheet hands it what was shared, and it stands the app's sheet over it.
//
// The extension runs apart from the app, with no React Native and no host,
// so its sheet is plain SwiftUI drawn from what the app left in the App
// Group (`AppGroupFiles.swift`). `app.config.ts` adds this target to the
// project Expo generates, offered for text and a web link.

import SwiftUI
import UIKit

final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    let sheet = ShareSheet(
      model: ShareSheetModel(snapshot: AppGroupFiles.snapshot()),
      items: items,
      finish: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) },
      cancel: { [weak self] in self?.extensionContext?.cancelRequest(withError: CancellationError()) })
    let hosting = UIHostingController(rootView: sheet)
    addChild(hosting)
    hosting.view.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(hosting.view)
    NSLayoutConstraint.activate([
      hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
      hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
    hosting.didMove(toParent: self)
  }
}
