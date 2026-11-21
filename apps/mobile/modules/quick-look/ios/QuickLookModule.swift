// QuickLookModule.swift -- a picture or a file a message carried, opened full screen in the system's Quick Look, as Messages, Mail and Files open one.
//
// Quick Look reads a file on disk, so the app writes a picture's bytes, or a
// file's, under its caches first (`cached-media.ts`) and hands its address
// here. Quick Look brings what the app's own viewers lacked: a swipe down to
// close, a double tap and a pinch to zoom, every kind of file the system
// reads (a PDF, a text file, an image, a spreadsheet), Markup, and its own
// share button, whose sheet holds Copy and Save Image. Note that it opens with
// the system's plain transition rather than growing from the thumbnail
// pressed, since grown from one Quick Look stood in its immersive mode, its
// bar and Done hidden until a tap, on the iOS 27.2 iPhone as on the iPad, and
// on the 27.2 runtimes a zoom it began on its own never stood at all. A
// file Quick Look can't read, or a screen UIKit would not present it over,
// answers false, and the app shares it instead.

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

/// What Quick Look reads while it stands: its one item, and what to do once it closes.
private final class Preview: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
  let item: PreviewItem
  let onDismiss: (Preview) -> Void

  init(item: PreviewItem, onDismiss: @escaping (Preview) -> Void) {
    self.item = item
    self.onDismiss = onDismiss
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    item
  }

  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    onDismiss(self)
  }

  /// No view to grow from, so Quick Look never zooms out of the thumbnail pressed.
  func previewController(_ controller: QLPreviewController, transitionViewFor item: QLPreviewItem) -> UIView? {
    nil
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

    AsyncFunction("preview") { (uri: String, title: String?) -> Bool in
      guard let url = URL(string: uri), url.isFileURL else { return false }
      let item = PreviewItem(url: url, title: title)

      guard QLPreviewController.canPreview(item) else {
        NSLog("Quick Look can't read the file it was asked to open.")
        return false
      }

      guard let window = keyWindow(), let presenter = topmost(window) else {
        NSLog("Quick Look found no window to stand over.")
        return false
      }

      // Note that a refusal is told before presenting, since UIKit refuses a presentation only in its log, such as over a controller whose view stands in no window or that is still dismissing another; and that it can't be told after, because Quick Look delays its own presentation until it has read its item, so the presenter presents nothing yet for a moment after every press that goes. Told after, each press read as refused, dropped the preview's data source, and asked for the share sheet, which UIKit refused only because Quick Look was still coming.
      guard presenter.viewIfLoaded?.window != nil, presenter.presentedViewController == nil else {
        NSLog(
          "Quick Look would not be presented over %@ (in a window: %@), which presents %@.",
          String(describing: type(of: presenter)),
          presenter.viewIfLoaded?.window == nil ? "no" : "yes",
          presenter.presentedViewController.map { String(describing: type(of: $0)) } ?? "nothing"
        )
        return false
      }

      let preview = Preview(item: item) { [weak self] closed in
        self?.shown.removeAll { $0 === closed }
      }
      let controller = QLPreviewController()
      controller.dataSource = preview
      controller.delegate = preview
      // Note that it's presented itself, full screen, rather than inside a navigation controller of the app's, since Quick Look draws its own Done only where it finds itself presented; pushed into another's stack it has none, and a Done added to its bar showed in some runs and not others on the iOS 26.5 iPad.
      controller.modalPresentationStyle = .fullScreen
      // Note that the plain transition is asked for by name, since on the iOS 27.2 runtimes Quick Look began a zoom out of the thumbnail pressed on its own, tracking the thumbnail's frame, and never stood: built and fed, but never on screen.
      controller.preferredTransition = .coverVertical
      shown.append(preview)
      presenter.present(controller, animated: true) {
        NSLog("Quick Look stands over %@.", String(describing: type(of: presenter)))
      }

      return true
    }.runOnQueue(.main)
  }
}
