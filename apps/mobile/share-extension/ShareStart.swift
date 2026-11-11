// ShareStart.swift -- the share sheet's Start as the app's New task sends it: one POST of the task and its agent's words to the service, under the account's access token.
//
// The extension holds no session of its own. It reads the access token the
// app keeps in their shared Keychain item (`ShareToken.swift`), which reads
// a token past its expiry as none, and the service's address and the
// headers the app names itself in from the snapshot (`AppGroupFiles.swift`).
// It never renews the token, since the refresh token stays the app's alone.
// The request follows no redirect, so the token never reaches another
// address, and is given up whole after `limit`, however slowly an answer
// trickles in. A redirect, a refusal, or no answer in time is reported as not
// started, and the sheet keeps the draft for New task instead. A task made
// whose agent the service refused (`agentRefusal` beside a success) is
// reported as made without its agent, so no draft makes it twice. One sheet
// sends every try under one idempotency key, so a second press after an
// answer that never came is the same request, never a second task.

import Foundation

/// Where the app's calls go, and the headers it names itself in, as the app wrote them.
struct ShareService {
  let origin: URL
  let headers: [String: String]
}

/// Refuses every redirect, so the response is the redirect itself and the bearer stays with the service.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest
  ) async -> URLRequest? {
    nil
  }
}

enum ShareStart {
  /// What a start came to: the task and its agent started, the task made with its agent refused, or nothing made that the sheet knows of.
  enum Outcome { case started, agentRefused, notStarted }

  /// The path New task's start is sent to (`HOSTED_SERVICE_PATH.TASKS`).
  private static let path = "/api/plans"
  /// How long the sheet waits on the service, in all, before it keeps the draft instead.
  private static let limit: Duration = .seconds(20)
  /// A session that keeps no cookies or cache of its own.
  private static let session = URLSession(configuration: .ephemeral)

  /// Starts `draft` as a task with its agent on the words, under `token` and `idempotencyKey`; what came of it in time.
  static func start(_ draft: ShareDraft, service: ShareService, token: String, idempotencyKey: String)
    async -> Outcome
  {
    let agent: [String: Any] = ["idempotencyKey": idempotencyKey, "prompt": draft.prompt]
    var body: [String: Any] = ["planning": false, "agent": agent]
    if let workspaceId = draft.workspaceId { body["workspaceId"] = workspaceId }
    if let repository = draft.repository { body["repository"] = repository }
    guard let data = try? JSONSerialization.data(withJSONObject: body) else { return .notStarted }
    var request = URLRequest(url: service.origin.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.httpBody = data
    for (name, value) in service.headers { request.setValue(value, forHTTPHeaderField: name) }
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    return await withTaskGroup(of: Outcome.self) { group in
      group.addTask { await send(request) }
      group.addTask {
        try? await Task.sleep(for: limit)
        return .notStarted
      }
      let first = await group.next() ?? .notStarted
      group.cancelAll()
      return first
    }
  }

  /// What the service answered `request`, following no redirect: a success whose answer names an `agentRefusal` made the task alone.
  private static func send(_ request: URLRequest) async -> Outcome {
    guard let (data, response) = try? await session.data(for: request, delegate: NoRedirects()),
      let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status)
    else { return .notStarted }
    let answer = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    return answer?["agentRefusal"] == nil ? .started : .agentRefused
  }
}
