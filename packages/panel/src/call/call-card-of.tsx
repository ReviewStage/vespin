/**
 * call-card-of.tsx -- the call card's props, from the standing call as the document carries it and the presses its owner answers.
 *
 * The one reading of a standing call into `@repo/ui`'s `CallCard`, so the
 * card docked in a window and the card alone in the floating window are the
 * same card in every word: the agent's chip, its tile wearing the working
 * mark while the agent works, the task's name, the stage's word while the
 * call comes up or goes down, the agent's line while it works, and the mutes
 * as they stand, each press asking for the mute's other side.
 */

import { CALL_LIVE_WORD } from "@repo/features/voice-call-words";
import { type StandingCall, VOICE_CALL_STAGE } from "@repo/features/voice-wire";
import type { CallAgent, CallCard, CallStatus } from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE } from "@repo/ui/actor-model";
import type { ComponentProps } from "react";
import { ActorMark } from "../actor-ref.js";

/** What the card's presses ask of the call's owner. */
export interface CallCardPresses {
  readonly setMicrophoneMuted: (muted: boolean) => void;
  readonly setSpeakerMuted: (muted: boolean) => void;
  readonly stop: () => void;
  readonly end: () => void;
  /** Opens the call's agent. */
  readonly open: () => void;
}

/** The card's props, but where it is drawn. */
export type CallCardOf = Omit<ComponentProps<typeof CallCard>, "surface">;

/** The stage's word while the call comes up or goes down; none while it is up. */
function stageWord(call: StandingCall): string | undefined {
  if (call.stage === VOICE_CALL_STAGE.CONNECTING) return CALL_LIVE_WORD.CONNECTING;

  if (call.stage === VOICE_CALL_STAGE.ENDING) return CALL_LIVE_WORD.ENDING;

  return undefined;
}

/** The card's line: the stage's word, and the agent's line while it works. */
function statusOf(call: StandingCall): CallStatus {
  return {
    stageWord: stageWord(call),
    agent: call.agent === undefined ? undefined : { action: call.agent.action },
  };
}

/** The agent as its chip names it: its tile wearing the working mark while it works, as every place naming an agent draws it (`ActorRef`). */
function agentOf(call: StandingCall): CallAgent {
  const actor = {
    kind: ACTOR_KIND.AGENT,
    name: call.agentName,
    provider: call.provider,
    state: call.agent === undefined ? ACTOR_STATE.REST : ACTOR_STATE.WORKING,
  };

  return { name: call.agentName, tile: <ActorMark actor={actor} /> };
}

/** The card as drawn from the standing call and its owner's presses. */
export function callCardOf(call: StandingCall, presses: CallCardPresses): CallCardOf {
  return {
    agent: agentOf(call),
    taskName: call.taskName,
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
    onStop: presses.stop,
    onEnd: presses.end,
  };
}
