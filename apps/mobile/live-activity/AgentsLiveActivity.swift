// AgentsLiveActivity.swift -- the widget extension: the member's running agents in the Dynamic Island, on the Lock Screen, and on an Apple Watch or in CarPlay, beside a voice call's own activity (`CallLiveActivity.swift`) and the Inbox widget (`InboxWidget.swift`).
//
// One activity stands for every running agent of the member's
// (`AgentsActivityAttributes`). The compact and minimal presentations say
// how many are working, and the compact one's trailing side ticks the
// newest turn's time while any works, which the system advances itself, so
// the island shows work moving. The expanded one and the Lock Screen list
// up to three, each with its title, the time its turn has run, and Stop
// (`StopAgentIntent`). Every such time is an `ElapsedTime`, which fits its
// widest reading and reads hours and minutes once the screen dims. While
// agents work the count stands as words alone, with no mark beside it,
// since a Live Activity runs no animation of its own and a still working
// mark read as stuck (`CountLabel`); once none does it stands by the
// panel's done mark, in the same row and place, in the
// working blue or the done green, and copper (`Attention`) marks only what
// wants the member: the asks waiting, the compact presentation's Inbox
// glyph, and the keyline while one waits.
// Nothing in it is a link, so no row or region opens a page of the app: a
// person swipes it away more often than they open it, and a swipe the
// system read as a tap opened an agent. A tap still opens the
// app, as iOS opens it on any activity. The colors are the brand's, written
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
    CallLiveActivity()
    InboxWidget()
    NewTaskControl()
  }
}

struct AgentsLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AgentsActivityAttributes.self) { context in
      ActivityContentView(state: context.state)
    } dynamicIsland: { context in
      let state = context.state
      return DynamicIsland {
        // Note that the header stands in from the island's sides as far as the rows do, so its ends line up with the rows' titles and Stop.
        DynamicIslandExpandedRegion(.leading) {
          if state.running > 0 {
            CountLabel(state: state).padding(.leading, ExpandedInset.side)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          if state.running > 0 {
            WaitingLabel(state: state).padding(.trailing, ExpandedInset.side)
          }
        }
        // Note that the rows stand in from the island's sides, since its corners curve in under the rows' ends and clipped a title's first letter.
        // Note that once none works the header stands alone in the rows' place, below the camera where the island centers it top to bottom, and in from the sides as far as the rows, so the done mark and the asks stand at the edges the count and the asks stood at.
        DynamicIslandExpandedRegion(.bottom) {
          Group {
            if state.running > 0 {
              AgentList(state: state)
            } else {
              HeaderRow(state: state)
            }
          }
          .padding(.horizontal, ExpandedInset.side)
        }
      } compactLeading: {
        CompactMark(state: state)
      } compactTrailing: {
        CompactTrailing(state: state)
      } minimal: {
        RunningCount(state: state)
      }
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
          ElapsedTime(start: agent.turnStart, fields: ElapsedTime.Fields.row, alignment: .leading)
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(8)
    default:
      // Note that once none works the header stands alone, in the same row as while agents work, so the done mark and the asks stand where the count and the asks stood, centered top to bottom by the even padding.
      VStack(alignment: .leading, spacing: 10) {
        HeaderRow(state: state)
        if state.running > 0 {
          AgentList(state: state)
        }
      }
      .padding(16)
    }
  }
}

/// How many agents are working, in words alone, or that they all finished, by the panel's done mark, in the working blue or the done green.
///
/// Note that no mark stands beside the working count, since a Live Activity
/// is drawn once and archived: only time-driven text and a timer's progress
/// advance on their own, and anything else moves only in the two seconds
/// after an update, and never with the screen dimmed (WidgetKit's
/// "Animating data updates in widgets and Live Activities"). So the panel's
/// working mark stood frozen mid-lap and read as stuck, and the elapsed
/// times are what show work moving.
struct CountLabel: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    Group {
      if state.running > 0 {
        count
      } else {
        Label {
          count
        } icon: {
          Image("TaskStatusDone").accessibilityHidden(true)
        }
      }
    }
    .font(.subheadline.weight(.semibold))
    .monospacedDigit()
    .foregroundStyle(state.tone)
    .lineLimit(1)
  }

  private var count: some View {
    Text(state.countText).contentTransition(.numericText(value: Double(state.running)))
  }
}

/// The header: the count or the done mark at the leading edge and any asks waiting at the trailing edge, the same row while agents work and once none does.
struct HeaderRow: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    HStack {
      CountLabel(state: state)
      Spacer()
      WaitingLabel(state: state)
    }
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
      HStack(spacing: 4) {
        Text(agent.title).font(.subheadline.weight(.medium)).lineLimit(1)
        Spacer(minLength: 4)
        ElapsedTime(start: agent.turnStart, fields: ElapsedTime.Fields.row, alignment: .trailing)
          .contentTransition(.numericText(countsDown: false))
          .font(.caption)
          .foregroundStyle(.secondary)
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

/// The compact island's leading side: the Inbox glyph in copper while an ask needs the member, else how many work, beside the trailing side's ticking time, or the done mark once none does.
struct CompactMark: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    if state.waiting > 0 {
      Image("Inbox").foregroundStyle(Color("Attention"))
    } else if state.running > 0 {
      RunningCount(state: state)
    } else {
      Image("TaskStatusDone").foregroundStyle(state.tone).accessibilityHidden(true)
    }
  }
}

/// The compact island's trailing side: while any agent works, the time the newest turn has run, which the system ticks every second, so the island always shows work moving; the count once none does. Note that the count still stands in the minimal presentation and in the expanded island and Lock Screen headers.
struct CompactTrailing: View {
  let state: AgentsActivityAttributes.ContentState

  var body: some View {
    if state.running > 0 {
      ElapsedTime(start: state.newestTurnStart, fields: ElapsedTime.Fields.compact, alignment: .trailing)
        .foregroundStyle(state.tone)
    } else {
      RunningCount(state: state)
    }
  }
}

/// How long a turn has run since `start`, which the system advances itself.
///
/// Lit, it reads as a timer of at most `fields` fields, so the compact
/// island's two read "4:05" under an hour and "22:38", hours and minutes,
/// past it, where its seconds would make it too wide for the island. Dimmed,
/// as Always On stands the screen, it reads hours and minutes, "0:04" and
/// "22:38", in place of the timer: the system drops a timer's seconds there,
/// since it redraws too seldom to tick them, and spells what is left out in
/// words ("22 hours, 38 minutes"), too wide for any of the places it stands.
///
/// Note that such text fills every width it is offered, since the system lays
/// a widget out once and cannot measure the readings to come (Apple's
/// `Text.init(_:format:)`), so it stands in a hidden template of its widest
/// reading, which sizes it to the font it is drawn in: a turn runs a day at
/// most (`TURN_DEADLINE.CAP_MS` in `@repo/features/turn-deadline`), so two
/// digits of hours always fit.
struct ElapsedTime: View {
  /// The most fields the lit timer shows where each stands.
  enum Fields {
    /// The compact island's narrow side: minutes and seconds, or hours and minutes.
    static let compact = 2
    /// A row's room: hours, minutes, and seconds.
    static let row = 3
  }

  @Environment(\.isLuminanceReduced) private var dimmed
  let start: Date
  let fields: Int
  /// The edge the reading stands against within its template's width.
  let alignment: HorizontalAlignment

  /// The widest reading at `fields`, with every digit a zero, which a monospaced digit draws as wide as any.
  private var template: String { fields > Fields.compact ? "00:00:00" : "00:00" }

  var body: some View {
    Text(template)
      .hidden()
      .overlay(alignment: Alignment(horizontal: alignment, vertical: .center)) {
        reading
          .multilineTextAlignment(alignment == .leading ? .leading : .trailing)
      }
      .monospacedDigit()
      .lineLimit(1)
  }

  @ViewBuilder private var reading: some View {
    if dimmed {
      Text(.durationOffset(to: start), format: .time(pattern: .hourMinute(padHourToLength: 1, roundSeconds: .down)))
    } else {
      Text(.currentDate, format: .timer(countingUpIn: start..<Date.distantFuture, maxFieldCount: fields))
    }
  }
}

/// The count alone, as the minimal presentation and the compact island once none works stand it, rolling as it changes.
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

  /// When the newest running turn began, which the compact island's timer counts from; now where none is listed.
  var newestTurnStart: Date { agents.first?.turnStart ?? .now }

  /// The count's tone: the working blue, or the done green once none works. Copper is left for what needs the member.
  var tone: Color { Color(running > 0 ? "Working" : "Complete") }

  /// The island's keyline: copper while an ask needs the member, else the count's tone.
  var keyline: Color { waiting > 0 ? Color("Attention") : tone }

  /// An agent's page in the app, which a call's activity opens (`CallLiveActivity.swift`).
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
  /// Turns past an hour, the newest 22 hours and 38 minutes in, where the timers read their widest.
  fileprivate static let longRunning = Self(
    running: 2, waiting: 1,
    agents: [
      .init(
        id: "a4", title: "Migrate the billing ledger",
        startedAt: Date.now.addingTimeInterval(-(22 * 3600 + 38 * 60 + 12)).timeIntervalSince1970 * 1000),
      .init(
        id: "a5", title: "Watch the release",
        startedAt: Date.now.addingTimeInterval(-(23 * 3600 + 59 * 60)).timeIntervalSince1970 * 1000),
    ])
  fileprivate static let done = Self(running: 0, waiting: 0, agents: [])
}

#Preview("Lock Screen", as: .content, using: AgentsActivityAttributes()) {
  AgentsLiveActivity()
} contentStates: {
  AgentsActivityAttributes.ContentState.working
  AgentsActivityAttributes.ContentState.waitingOnYou
  AgentsActivityAttributes.ContentState.longRunning
  AgentsActivityAttributes.ContentState.done
}

#Preview("Compact", as: .dynamicIsland(.compact), using: AgentsActivityAttributes()) {
  AgentsLiveActivity()
} contentStates: {
  AgentsActivityAttributes.ContentState.working
  AgentsActivityAttributes.ContentState.waitingOnYou
  AgentsActivityAttributes.ContentState.longRunning
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
  AgentsActivityAttributes.ContentState.longRunning
  AgentsActivityAttributes.ContentState.done
}
