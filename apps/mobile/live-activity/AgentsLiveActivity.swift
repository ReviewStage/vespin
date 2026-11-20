// AgentsLiveActivity.swift -- the widget extension: the member's running agents in the Dynamic Island, on the Lock Screen, and on an Apple Watch or in CarPlay, beside a voice call's own activity (`CallLiveActivity.swift`) and the Inbox widget (`InboxWidget.swift`).
//
// One activity stands for every running agent of the member's
// (`AgentsActivityAttributes`). The compact and minimal presentations say
// how many are working. The expanded one and the Lock Screen list up to
// three, each with its title, a timer from its turn's start, and Stop
// (`StopAgentIntent`). The count stands by the panel's working mark while
// agents work, and by its done mark once none does, in the working blue or
// the done green, and copper (`Attention`) marks only what wants the member:
// the asks waiting, the compact presentation's Inbox glyph, and the keyline
// while one waits. A tap opens the Inbox while an ask waits, else the newest
// running agent. The colors are the brand's, written into this target's
// asset catalog by `app.config.ts`. Every presentation has a preview at the
// end of the file.

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct AgentsWidgets: WidgetBundle {
  var body: some Widget {
    AgentsLiveActivity()
    CallLiveActivity()
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
        // Note that the header stands in from the island's sides as far as the rows do, so its ends line up with the rows' titles and Stop.
        DynamicIslandExpandedRegion(.leading) {
          CountLabel(state: state).padding(.leading, ExpandedInset.side)
        }
        DynamicIslandExpandedRegion(.trailing) {
          WaitingLabel(state: state).padding(.trailing, ExpandedInset.side)
        }
        DynamicIslandExpandedRegion(.bottom) {
          // Note that the rows stand in from the island's sides, since its corners curve in under the rows' ends and clipped a title's first letter.
          AgentList(state: state).padding(.horizontal, ExpandedInset.side)
        }
      } compactLeading: {
        CompactMark(state: state)
      } compactTrailing: {
        RunningCount(state: state)
      } minimal: {
        RunningCount(state: state)
      }
      .widgetURL(state.opens)
      .keylineTint(state.keyline)
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

/// How many agents are working, or that they all finished, by the panel's working mark or its done mark, in the working blue or the done green.
struct CountLabel: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    Label {
      Text(state.countText).contentTransition(.numericText(value: Double(state.running)))
    } icon: {
      StateMark(state: state)
    }
    .font(.subheadline.weight(.semibold))
    .monospacedDigit()
    .foregroundStyle(state.tone)
    .lineLimit(1)
  }
}

/// How many asks need the member, in the panel's words and copper; nothing while none does.
struct WaitingLabel: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    if state.waiting > 0 {
      Label {
        Text(state.waitingText).contentTransition(.numericText(value: Double(state.waiting)))
      } icon: {
        Image("Inbox")
      }
      .font(.caption.weight(.medium))
      .foregroundStyle(Color("Attention"))
      .lineLimit(1)
    }
  }
}

/// The running agents, the newest turn first.
struct AgentList: View {
  /// The room between two rows, in points.
  static let spacing: CGFloat = 8

  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    VStack(spacing: Self.spacing) {
      ForEach(state.agents.prefix(3)) { agent in
        AgentRow(agent: agent)
      }
    }
  }
}

/// One running agent: its title and the time its turn has run, opening its page, and Stop.
struct AgentRow: View {
  @Environment(\.isLuminanceReduced) private var dimmed
  let agent: AgentsActivityAttributes.Agent

  var body: some View {
    // Note that the circle's gap from the timer is this spacing and the target's whole extra width, 18 points, as it was while the circle stood centered in its target.
    HStack(spacing: 10 - (StopTarget.width - StopTarget.mark) / 2) {
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
        // The panel's Stop is a filled square, which SF Symbols' stop.fill draws, in the ground on an ink circle, as the composer's Stop stands.
        // Note that with the screen dimmed, as Always On stands it, Stop is drawn as an outline, so no bright disc stands on the dark Lock Screen.
        Image(systemName: "stop.fill")
          .font(.caption)
          .foregroundStyle(dimmed ? Color("Text") : Color("Ground"))
          .frame(width: StopTarget.mark, height: StopTarget.mark)
          .background {
            if dimmed {
              Circle().strokeBorder(Color("Text"), lineWidth: 1.5)
            } else {
              Circle().fill(Color("Text"))
            }
          }
          // Note that the target is wider and taller than the circle, but gives its height back to the row, so three rows still fit the expanded island; it reaches halfway into the gap between rows, never into the next row's Stop.
          // Note that the circle stands at the target's trailing edge, so it lines up with the header's trailing edge, and the target's extra width reaches toward the title instead.
          .frame(width: StopTarget.width, height: StopTarget.height, alignment: .trailing)
          .contentShape(Rectangle())
          .padding(.vertical, (StopTarget.mark - StopTarget.height) / 2)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Stop \(agent.title)")
    }
  }
}

/// Stop's circle and the target around it, in points. The target is Apple's least width, and as tall as a row and half the gap to each neighbor (`AgentList`'s spacing), so a press between two rows stops the nearer agent.
enum StopTarget {
  static let mark: CGFloat = 28
  static let width: CGFloat = 44
  static let height: CGFloat = mark + AgentList.spacing
}

/// How far the expanded island's header and rows stand in from its sides, in points, clear of the curve of its corners.
enum ExpandedInset {
  static let side: CGFloat = 8
}

/// The compact island's leading mark: the Inbox glyph in copper while an ask needs the member, else the status mark in its tone.
struct CompactMark: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    if state.waiting > 0 {
      Image("Inbox").foregroundStyle(Color("Attention"))
    } else {
      StateMark(state: state).foregroundStyle(state.tone)
    }
  }
}

/// Where the agents stand, as the panel marks it: its working mark while any works, its done mark once none does.
struct StateMark: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    if state.running > 0 {
      WorkingMark()
    } else {
      Image("TaskStatusDone")
    }
  }
}

/// The panel's working mark (`@repo/ui`'s `WorkingMark`): eight 3 pt cells
/// lapped round a 3×3 grid 2 pt apart in a 16 pt side, faint, and two
/// chasers each with a fainter tail, in the ink around it. Note that it
/// stands on the panel's resting frame, mid-lap, which lights four cells
/// and reads as working, since a Live Activity is drawn once for each
/// update rather than frame by frame, as the app holds its own mark still
/// where the reader reduces motion.
struct WorkingMark: View {
  private static let cell: CGFloat = 3
  private static let pitch: CGFloat = 5
  private static let side: CGFloat = 16
  private static let inset = (Self.side - (2 * Self.pitch + Self.cell)) / 2

  /// The cells of the track, column and row, in the order the chasers lap them.
  private static let track: [(column: Int, row: Int)] = [
    (0, 0), (1, 0), (2, 0), (2, 1), (2, 2), (1, 2), (0, 2), (0, 1),
  ]

  /// The chasers and their tails on the resting frame: the track cell each stands on, and how strong it stands.
  private static let dots: [(cell: Int, shade: Double)] = [(1, 1), (0, 0.6), (5, 1), (4, 0.6)]

  var body: some View {
    ZStack(alignment: .topLeading) {
      ForEach(Self.track.indices, id: \.self) { index in
        square(index).opacity(0.3)
      }
      ForEach(Self.dots.indices, id: \.self) { index in
        square(Self.dots[index].cell).opacity(Self.dots[index].shade)
      }
    }
    .frame(width: Self.side, height: Self.side, alignment: .topLeading)
    .accessibilityHidden(true)
  }

  /// The rounded square on the track cell at `index`.
  private func square(_ index: Int) -> some View {
    let place = Self.track[index]

    return RoundedRectangle(cornerRadius: Self.cell / 4)
      .frame(width: Self.cell, height: Self.cell)
      .offset(
        x: Self.inset + CGFloat(place.column) * Self.pitch,
        y: Self.inset + CGFloat(place.row) * Self.pitch)
  }
}

/// The count alone, as the compact island's trailing side and its minimal presentation stand it, rolling as it changes.
struct RunningCount: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    Text("\(state.running)")
      .monospacedDigit()
      .contentTransition(.numericText(value: Double(state.running)))
      .foregroundStyle(state.tone)
  }
}

// MARK: - The state as drawn

extension AgentsActivityAttributes.ContentState {
  /// The count's words: how many are working, or that they all finished.
  var countText: String { running > 0 ? "\(running) working" : "Done" }

  /// How many asks need the member, in the panel's words (`NEEDS_YOU` in `@repo/features/inbox-list-model`): "1 needs you", "3 need you".
  var waitingText: String { "\(waiting) \(waiting == 1 ? "needs" : "need") you" }

  /// The count's tone: the working blue, or the done green once none works. Copper is left for what needs the member.
  var tone: Color { Color(running > 0 ? "Working" : "Complete") }

  /// The island's keyline: copper while an ask needs the member, else the count's tone.
  var keyline: Color { waiting > 0 ? Color("Attention") : tone }

  /// Where a tap opens: the Inbox while an ask waits, else the newest running agent, else the Tasks tab.
  var opens: URL {
    if waiting > 0 { return URL(string: "vespin://inbox")! }
    if let agent = agents.first { return Self.route(agent: agent.id) }
    return URL(string: "vespin://tasks")!
  }

  /// An agent's page in the app, as Stop opens it where it can't send.
  static func route(agent id: String) -> URL { StopAgentIntent.page(agent: id) }
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
