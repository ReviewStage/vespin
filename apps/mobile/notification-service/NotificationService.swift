// NotificationService.swift -- the app's Notification Service Extension: a decide's options set as its notification's buttons before iOS shows it.
//
// A category's actions are fixed once it is registered, so each decide push
// (`inbox-decide`) registers a category of its own, named for the ask's
// message, whose buttons say the payload's `options` and are named by each
// option's place, 0 first, which the app reads back
// (`@repo/features/inbox-push-wire`). Each button opens the app, which sends
// the option on the thread. The app's own categories are kept as they are,
// with a bounded number of decide categories beside them. Every other push
// passes through untouched. `app.config.ts` adds this target to the project
// Expo generates.

import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
  /// The category a decide push names, and the stem of the one made for each.
  private static let decideCategory = "inbox-decide"
  /// The most decide categories kept at once; iOS holds categories as a set, so any past it are dropped, never the app's own.
  private static let keptDecideCategories = 32

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
