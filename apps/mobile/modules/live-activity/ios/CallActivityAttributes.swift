// CallActivityAttributes.swift -- the Live Activity of a voice call into an agent, which the app starts, updates, and ends on the phone while the call stands.
//
// The app's module and the widget extension each build this same file, as
// they do `AgentsActivityAttributes.swift`, since ActivityKit matches an
// activity to its presentation by the type's name. Nothing pushes to it:
// the call is the phone's own, so the app's JavaScript hands each state as
// JSON (`src/live-activity/call-activity.ts`), key for key with the content
// state below. Note that an instant is epoch milliseconds, because
// ActivityKit decodes a `Date` as seconds since 2001.

import ActivityKit
import Foundation

struct CallActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    /// The agent the call speaks to, by name, which may arrive after the call starts.
    var agentName: String
    /// Where the call stands, as `VOICE_CALL_STAGE` names it: connecting, live, or ending.
    var stage: String
    /// When the session started, in epoch milliseconds; none while it connects.
    var startedAt: Double?
    /// The call's line in the call card's words: where it stands while it connects or ends, what the agent does while it works, and that the call is on while the agent is idle.
    var line: String
    var microphoneMuted: Bool
    var speakerMuted: Bool

    var start: Date? { startedAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
  }

  /// The agent the call speaks to, whose page a tap opens. Note that its name rides in the state, since the attributes cannot change once the activity starts.
  var agentId: String
}
