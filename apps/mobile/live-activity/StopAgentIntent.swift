// StopAgentIntent.swift -- the Live Activity's Stop button: it asks the app to stop one running agent.
//
// The widget draws the button and the app runs it. iOS runs a
// `LiveActivityIntent` in the app's process, so `app.config.ts` builds this
// file into both targets. The stop itself is the app's host's, which holds
// the account. The intent leaves the request in the standard defaults,
// pings the app's `LiveActivity` module, which hands it to the host,
// and waits for the module to take the request away once the host has
// answered. Note that the app's JavaScript starts only once a scene
// connects, so where no answer comes soon, the intent asks iOS to bring the
// app forward, and the module hands the request on as it starts. The
// widget's copy, which never runs, leaves the foreground out, since an
// extension cannot come forward (`APP_EXTENSION`, which `app.config.ts`
// sets on every extension).

import AppIntents
import Foundation

struct StopAgentIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Stop agent"
  static let isDiscoverable = false
  #if !APP_EXTENSION
    static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]
  #endif

  /// The defaults key the requests wait under, and the ping that names a new one, as the module names them too.
  static let requestsKey = "dev.vespin.live-activity.stops"
  static let asked = Notification.Name("dev.vespin.live-activity.stop-asked")
  /// How long the app has to answer in the background, and once it is forward.
  private static let backgroundWait: Duration = .seconds(3)
  private static let foregroundWait: Duration = .seconds(25)
  private static let poll: Duration = .milliseconds(250)

  @Parameter(title: "Agent") var agentId: String

  init() {}

  init(agentId: String) {
    self.agentId = agentId
  }

  func perform() async throws -> some IntentResult {
    let request = UUID().uuidString
    let agentId = agentId
    await MainActor.run {
      let defaults = UserDefaults.standard
      let entry: [String: Any] = [
        "agentId": agentId, "request": request, "askedAt": Date().timeIntervalSince1970 * 1000,
      ]
      defaults.set((defaults.array(forKey: Self.requestsKey) ?? []) + [entry], forKey: Self.requestsKey)
      NotificationCenter.default.post(name: Self.asked, object: nil)
    }
    if await Self.answered(request, within: Self.backgroundWait) { return .result() }
    #if !APP_EXTENSION
      try? await continueInForeground(nil, alwaysConfirm: false)
    #endif
    _ = await Self.answered(request, within: Self.foregroundWait)
    return .result()
  }

  /// Whether the module took `request` away, answered, before the wait ran out.
  private static func answered(_ request: String, within wait: Duration) async -> Bool {
    let deadline = ContinuousClock.now + wait
    while ContinuousClock.now < deadline {
      let waiting = await MainActor.run {
        (UserDefaults.standard.array(forKey: requestsKey) ?? []).contains {
          ($0 as? [String: Any])?["request"] as? String == request
        }
      }
      if !waiting { return true }
      try? await Task.sleep(for: poll)
    }
    return false
  }
}
