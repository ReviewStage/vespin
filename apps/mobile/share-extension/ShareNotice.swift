// ShareNotice.swift -- the notification the share page posts once a share makes a task, which a tap opens in the app.
//
// No public API lets an extension bring its app forward, so the way back to
// what was sent is a local notification the app's own tap handler routes
// (`PUSH_KIND.SHARE_STARTED`, `@repo/features/inbox-push-wire`). Its words
// and payload are the page's (`@repo/features/ios-share-extension`'s
// `shareStartedNotice`): the ids alone and none of the task's words, so a
// locked phone shows nothing of the share whatever its previews setting.
// It posts only where the app's notifications are already allowed, and
// never asks.

import UserNotifications

enum ShareNotice {
  /// Posts the notification under `id`, which replaces one posted before under it, where notifications are allowed; whether it was posted.
  static func post(id: String, title: String, body: String, payload: [String: Any]) async -> Bool {
    let center = UNUserNotificationCenter.current()
    let allowed: Set<UNAuthorizationStatus> = [.authorized, .provisional, .ephemeral]
    let status = await center.notificationSettings().authorizationStatus
    guard allowed.contains(status) else { return false }
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.userInfo = payload
    let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
    return (try? await center.add(request)) != nil
  }
}
