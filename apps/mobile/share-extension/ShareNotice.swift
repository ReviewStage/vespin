// ShareNotice.swift -- the notification the share sheet posts once Start makes a task, which a tap opens in the app.
//
// No public API lets an extension bring its app forward, so the way back to
// what was sent is a local notification the app's own tap handler routes
// (`PUSH_KIND.SHARE_STARTED`, `@repo/features/inbox-push-wire`): to the
// agent's page, or to the task where its agent didn't start. It carries the
// ids alone and none of the task's words, so a locked phone shows nothing of
// the task whatever its previews setting. It posts only where the app's
// notifications are already allowed, and never asks, since the sheet says
// "Started" itself either way.

import UserNotifications

enum ShareNotice {
  /// The notification's words, which name nothing of the task.
  private enum Words {
    static let title = "Task started"
    static let agent = "Tap to open its agent in Vespin."
    static let task = "Its agent didn't start. Tap to open the task in Vespin."
  }

  /// The payload kind the app's tap handler reads (`PUSH_KIND.SHARE_STARTED`).
  private static let kind = "share-started"

  /// Posts the notification for `task` where notifications are allowed; whether it was posted.
  static func post(_ task: StartedTask) async -> Bool {
    guard let taskId = task.taskId else { return false }
    let center = UNUserNotificationCenter.current()
    let allowed: Set<UNAuthorizationStatus> = [.authorized, .provisional, .ephemeral]
    let status = await center.notificationSettings().authorizationStatus
    guard allowed.contains(status) else { return false }
    let content = UNMutableNotificationContent()
    content.title = Words.title
    var payload: [String: Any] = ["kind": kind, "taskId": taskId]
    if let agentId = task.agentId {
      payload["agentId"] = agentId
      content.body = Words.agent
    } else {
      content.body = Words.task
    }
    content.userInfo = payload
    // Note that the task's id names the request, so a second press for the same task replaces its notification.
    let request = UNNotificationRequest(identifier: taskId, content: content, trigger: nil)
    return (try? await center.add(request)) != nil
  }
}
