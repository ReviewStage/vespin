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
 * own tab's and a box that starts a new agent.
 *
 * A box that starts a new agent, New task's and a draft agent's, offers
 * Talk the same way, which starts the agent blank, handed nothing, on the
 * box's choices, and calls it once it lands (`NewAgentTalk`), so the
 * caller's first words are its first message (Dean, Nov 17). With no key
 * saved it starts nothing and opens Settings › Agents; while that start is
 * out, Talk stands disabled. A call that ends with nobody having spoken to
 * the agent lets it go (`endVoiceCall`).
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
import { useOpenAiKeyMissing, useOpenApiKeys } from "../openai-key.js";
import { type CallWhenStarted, useVoiceCall } from "../voice-call.js";
import type { DictationControl } from "./use-dictation.js";

/** What Talk asks while a call into another agent stands. */
const SWITCH_QUESTION = {
  title: "End your other call?",
  body: "You are on a call with another agent. Talking to this one ends that call.",
  verb: "End and talk",
  running: "Ending the other call",
} as const;

/** The agent a box's Talk calls, and the task it works on, null for an agent on no task. */
export interface TalkInto {
  readonly agentId: string;
  readonly taskId: string | null;
}

/** A box that starts a new agent: its blank start, which calls `call` once the agent lands, or with nothing where it was refused, and whether one is out. */
export interface NewAgentTalk {
  readonly start: (call: CallWhenStarted) => void;
  readonly starting: boolean;
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
  into: TalkInto | NewAgentTalk | undefined,
  dictation: DictationControl,
): AgentTalk | undefined {
  const voice = useVoiceCall();
  const keyMissing = useOpenAiKeyMissing();
  const openApiKeys = useOpenApiKeys();
  const { call } = voice;

  const start = () => {
    if (into === undefined) return;

    if (dictation.startedAt !== undefined) dictation.finish();
    else dictation.cancel();

    if (!("start" in into)) return voice.start(into);

    // Note that a new agent is started only where a call can open on it, so no key saved starts nothing.
    if (keyMissing) return openApiKeys();
    into.start(voice.startWhenStarted());
  };

  const switching = useConfirmDialog(
    { subject: call !== undefined, surfaceOpen: true },
    neverBusyAct(start),
    confirmFailure(FAILURE_SURFACE.VOICE_CALL),
  );

  if (into === undefined) return undefined;

  // Note that a key missing is the call's own to answer, which opens Settings › Agents, so it never asks to end another call first.
  const agentId = "start" in into ? undefined : into.agentId;

  const talk = () => {
    if (keyMissing || call === undefined || call.agentId === agentId) return start();
    switching.ask();
  };

  if (call !== undefined && call.agentId === agentId) {
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
    talk: { keyMissing, disabled: "start" in into && into.starting, onPress: talk },
  };
}
