// NotificationService.swift -- the app's Notification Service Extension: a decide's options set as its notification's buttons before iOS shows it, and the Inbox widget moved by each post that waits on the member.
//
// A category's actions are fixed once it is registered, so each decide push
// (`inbox-decide`) registers a category of its own, named for the ask's
// message, whose buttons say the payload's `options` and are named by each
// option's place, 0 first, which the app reads back
// (`@repo/features/inbox-push-wire`). Each button opens the app, which sends
// the option on the thread. The app's own categories are kept as they are,
// with a bounded number of decide categories beside them. Every other push
// passes through untouched. A post on a thread, an ask or any other, also
// moves the Inbox widget's snapshot in the App Group, its thread's row on
// top and the push's badge as its count where that is the workspace's
// (`InboxWidgetSnapshot.swift`, which this target builds too), so the widget
// stays current while the app is closed. `app.config.ts` adds this target to
// the project Expo generates.

import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
  /// The category a decide push names, and the stem of the one made for each.
  private static let decideCategory = "inbox-decide"
  /// The most decide categories kept at once; iOS holds categories as a set, so any past it are dropped, never the app's own.
  private static let keptDecideCategories = 32
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
    guard content.categoryIdentifier == Self.decideCategory,
      let messageId = content.userInfo["messageId"] as? String,
      let options = content.userInfo["options"] as? [String], !options.isEmpty
    else {
      deliver()
      return
    }
    let category = UNNotificationCategory(
      identifier: "\(Self.decideCategory).\(messageId)",
      actions: options.enumerated().map { place, label in
        UNNotificationAction(identifier: String(place), title: label, options: [.foreground])
      },
      intentIdentifiers: [],
      options: [])
    let center = UNUserNotificationCenter.current()
    center.getNotificationCategories { registered in
      let decides = registered.filter { $0.identifier.hasPrefix("\(Self.decideCategory).") }
      let kept = registered.subtracting(decides)
        .union(decides.prefix(Self.keptDecideCategories - 1))
        .union([category])
      center.setNotificationCategories(kept)
      content.categoryIdentifier = category.identifier
      self.deliver()
    }
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

  /// Hands iOS the notification once, whichever of the category's registration and the deadline comes first.
  private func deliver() {
    guard let contentHandler, let content else { return }
    self.contentHandler = nil
    contentHandler(content)
  }
}
