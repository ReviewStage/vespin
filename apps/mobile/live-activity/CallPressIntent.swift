// CallPressIntent.swift -- a voice call's Live Activity buttons: a mute set either way, or End call, handed to the app that holds the call.
//
// The widget draws the buttons and the app runs them: iOS runs a
// `LiveActivityIntent` in the app's process, so `app.config.ts` builds this
// file into both targets, as it does `StopAgentIntent.swift`. A call keeps
// the app running for as long as it stands (`UIBackgroundModes: audio`), so
// the press needs no queue and no waiting: it pings the app's `LiveActivity`
// module, which hands it to the call's JavaScript at once. Each button
// names the state it sets rather than a toggle, so a press that lands on a
// state already changed sets it again and nothing flips back.

import AppIntents
import Foundation

struct CallPressIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Voice call control"
  static let isDiscoverable = false

  /// The ping that carries a press, as the module names it too.
  static let pressed = Notification.Name("dev.vespin.live-activity.call-press")

  /// What a press sets, as `CALL_PRESS` names it in the app's JavaScript.
  enum Press: String {
    case muteMicrophone = "mute-microphone"
    case unmuteMicrophone = "unmute-microphone"
    case muteSpeaker = "mute-speaker"
    case unmuteSpeaker = "unmute-speaker"
    case end = "end"
  }

  @Parameter(title: "Press") var press: String

  init() {}

  init(_ press: Press) {
    self.press = press.rawValue
  }

  func perform() async throws -> some IntentResult {
    let press = press
    await MainActor.run {
      NotificationCenter.default.post(name: Self.pressed, object: nil, userInfo: ["press": press])
    }
    return .result()
  }
}
