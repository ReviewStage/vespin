// AgentsLiveActivity.swift -- the widget extension: the member's running agents in the Dynamic Island, on the Lock Screen, and on an Apple Watch or in CarPlay, beside the Inbox widget (`InboxWidget.swift`).
//
// One activity stands for every running agent of the member's
// (`AgentsActivityAttributes`). The compact and minimal presentations say
// how many are working. The expanded one and the Lock Screen list up to
// three, each with its title, a timer from its turn's start, and Stop
// (`StopAgentIntent`). Where an ask waits on the member, the count is drawn
// in the brand's copper (`Attention`) and a tap opens the Inbox, else a tap
// opens the newest running agent. The colors are the brand's, written
// into this target's asset catalog by `app.config.ts`. Every presentation
// has a preview at the end of the file.

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct AgentsWidgets: WidgetBundle {
  var body: some Widget {
    AgentsLiveActivity()
    InboxWidget()
  }
}

struct AgentsLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AgentsActivityAttributes.self) { context in
      ActivityContentView(state: context.state)
        .widgetURL(context.state.opens)
    } dynamicIsland: { context in
      let state = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          CountLabel(state: state).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          WaitingLabel(state: state).padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          AgentList(state: state)
        }
      } compactLeading: {
        Image(systemName: state.symbol).foregroundStyle(state.tint)
      } compactTrailing: {
        LimitedWidthReader { limited in
          Text(limited ? "\(state.running)" : state.countText)
            .monospacedDigit()
            .foregroundStyle(state.tint)
        }
      } minimal: {
        Text("\(state.running)").monospacedDigit().foregroundStyle(state.tint)
      }
      .widgetURL(state.opens)
      .keylineTint(state.tint)
    }
    .supplementalActivityFamilies([.small])
  }
}

// MARK: - Presentations

/// The Lock Screen's presentation, and the small one an Apple Watch or CarPlay draws.
struct ActivityContentView: View {
  @Environment(\.activityFamily) private var family
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    switch family {
    case .small:
      VStack(alignment: .leading, spacing: 2) {
        CountLabel(state: state)
        if let agent = state.agents.first {
          Text(agent.title).font(.caption).lineLimit(1)
          Text(agent.turnStart, style: .timer).font(.caption2).monospacedDigit()
            .foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(8)
    default:
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          CountLabel(state: state)
          Spacer()
          WaitingLabel(state: state)
        }
        AgentList(state: state)
      }
      .padding(16)
    }
  }
}

/// How many agents are working, or that they all finished, in the count's tint.
struct CountLabel: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    Label(state.countText, systemImage: state.symbol)
      .font(.subheadline.weight(.semibold))
      .monospacedDigit()
      .foregroundStyle(state.tint)
      .lineLimit(1)
  }
}

/// How many asks wait on the member, in copper; nothing while none does.
struct WaitingLabel: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    if state.waiting > 0 {
      Label { Text("\(state.waiting) waiting on you") } icon: { Image("Inbox") }
        .font(.caption.weight(.medium))
        .foregroundStyle(Color("Attention"))
        .lineLimit(1)
    }
  }
}

/// The running agents, the newest turn first.
struct AgentList: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    VStack(spacing: 8) {
      ForEach(state.agents.prefix(3)) { agent in
        AgentRow(agent: agent)
      }
    }
  }
}

/// One running agent: its title and the time its turn has run, opening its page, and Stop.
struct AgentRow: View {
  let agent: AgentsActivityAttributes.Agent

  var body: some View {
    HStack(spacing: 10) {
      // Note that the row opens its agent's page everywhere but on Stop, which a link around it would swallow.
      Link(destination: AgentsActivityAttributes.ContentState.route(agent: agent.id)) {
        HStack(spacing: 4) {
          Text(agent.title).font(.subheadline.weight(.medium)).lineLimit(1)
          Spacer(minLength: 4)
          Text(agent.turnStart, style: .timer)
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 56, alignment: .trailing)
        }
      }
      Button(intent: StopAgentIntent(agentId: agent.id)) {
        // The panel's Stop is a filled square, which SF Symbols' stop.fill draws, as the app's composer keeps it.
        Image(systemName: "stop.fill")
          .font(.caption)
          .frame(width: 28, height: 28)
          .background(.quaternary, in: Circle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Stop \(agent.title)")
    }
  }
}

/// Whether the Dynamic Island cannot widen its compact and minimal presentations, as in landscape and beside another activity on iOS 27; never before it.
struct LimitedWidthReader<Content: View>: View {
  @ViewBuilder let content: (Bool) -> Content

  var body: some View {
    if #available(iOS 27.0, *) {
      LimitedWidthEnvironment(content: content)
    } else {
      content(false)
    }
  }
}

@available(iOS 27.0, *)
private struct LimitedWidthEnvironment<Content: View>: View {
  @Environment(\.isDynamicIslandLimitedInWidth) private var limited
  let content: (Bool) -> Content

  var body: some View { content(limited) }
}

// MARK: - The state as drawn

extension AgentsActivityAttributes.ContentState {
  /// The count's words: how many are working, or that they all finished.
  var countText: String { running > 0 ? "\(running) working" : "Done" }

  /// The panel's glyph: a half-filled ring while agents work, a check once none does. Note that these stay SF Symbols, because the panel draws its status ring itself rather than with Lucide, as the app's own status marks do.
  var symbol: String { running > 0 ? "circle.righthalf.filled" : "checkmark.circle.fill" }

  /// Copper while an ask waits on the member, else the working or the finished tone.
  var tint: Color {
    if waiting > 0 { return Color("Attention") }
    return Color(running > 0 ? "Working" : "Complete")
  }

  /// Where a tap opens: the Inbox while an ask waits, else the newest running agent, else the Tasks tab.
  var opens: URL {
    if waiting > 0 { return URL(string: "vespin://inbox")! }
    if let agent = agents.first { return Self.route(agent: agent.id) }
    return URL(string: "vespin://tasks")!
  }

  /// An agent's page in the app.
  static func route(agent id: String) -> URL {
    var components = URLComponents()
    components.scheme = "vespin"
    components.host = "tasks"
    components.path = "/agent/\(id)"
    return components.url!
  }
}

// MARK: - Previews

extension AgentsActivityAttributes.ContentState {
  fileprivate static let working = Self(
    running: 3, waiting: 0,
    agents: [
      .init(
        id: "a1", title: "Fix the token refresh",
        startedAt: Date.now.addingTimeInterval(-94).timeIntervalSince1970 * 1000),
      .init(
        id: "a2", title: "Add Live Activities",
        startedAt: Date.now.addingTimeInterval(-612).timeIntervalSince1970 * 1000),
      .init(
        id: "a3", title: "Resend expired invites",
        startedAt: Date.now.addingTimeInterval(-8).timeIntervalSince1970 * 1000),
    ])
  fileprivate static let waitingOnYou = Self(running: 2, waiting: 1, agents: Array(working.agents.prefix(2)))
  fileprivate static let done = Self(running: 0, waiting: 0, agents: [])
}

#Preview("Lock Screen", as: .content, using: AgentsActivityAttributes()) {
  AgentsLiveActivity()
} contentStates: {
  AgentsActivityAttributes.ContentState.working
  AgentsActivityAttributes.ContentState.waitingOnYou
  AgentsActivityAttributes.ContentState.done
}

#Preview("Compact", as: .dynamicIsland(.compact), using: AgentsActivityAttributes()) {
  AgentsLiveActivity()
} contentStates: {
  AgentsActivityAttributes.ContentState.working
  AgentsActivityAttributes.ContentState.waitingOnYou
}

#Preview("Minimal", as: .dynamicIsland(.minimal), using: AgentsActivityAttributes()) {
  AgentsLiveActivity()
} contentStates: {
  AgentsActivityAttributes.ContentState.working
  AgentsActivityAttributes.ContentState.waitingOnYou
}

#Preview("Expanded", as: .dynamicIsland(.expanded), using: AgentsActivityAttributes()) {
  AgentsLiveActivity()
} contentStates: {
  AgentsActivityAttributes.ContentState.working
  AgentsActivityAttributes.ContentState.waitingOnYou
}
