/**
 * call-activity.ts -- the voice call's Live Activity, kept by the phone: started as a call connects, set as it changes, ended with it, and its presses handed back to the call.
 *
 * The activity is the phone's alone (`modules/live-activity/`'s
 * `CallActivityAttributes`), apart from the agents' activity the service
 * pushes, so a mute or End pressed on it acts at once. Its line is the call
 * card's (`callLineWords`), or that the call is on while the agent is idle.
 * Each call to the module waits on the last, since a state set before its
 * activity stood would set nothing. A call into another agent starts its
 * activity again, since its attributes name the agent and cannot change,
 * and a press names the agent its activity shows, so one pressed on the
 * last call's activity while the next one's starts is dropped rather than
 * acting on the new call.
 * One left standing from a launch that ended mid-call is ended as the app
 * starts, since no call outlives its launch. Where Live Activities are
 * turned off, or the build has no module, the call goes on without one.
 */

import type { CallAgentLine } from "@repo/features/call-agent-line";
import type { VoiceCallState } from "@repo/features/voice-call-session";
import { CALL_LIVE_WORD, callLineWords } from "@repo/features/voice-call-words";
import { useEffect, useRef } from "react";
import { liveActivityModule } from "./live-activity-module.js";

/** What a press on the activity sets, as `CallPressIntent.Press` names it in Swift. */
export const CALL_PRESS = {
  MUTE_MICROPHONE: "mute-microphone",
  UNMUTE_MICROPHONE: "unmute-microphone",
  MUTE_SPEAKER: "mute-speaker",
  UNMUTE_SPEAKER: "unmute-speaker",
  END: "end",
} as const;

/** The call as the activity draws it. */
interface ActivityCall extends VoiceCallState {
  readonly agentName: string;
  readonly agent: CallAgentLine | undefined;
}

/** What the activity's presses act on. */
interface ActivityPresses {
  readonly setMicrophoneMuted: (muted: boolean) => void;
  readonly setSpeakerMuted: (muted: boolean) => void;
  readonly end: () => void;
}

/** The activity's content state as JSON, key for key with `CallActivityAttributes.ContentState`. */
function contentStateOf(call: ActivityCall): string {
  return JSON.stringify({
    agentName: call.agentName,
    stage: call.stage,
    startedAt: call.startedAt ?? null,
    line: callLineWords(call.stage, call.agent) ?? CALL_LIVE_WORD.LIVE,
    microphoneMuted: call.microphoneMuted,
    speakerMuted: call.speakerMuted,
  });
}

type CallPress = (typeof CALL_PRESS)[keyof typeof CALL_PRESS];

/** What each press does to the call. */
const PRESSED: Record<CallPress, (presses: ActivityPresses) => void> = {
  [CALL_PRESS.MUTE_MICROPHONE]: (presses) => presses.setMicrophoneMuted(true),
  [CALL_PRESS.UNMUTE_MICROPHONE]: (presses) => presses.setMicrophoneMuted(false),
  [CALL_PRESS.MUTE_SPEAKER]: (presses) => presses.setSpeakerMuted(true),
  [CALL_PRESS.UNMUTE_SPEAKER]: (presses) => presses.setSpeakerMuted(false),
  [CALL_PRESS.END]: (presses) => presses.end(),
};

/** Whether the module's event names a press this build knows. */
function isCallPress(press: string): press is CallPress {
  return Object.hasOwn(PRESSED, press);
}

/**
 * Keeps the voice call's Live Activity with `call`, and hands its presses
 * to `presses`, which the call's session holds for the app's life.
 */
export function useCallLiveActivity(
  call: ActivityCall | undefined,
  presses: ActivityPresses,
): void {
  const agentId = call?.agentId;
  const state = call === undefined ? undefined : contentStateOf(call);
  // Note that the module's calls queue on one another, and the agent the activity stands for is kept beside them, both outside any render.
  const queue = useRef<Promise<void> | undefined>(undefined);
  const shownFor = useRef<string | undefined>(undefined);
  // Note that the press listener reads the call's agent through a ref, so it stays subscribed while the call changes.
  const callingAgent = useRef<string | undefined>(undefined);

  useEffect(() => {
    callingAgent.current = agentId;
  }, [agentId]);

  useEffect(() => {
    const module = liveActivityModule;

    if (module === null) return;

    const after = (next: () => Promise<void>) => {
      queue.current = (queue.current ?? module.endCall())
        .then(next)
        .catch((cause: unknown) =>
          console.warn("The call's Live Activity could not be set", cause),
        );
    };

    if (agentId === undefined || state === undefined) {
      if (shownFor.current === undefined) return;
      shownFor.current = undefined;

      return after(() => module.endCall());
    }

    if (shownFor.current === agentId) return after(() => module.updateCall(state));
    shownFor.current = agentId;
    after(() => module.startCall(JSON.stringify({ agentId }), state));
  }, [agentId, state]);

  useEffect(() => {
    if (liveActivityModule === null) return;

    // The activity left from a launch that ended mid-call goes as the app starts.
    queue.current ??= liveActivityModule.endCall().catch(() => undefined);

    const subscription = liveActivityModule.addListener("onCallPress", ({ press, agentId: of }) => {
      if (of === callingAgent.current && isCallPress(press)) PRESSED[press](presses);
    });

    return () => subscription.remove();
  }, [presses]);
}
