/**
 * agent-talk.tsx -- an agent's box taking calls: Talk in Send's place at rest, and on a call into the agent the call's presses in the microphone's place.
 *
 * One call stands in a window at a time (`../voice-call.tsx`). At rest the
 * box offers Talk, the waveform in Send's place while the box holds nothing
 * to send and no Stop stands, which calls the agent; the first word or file
 * turns it into Send, as ChatGPT's composer does (Dean, Nov 17). With no
 * OpenAI API key saved it says to add one and its press opens Settings ›
 * Agents (`../openai-key.tsx`), as Dictate's does. Talk into this agent
 * while a call into another stands asks first, since the other call ends.
 * On a call into this agent the microphone's place holds the call's presses
 * (the speaker and microphone mutes, and End call), with no status beside
 * them, since the row stays uncrowded (Dean, Nov 13), and Dictate goes,
 * since the call holds the microphone; a dictation under way as the call
 * starts ends, keeping the words already said. Send's place then holds Send
 * alone, since the call is already up. The field stays the agent's as ever,
 * so a typed line goes to the agent as any line does. Talk stands whole in
 * a narrow box, as Send does; the call's presses stay too
 * (`CallComposerControls`). Nothing of it stands in any box but an agent's
 * own tab's.
 */

import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  CallComposerControls,
  CONFIRM_LOSS,
  type ComposerTalk,
  ConfirmDialog,
  useConfirmDialog,
} from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import type { ReactNode } from "react";
import { confirmFailure } from "../failure-report.js";
import { useOpenAiKeyMissing } from "../openai-key.js";
import { useVoiceCall } from "../voice-call.js";
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

/** What a box draws of calls: whether a call into its agent holds the microphone, what stands in the microphone's place, and Talk for Send's place while no call into its agent stands. */
export interface AgentTalk {
  readonly onCall: boolean;
  readonly press: ReactNode;
  readonly talk: ComposerTalk | undefined;
}

/**
 * The box's calls into the agent `into` names, as above; none while the
 * box calls no agent. A press ends the box's
 * dictation first, keeping its words where any were recorded.
 */
export function useAgentTalk(
  into: TalkInto | undefined,
  dictation: DictationControl,
): AgentTalk | undefined {
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

  if (into === undefined) return undefined;

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
          microphone={{
            muted: call.microphoneMuted,
            onPress: () => voice.setMicrophoneMuted(!call.microphoneMuted),
          }}
          speaker={{
            muted: call.speakerMuted,
            onPress: () => voice.setSpeakerMuted(!call.speakerMuted),
          }}
          levels={voice.levels}
          onEnd={voice.end}
        />
      ),
      talk: undefined,
    };
  }

  // Note that the question stands apart from Talk, since Talk leaves Send's place as words come.
  return {
    onCall: false,
    press: (
      <ConfirmDialog
        open
        confirm={switching}
        question={{ ...SWITCH_QUESTION, loss: CONFIRM_LOSS.IRREVERSIBLE, replayUnmasked: true }}
      />
    ),
    talk: { keyMissing, onPress: talk },
  };
}
