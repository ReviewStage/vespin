// ShareExtensionModule.swift -- the share extension's page's door to its view controller: what was shared, the snapshot the app left, the access token read at send time, the draft kept for the app, the notification of a task started, the bar's words and search, and the sheet's end.
//
// The module is built into the share extension alone, never the app
// (`app.config.ts`'s Podfile). It holds nothing itself: each function asks
// the host the extension's view controller stands as (`ShareExtensionHost`),
// so the extension's own Swift, built in its target, does the work, and a
// module made before the controller stood answers nothing. The token is
// handed to the page only when it asks at send time, and none of this
// module's answers is ever logged.

import ExpoModulesCore
import Foundation

/// What the share extension's view controller does for its page.
@MainActor
public protocol ShareExtensionHost: AnyObject {
  /// What another app shared: `texts`, `links`, `title`, `pictures` (JPEG files' paths) and `leftOut`.
  func sharedItems() async -> [String: Any]
  /// The snapshot's text, as the app wrote it, or none.
  func snapshot() -> String?
  /// The account's access token, read from the Keychain item the app keeps, or none where it kept none or it has expired.
  func accessToken() -> String?
  /// A picture the extension wrote, by its file's address, as base64, or none where it is not one of its own.
  func picture(_ path: String) -> String?
  /// Keeps `json` as the draft and each of `pictures`, in order, as its picture files; whether all of it was kept.
  func keepDraft(_ json: String, pictures: [String]) -> Bool
  /// Posts the notification of a task started, where notifications are allowed; whether it was posted.
  func notify(id: String, title: String, body: String, payload: [String: Any]) async -> Bool
  /// The bar's title, its search field's prompt, and its close button's name.
  func setBar(title: String, search: String, close: String)
  /// Told once the page has drawn its first frame, which the extension's cold start is measured to.
  func drawn()
  /// Ends the sheet as done.
  func finish()
}

/// Where the module finds the host, which the view controller sets as it loads and clears as it goes.
@MainActor
public enum ShareExtensionBridge {
  public static weak var host: ShareExtensionHost?
  /// Posted with `text` in its user info as the bar's search field changes.
  public static let searched = Notification.Name("dev.vespin.ios.share.searched")
}

public final class ShareExtensionModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ShareExtension")

    Constant("appVersion") {
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }

    Events("onSearch")

    OnStartObserving("onSearch") {
      self.observer = NotificationCenter.default.addObserver(
        forName: ShareExtensionBridge.searched, object: nil, queue: .main
      ) { [weak self] note in
        self?.sendEvent("onSearch", ["text": note.userInfo?["text"] as? String ?? ""])
      }
    }

    OnStopObserving("onSearch") {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.observer = nil
    }

    AsyncFunction("sharedItems") { () async -> [String: Any] in
      await ShareExtensionBridge.host?.sharedItems() ?? [:]
    }

    AsyncFunction("snapshot") { () async -> String? in
      await ShareExtensionBridge.host?.snapshot()
    }

    AsyncFunction("accessToken") { () async -> String? in
      await ShareExtensionBridge.host?.accessToken()
    }

    AsyncFunction("picture") { (path: String) async -> String? in
      await ShareExtensionBridge.host?.picture(path)
    }

    AsyncFunction("keepDraft") { (json: String, pictures: [String]) async -> Bool in
      await ShareExtensionBridge.host?.keepDraft(json, pictures: pictures) ?? false
    }

    AsyncFunction("notify") {
      (id: String, title: String, body: String, payload: [String: Any]) async -> Bool in
      await ShareExtensionBridge.host?.notify(id: id, title: title, body: body, payload: payload) ?? false
    }

    AsyncFunction("setBar") { (title: String, search: String, close: String) async in
      await ShareExtensionBridge.host?.setBar(title: title, search: search, close: close)
    }

    AsyncFunction("drawn") { () async in
      await ShareExtensionBridge.host?.drawn()
    }

    AsyncFunction("finish") { () async in
      await ShareExtensionBridge.host?.finish()
    }
  }
}
