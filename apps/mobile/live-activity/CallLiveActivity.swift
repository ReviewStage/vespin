// CallLiveActivity.swift -- a voice call into an agent in the Dynamic Island and on the Lock Screen, while the call stands: the agent's name, how long the call has run, what the agent does, the two mutes, and End call.
//
// One activity stands for the call (`CallActivityAttributes`), apart from
// the agents' own (`AgentsLiveActivity.swift`): the phone starts it as Talk
// connects, sets it as the call changes, and ends it with the call, so
// nothing about it waits on the service. The compact presentation wears the
// call's waveform and its timer; the minimal one the waveform alone. The
// expanded one and the Lock Screen add the agent's name, its line, and the
// call's presses (`CallPressIntent`), drawn as the panel's call card draws
// them: each mute struck through while on, End call in the danger red. A
// tap anywhere else opens the call's agent. Every presentation has a
// preview at the end of the file.

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

struct CallLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: CallActivityAttributes.self) { context in
      CallContentView(agentId: context.attributes.agentId, state: context.state)
        .padding(14)
        .widgetURL(context.attributes.opens)
    } dynamicIsland: { context in
      let state = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          CallTitle(state: state).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          CallElapsed(state: state).padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          CallPresses(agentId: context.attributes.agentId, state: state)
        }
      } compactLeading: {
        Image("AudioLines").foregroundStyle(Color("Working"))
      } compactTrailing: {
        CallElapsed(state: state)
      } minimal: {
        Image("AudioLines").foregroundStyle(Color("Working"))
      }
      .widgetURL(context.attributes.opens)
      .keylineTint(Color("Working"))
    }
  }
}

/// The Lock Screen's call: the agent and its line beside the presses.
struct CallContentView: View {
  let agentId: String
  let state: CallActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 12) {
      CallTitle(state: state)
      Spacer(minLength: 8)
      CallPresses(agentId: context.attributes.agentId, state: state)
    }
  }
}

/// The agent's name over the call's line, in the words the app hands it.
struct CallTitle: View {
  let state: CallActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Label {
        Text(state.agentName).font(.subheadline.weight(.semibold)).lineLimit(1)
      } icon: {
        Image("AudioLines").foregroundStyle(Color("Working"))
      }
      Text(state.line)
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }
}

/// How long the call has run since its session started; an ellipsis while it connects.
struct CallElapsed: View {
  let state: CallActivityAttributes.ContentState

  var body: some View {
    if let start = state.start {
      Text(start, style: .timer)
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .frame(maxWidth: 56, alignment: .trailing)
        .foregroundStyle(Color("Working"))
    } else {
      Text("…").foregroundStyle(Color("Working"))
    }
  }
}

/// The call's presses in the panel's order: the speaker's mute, the microphone's, and End call.
struct CallPresses: View {
  /// The agent the activity shows, which every press names.
  let agentId: String
  let state: CallActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 10) {
      CallPressButton(
        intent: CallPressIntent(state.speakerMuted ? .unmuteSpeaker : .muteSpeaker, agentId: agentId),
        symbol: state.speakerMuted ? "VolumeOff" : "Volume2",
        label: state.speakerMuted ? "Unmute speaker" : "Mute speaker",
        lit: state.speakerMuted)
      CallPressButton(
        intent: CallPressIntent(
          state.microphoneMuted ? .unmuteMicrophone : .muteMicrophone, agentId: agentId),
        symbol: state.microphoneMuted ? "MicOff" : "Mic",
        label: state.microphoneMuted ? "Unmute microphone" : "Mute microphone",
        lit: state.microphoneMuted)
      Button(intent: CallPressIntent(.end, agentId: agentId)) {
        Image("PhoneOff")
          .foregroundStyle(.white)
          .frame(width: 36, height: 36)
          .background(Color("Danger"), in: Circle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("End call")
    }
  }
}

/// One mute: quiet while off, lit in gray while on, its glyph struck through, as the panel's mute stands.
struct CallPressButton: View {
  let intent: CallPressIntent
  let symbol: String
  let label: String
  let lit: Bool

  var body: some View {
    Button(intent: intent) {
      Image(symbol)
        .frame(width: 36, height: 36)
        .background(
          lit ? HierarchicalShapeStyle.tertiary : HierarchicalShapeStyle.quaternary, in: Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}

// MARK: - The state as drawn

extension CallActivityAttributes {
  /// The call's agent's page in the app.
  var opens: URL { AgentsActivityAttributes.ContentState.route(agent: agentId) }
}

// MARK: - Previews

extension CallActivityAttributes {
  fileprivate static let preview = Self(agentId: "a1")
}

extension CallActivityAttributes.ContentState {
  fileprivate static let connecting = Self(
    agentName: "Fix the token refresh", stage: "connecting", startedAt: nil, line: "Connecting…",
    microphoneMuted: false, speakerMuted: false)
  fileprivate static let working = Self(
    agentName: "Fix the token refresh", stage: "live", startedAt: Date.now.addingTimeInterval(-94).timeIntervalSince1970 * 1000,
    line: "Working · pnpm test", microphoneMuted: false, speakerMuted: false)
  fileprivate static let muted = Self(
    agentName: "Fix the token refresh", stage: "live", startedAt: Date.now.addingTimeInterval(-312).timeIntervalSince1970 * 1000,
    line: "On call", microphoneMuted: true, speakerMuted: false)
}

#Preview("Call · Lock Screen", as: .content, using: CallActivityAttributes.preview) {
  CallLiveActivity()
} contentStates: {
  CallActivityAttributes.ContentState.working
  CallActivityAttributes.ContentState.muted
  CallActivityAttributes.ContentState.connecting
}

#Preview("Call · Compact", as: .dynamicIsland(.compact), using: CallActivityAttributes.preview) {
  CallLiveActivity()
} contentStates: {
  CallActivityAttributes.ContentState.working
}

#Preview("Call · Minimal", as: .dynamicIsland(.minimal), using: CallActivityAttributes.preview) {
  CallLiveActivity()
} contentStates: {
  CallActivityAttributes.ContentState.working
}

#Preview("Call · Expanded", as: .dynamicIsland(.expanded), using: CallActivityAttributes.preview) {
  CallLiveActivity()
} contentStates: {
  CallActivityAttributes.ContentState.working
  CallActivityAttributes.ContentState.muted
}
