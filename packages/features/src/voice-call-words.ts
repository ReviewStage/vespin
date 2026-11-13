/**
 * voice-call-words.ts -- what a voice call's presses and lines say, the same on every client: Talk, the mutes, End call, where the call stands, and what its agent does.
 */

import type { CallAgentLine } from "./call-agent-line.js";
import { VOICE_CALL_STAGE, type VoiceCallStage } from "./voice-wire.js";

/** Talk's name for a reader and its hover: what it does, or, with no OpenAI API key saved, what a call needs first. */
export const TALK_LABEL = {
  TALK: "Talk",
  KEY_MISSING: "Add an OpenAI API key",
} as const;

/** Each call control's name for a reader and its hover, by whether it is on. */
export const CALL_CONTROL_LABEL = {
  MUTE_MICROPHONE: "Mute microphone",
  UNMUTE_MICROPHONE: "Unmute microphone",
  MUTE_SPEAKER: "Mute speaker",
  UNMUTE_SPEAKER: "Unmute speaker",
  STOP_AGENT: "Stop",
  END_CALL: "End call",
} as const;

/** What a call's status says, as the call card's voice line draws it: coming up, live, muted, or on its way down. */
export const CALL_LIVE_WORD = {
  CONNECTING: "Connecting…",
  LIVE: "On call",
  MUTED: "Muted",
  ENDING: "Ending…",
} as const;

/** The agent's line's words, subject-free like the voice's: what it says with no command pending, and what leads the command it runs. */
export const CALL_AGENT_WORD = {
  THINKING: "Thinking",
  WORKING: "Working",
} as const;

/**
 * The call's line in words, as the call card's status line says it:
 * "Connecting…" or "Ending…" while the call is not up, and while it is, the
 * agent's line while it works, "Thinking", or "Working" and the command it
 * runs; nothing while the agent is idle.
 */
export function callLineWords(
  stage: VoiceCallStage,
  agent: CallAgentLine | undefined,
): string | undefined {
  if (stage === VOICE_CALL_STAGE.CONNECTING) return CALL_LIVE_WORD.CONNECTING;

  if (stage === VOICE_CALL_STAGE.ENDING) return CALL_LIVE_WORD.ENDING;

  if (agent === undefined) return undefined;

  return agent.action === undefined
    ? CALL_AGENT_WORD.THINKING
    : `${CALL_AGENT_WORD.WORKING} · ${agent.action}`;
}
