// ShareStart.swift -- the share sheet's Start as the app's New task sends it: one POST of the task and its agent's words to the service, under the account's current access token.
//
// The extension holds no session of its own. It reads the access token the
// app keeps in their shared Keychain item (`ShareToken.swift`), and the
// service's address and the headers the app names itself in from the
// snapshot (`AppGroupFiles.swift`). It never renews the token, since the
// refresh token stays the app's alone: a token gone stale, a refusal, or no
// answer is reported as not started, and the sheet keeps the draft for New
// task instead.

import Foundation

/// Where the app's calls go, and the headers it names itself in, as the app wrote them.
struct ShareService {
  let origin: URL
  let headers: [String: String]
}

enum ShareStart {
  /// The path New task's start is sent to (`HOSTED_SERVICE_PATH.TASKS`).
  private static let path = "/api/plans"
  /// How long the sheet waits on the service before it keeps the draft instead.
  private static let timeout: TimeInterval = 20

  /// Starts `draft` as a task with its agent on the words, under `token`; whether the service took it.
  static func start(_ draft: ShareDraft, service: ShareService, token: String) async -> Bool {
    let agent: [String: Any] = ["idempotencyKey": UUID().uuidString, "prompt": draft.prompt]
    var body: [String: Any] = ["planning": false, "agent": agent]
    if let workspaceId = draft.workspaceId { body["workspaceId"] = workspaceId }
    if let repository = draft.repository { body["repository"] = repository }
    guard let data = try? JSONSerialization.data(withJSONObject: body) else { return false }
    var request = URLRequest(url: service.origin.appendingPathComponent(path), timeoutInterval: timeout)
    request.httpMethod = "POST"
    request.httpBody = data
    for (name, value) in service.headers { request.setValue(value, forHTTPHeaderField: name) }
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    guard let (_, response) = try? await URLSession.shared.data(for: request),
      let status = (response as? HTTPURLResponse)?.statusCode
    else { return false }
    return (200..<300).contains(status)
  }
}
