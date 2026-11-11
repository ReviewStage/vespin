// AgentsActivityAttributes.swift -- the one Live Activity of a member's running agents, as the service's pushes start, update, and end it.
//
// ActivityKit matches a push to this type by its bare name, the payload's
// `attributes-type` (`LIVE_ACTIVITY_ATTRIBUTES_TYPE`), so the app's module
// and the widget extension each build this same file: `app.config.ts`
// copies it beside the widget's Swift. The content state is the payload
// `@repo/features/live-activity-wire` declares, key for key. Note that an
// instant is epoch milliseconds, because ActivityKit decodes a `Date` as
// seconds since 2001.

import ActivityKit
import Foundation

struct AgentsActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    /// How many of the member's agents are running.
    var running: Int
    /// How many asks wait on the member.
    var waiting: Int
    /// Up to three running agents, the newest turn first.
    var agents: [Agent]
  }

  struct Agent: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    /// When its turn began, in epoch milliseconds.
    var startedAt: Double

    var turnStart: Date { Date(timeIntervalSince1970: startedAt / 1000) }
  }
}
