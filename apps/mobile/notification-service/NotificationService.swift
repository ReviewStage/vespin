// NotificationService.swift -- the app's Notification Service Extension: the Inbox widget moved by each post that waits on the member, before iOS shows its push.
//
// A post on a thread, an ask or any other, moves the Inbox widget's snapshot
// in the App Group, its thread's row on top and the push's badge as its count
// where that is the workspace's (`InboxWidgetSnapshot.swift`, which this
// target builds too), so the widget stays current while the app is closed.
// Every push is delivered as it came: a decide's buttons are set on its
// notification by the Notification Content Extension
// (`notification-content/`), which iOS picks by the decide's own category.
// `app.config.ts` adds this target to the project Expo generates.

import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
  /// The kinds of push about a post on a thread that waits on the member (`PUSH_KIND`).
  private static let threadPushKinds: Set<String> = ["ask", "post"]

  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var content: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    self.contentHandler = contentHandler
    self.content = content
    Self.moveInboxWidget(by: content)
    deliver()
  }

  /// Moves the Inbox widget's snapshot by a post on a thread, as the push's ids, title, ask, and badge tell it; nothing for any other push, or before the app wrote a snapshot.
  private static func moveInboxWidget(by content: UNNotificationContent) {
    let info = content.userInfo
    guard let kind = info["kind"] as? String, threadPushKinds.contains(kind),
      let itemId = info["itemId"] as? String,
      let snapshot = InboxWidgetSnapshot.read()
    else { return }
    snapshot.taking(
      news: itemId,
      title: content.title.isEmpty ? nil : content.title,
      ask: info["ask"] as? String,
      badge: content.badge?.intValue
    ).save()
  }

  // iOS is about to show the push as it came, so it is shown with whatever was set by now.
  override func serviceExtensionTimeWillExpire() {
    deliver()
  }

  /// Hands iOS the notification once, whichever of the widget's move and the deadline comes first.
  private func deliver() {
    guard let contentHandler, let content else { return }
    self.contentHandler = nil
    contentHandler(content)
  }
}
