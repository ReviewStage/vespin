/**
 * agent-talk.tsx -- an agent's box taking calls: Talk at rest, and on a call into the agent the call's row in the microphone's place.
 *
 * One call stands in a window at a time (`../voice-call.tsx`). At rest the
 * box offers Talk, the waveform beside Dictate, which calls the agent; with
 * no OpenAI API key saved it says to add one and its press opens Settings ›
 * Agents (`../openai-key.tsx`), as Dictate's does. Talk into this agent
 * while a call into another stands asks first, since the other call ends.
 * On a call into this agent the same place holds the call's row (its
 * status, the speaker and microphone mutes, and End call), and Dictate
 * goes, since the call holds the microphone; a dictation under way as the
 * call starts ends, keeping the words already said. The field stays the
 * agent's as ever, so a typed line goes to the agent as any line does. A
 * narrow box folds Talk into its ⋯ as it folds Dictate; the call's row
 * stays, its status giving way first (`CallComposerControls`). Nothing of
 * it stands while the Voice experiment is off, nor in any box but an
 * agent's own tab's.
 */

import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { EXPERIMENT } from "@repo/settings";
import {
  CALL_STAGE,
  CallComposerControls,
  type CallLiveProps,
  CONFIRM_LOSS,
  ConfirmDialog,
  TALK_LABEL,
  TalkButton,
  useConfirmDialog,
  WaveformIcon,
} from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { confirmFailure } from "../failure-report.js";
import { useOpenAiKeyMissing } from "../openai-key.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { useVoiceCall, VOICE_CALL_STAGE, type VoiceCallState } from "../voice-call.js";
import { OVERFLOW_PRESS, type OverflowOffer } from "./message-box.js";
import type { DictationControl } from "./use-dictation.js";

/** What Talk asks while a call into another agent stands. */
const SWITCH_QUESTION = {
  title: "End your other call?",
  body: "You are on a call with another agent. Talking to this one ends that call.",
  verb: "End and talk",
  running: "Ending the other call",
} as const;

/** The agent a box's Talk calls, and the task it works on. */
export interface TalkInto {
  readonly agentId: string;
  readonly taskId: string;
}

/** What a box draws of calls: whether a call into its agent holds the microphone, what stands beside Dictate, and Talk's row in its ⋯. */
export interface AgentTalk {
  readonly onCall: boolean;
  readonly press: ReactNode;
  readonly offer: OverflowOffer | undefined;
}

/** A call's status as the composer's row draws it: coming up until the session started, and the count from then. */
function liveOf(call: VoiceCallState): CallLiveProps {
  if (call.stage === VOICE_CALL_STAGE.ENDING) return { stage: CALL_STAGE.ENDING };

  if (call.stage === VOICE_CALL_STAGE.CONNECTING || call.startedAt === undefined) {
    return { stage: CALL_STAGE.CONNECTING };
  }

  return { stage: CALL_STAGE.LIVE, startedAt: call.startedAt, muted: call.microphoneMuted };
}

/**
 * The box's calls into the agent `into` names, as above; none while the
 * Voice experiment is off or the box calls no agent. A press ends the box's
 * dictation first, keeping its words where any were recorded.
 */
export function useAgentTalk(
  into: TalkInto | undefined,
  dictation: DictationControl,
): AgentTalk | undefined {
  const on = useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.VOICE) }).data;
  const voice = useVoiceCall();
  const keyMissing = useOpenAiKeyMissing();
  const { call } = voice;

  const start = () => {
    if (into === undefined) return;

    if (dictation.startedAt !== undefined) dictation.finish();
    else dictation.cancel();
    voice.start(into);
  };

  const switching = useConfirmDialog(
    { subject: call !== undefined, surfaceOpen: true },
    neverBusyAct(start),
    confirmFailure(FAILURE_SURFACE.VOICE_CALL),
  );

  if (on !== true || into === undefined) return undefined;

  // Note that a key missing is the call's own to answer, which opens Settings › Agents, so it never asks to end another call first.
  const talk = () => {
    if (keyMissing || call === undefined || call.agentId === into.agentId) return start();
    switching.ask();
  };

  if (call !== undefined && call.agentId === into.agentId) {
    return {
      onCall: true,
      press: (
        <CallComposerControls
          live={liveOf(call)}
          microphone={{
            muted: call.microphoneMuted,
            onPress: () => voice.setMicrophoneMuted(!call.microphoneMuted),
          }}
          speaker={{
            muted: call.speakerMuted,
            onPress: () => voice.setSpeakerMuted(!call.speakerMuted),
          }}
          onEnd={voice.end}
        />
      ),
      offer: undefined,
    };
  }

  return {
    onCall: false,
    press: (
      <>
        {/* Note that the box is what a narrow card's stylesheet hides and its ⋯ reads. */}
        <span className={`${OVERFLOW_PRESS.TALK} flex`}>
          <TalkButton keyMissing={keyMissing} onPress={talk} />
        </span>
        <ConfirmDialog
          open
          confirm={switching}
          question={{ ...SWITCH_QUESTION, loss: CONFIRM_LOSS.IRREVERSIBLE, replayUnmasked: true }}
        />
      </>
    ),
    offer: {
      press: OVERFLOW_PRESS.TALK,
      entries: [
        {
          label: keyMissing ? TALK_LABEL.KEY_MISSING : TALK_LABEL.TALK,
          icon: <WaveformIcon />,
          onSelect: talk,
        },
      ],
    },
  };
}
