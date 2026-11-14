// QuickLookModule.swift -- a picture or a file a message carried, opened full screen in the system's Quick Look, as Messages, Mail and Files open one.
//
// Quick Look reads a file on disk, so the app writes a picture's bytes, or a
// file's, under its caches first (`cached-media.ts`) and hands its address
// here. Quick Look brings what the app's own viewers lacked: a swipe down to
// close, a double tap and a pinch to zoom, every kind of file the system
// reads (a PDF, a text file, an image, a spreadsheet), Markup, and its own
// share button, whose sheet holds Copy and Save Image. Note that a press on a
// thumbnail hands its frame in the window, so the preview grows from the
// thumbnail and shrinks back into it as the system's own do on the iPhone; a
// frame of none, and every iPad, open it with the system's plain transition.
// A file Quick Look can't read answers false, and the app shares it instead.

import ExpoModulesCore
import QuickLook
import UIKit

/// One file Quick Look shows, named in its bar.
private final class PreviewItem: NSObject, QLPreviewItem {
  let previewItemURL: URL?
  let previewItemTitle: String?

  init(url: URL, title: String?) {
    previewItemURL = url
    previewItemTitle = title
  }
}

/// What Quick Look reads while it stands: its one item, the thumbnail it grows from, and what to do once it closes.
private final class Preview: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
  let item: PreviewItem
  let from: CGRect?
  weak var window: UIWindow?
  let onDismiss: (Preview) -> Void

  init(item: PreviewItem, from: CGRect?, window: UIWindow?, onDismiss: @escaping (Preview) -> Void) {
    self.item = item
    self.from = from
    self.window = window
    self.onDismiss = onDismiss
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    item
  }

  func previewController(
    _ controller: QLPreviewController,
    frameFor item: QLPreviewItem,
    inSourceView view: AutoreleasingUnsafeMutablePointer<UIView?>
  ) -> CGRect {
    guard let from, let window else { return .zero }
    view.pointee = window
    return from
  }

  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    onDismiss(self)
  }
}

/// The foreground scene's key window, which the preview stands over.
private func keyWindow() -> UIWindow? {
  let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
  let front = scenes.filter { $0.activationState == .foregroundActive }
  return front.flatMap(\.windows).first(where: \.isKeyWindow)
    ?? scenes.flatMap(\.windows).first(where: \.isKeyWindow)
}

/// The controller on top of the window, which presents the preview.
private func topmost(_ window: UIWindow) -> UIViewController? {
  var top = window.rootViewController
  while let shown = top?.presentedViewController, !shown.isBeingDismissed { top = shown }
  return top
}

public final class QuickLookModule: Module {
  /// Every preview standing now, each held until its own controller closes, since Quick Look holds its data source weakly.
  /// Note that a second preview can open over the first, when two downloads land while one stands, so one slot isn't enough.
  private var shown: [Preview] = []

  public func definition() -> ModuleDefinition {
    Name("QuickLook")

    AsyncFunction("preview") { (uri: String, title: String?, from: [Double]?) -> Bool in
      guard let url = URL(string: uri), url.isFileURL else { return false }
      let item = PreviewItem(url: url, title: title)
      guard QLPreviewController.canPreview(item), let window = keyWindow(),
        let presenter = topmost(window)
      else { return false }

      // Note that an iPad opened the preview grown from its thumbnail in Quick Look's immersive mode, its bar and Done hidden with no tap bringing them back, so there it opens from no frame, inside a navigation controller of its own whose bar always holds Done.
      let pad = UIDevice.current.userInterfaceIdiom == .pad
      let frame = pad ? nil : from.flatMap { rect in
        rect.count == 4 ? CGRect(x: rect[0], y: rect[1], width: rect[2], height: rect[3]) : nil
      }
      let preview = Preview(item: item, from: frame, window: window) { [weak self] closed in
        self?.shown.removeAll { $0 === closed }
      }
      let controller = QLPreviewController()
      controller.dataSource = preview
      controller.delegate = preview
      shown.append(preview)

      guard pad else {
        presenter.present(controller, animated: true)
        return true
      }

      let navigation = UINavigationController(rootViewController: controller)
      navigation.modalPresentationStyle = .fullScreen
      presenter.present(navigation, animated: true) {
        // Quick Look sets its own Done where it finds itself presented; one it left out is added, closing the whole preview.
        guard controller.navigationItem.leftBarButtonItem == nil else { return }
        controller.navigationItem.leftBarButtonItem = UIBarButtonItem(
          systemItem: .done,
          primaryAction: UIAction { [weak navigation, weak preview] _ in
            navigation?.dismiss(animated: true)
            if let preview { preview.onDismiss(preview) }
          }
        )
      }
      return true
    }.runOnQueue(.main)
  }
}
