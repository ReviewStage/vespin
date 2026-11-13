/**
 * call-card-of.ts -- the call card's props, from the standing call as the document carries it and the presses its owner answers.
 *
 * The one reading of a standing call into `@repo/ui`'s `CallCard`, so the
 * card docked in a window and the card alone in the floating window are the
 * same card in every word: the call's name, the stage's word as the voice's
 * line, the agent's line while it works, and the mutes as they stand, each
 * press asking for the mute's other side.
 */

import { type StandingCall, VOICE_CALL_STAGE } from "@repo/features/voice-wire";
import { CALL_LIVE_WORD, type CallCard, type CallStatus } from "@repo/ui";
import type { ComponentProps } from "react";

/** What the card's presses ask of the call's owner. */
export interface CallCardPresses {
  readonly setMicrophoneMuted: (muted: boolean) => void;
  readonly setSpeakerMuted: (muted: boolean) => void;
  readonly end: () => void;
  /** Opens the call's agent. */
  readonly open: () => void;
}

/** The card's props, but where it is drawn. */
export type CallCardOf = Omit<ComponentProps<typeof CallCard>, "surface">;

/** The voice's line: the stage's own word, and while live, whether the microphone is muted. */
function voiceWord(call: StandingCall): string {
  if (call.stage === VOICE_CALL_STAGE.CONNECTING) return CALL_LIVE_WORD.CONNECTING;

  if (call.stage === VOICE_CALL_STAGE.ENDING) return CALL_LIVE_WORD.ENDING;

  return call.microphoneMuted ? CALL_LIVE_WORD.MUTED : CALL_LIVE_WORD.LIVE;
}

/** The card's status lines: the voice's word, and the agent's line while it works. */
function statusOf(call: StandingCall): CallStatus {
  return {
    voiceWord: voiceWord(call),
    agent: call.agent === undefined ? undefined : { action: call.agent.action },
  };
}

/** The card as drawn from the standing call and its owner's presses. */
export function callCardOf(call: StandingCall, presses: CallCardPresses): CallCardOf {
  return {
    name: call.name,
    status: statusOf(call),
    microphone: {
      muted: call.microphoneMuted,
      onPress: () => presses.setMicrophoneMuted(!call.microphoneMuted),
    },
    speaker: {
      muted: call.speakerMuted,
      onPress: () => presses.setSpeakerMuted(!call.speakerMuted),
    },
    onReturn: presses.open,
    onEnd: presses.end,
  };
}
