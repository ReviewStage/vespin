// StopAgentIntent.swift -- the Live Activity's Stop button: it stops one running agent from the app's process, or opens the agent's page where it can't.
//
// The widget draws the button and the app runs it: iOS runs a
// `LiveActivityIntent` in the app's process, so `app.config.ts` builds this
// file into both targets. The intent sends the stop to the service itself
// (`AgentStop`, in the app's Live Activity module), under the access token
// the share sheet reads and the phone JavaScript kept, as the module sends
// an activity's update token. Where the stop can't go, as under an access
// token past its 50 minutes, or the service doesn't take it, the intent
// brings the app forward on the agent's page, whose Stop is a press away.
// The widget's copy, which never runs, leaves the send and the foreground
// out, since an extension neither links the module nor comes forward
// (`APP_EXTENSION`, which `app.config.ts` sets on every extension).

import AppIntents
import Foundation

#if !APP_EXTENSION
  import UIKit
  // Note that the import is internal, as Expo's generated module list in the same target imports it, since Swift 6 refuses a plain import beside an `internal import` of the same module.
  internal import VespinLiveActivity
#endif

struct StopAgentIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Stop agent"
  static let isDiscoverable = false
  #if !APP_EXTENSION
    static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]
  #endif

  @Parameter(title: "Agent") var agentId: String

  init() {}

  init(agentId: String) {
    self.agentId = agentId
  }

  /// An agent's page in the app, which Stop opens where it can't send, and a call's activity opens.
  static func page(agent id: String) -> URL {
    var components = URLComponents()
    components.scheme = "vespin"
    components.host = "tasks"
    components.path = "/agent/\(id)"
    return components.url!
  }

  func perform() async throws -> some IntentResult {
    #if !APP_EXTENSION
      if await AgentStop.send(agentId: agentId) { return .result() }
      try await continueInForeground(nil, alwaysConfirm: false)
      let page = Self.page(agent: agentId)
      await MainActor.run { UIApplication.shared.open(page) }
    #endif
    return .result()
  }
}
