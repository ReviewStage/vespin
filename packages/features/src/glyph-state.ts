/**
 * glyph-state.ts -- where a piece of work stands as its glyph wears it, and the one word a reader is told of it: working, failed, or at rest, a stop told apart from a finish, read for an agent off its status.
 *
 * Every surface that draws an agent's or a worker's glyph reads it here,
 * the panel's tabs and cards (`state-glyph.tsx`) and the iPhone's agent
 * page alike, so a status is never worded twice.
 */

import { AGENT_STATUS, type AgentStatus } from "./agent-wire.js";
import { agentStillWriting } from "./task-agents-model.js";

export const GLYPH_STATE = {
  WORKING: "working",
  FAILED: "failed",
  REST: "rest",
} as const;

export type GlyphState = (typeof GLYPH_STATE)[keyof typeof GLYPH_STATE];

/** What a reader is told of each state, wherever an agent's or a task's working or failed mark is drawn or heard; nothing at rest. */
export const GLYPH_STATE_WORDS = {
  [GLYPH_STATE.WORKING]: "Working",
  [GLYPH_STATE.FAILED]: "Failed",
  [GLYPH_STATE.REST]: undefined,
} as const satisfies Record<GlyphState, string | undefined>;

/** What a piece of work at rest is called once it was stopped, which its glyph at rest does not tell from a finish. */
export const STOPPED_WORDS = "Stopped";

/** What a card or a tab says of where its work stands beyond its glyph: the state's own word, or Stopped for work at rest that was `stopped`. */
export function glyphStateWords(state: GlyphState, stopped: boolean): string | undefined {
  return state === GLYPH_STATE.REST && stopped ? STOPPED_WORDS : GLYPH_STATE_WORDS[state];
}

/** Where an agent stands as its tab's glyph wears it: working while it may still write, failed, or at rest. */
export function agentGlyphState(status: AgentStatus): GlyphState {
  if (agentStillWriting(status)) return GLYPH_STATE.WORKING;

  return status === AGENT_STATUS.FAILED ? GLYPH_STATE.FAILED : GLYPH_STATE.REST;
}

/** What an agent's tab says of where it stands beyond its glyph: a stop, which its glyph at rest does not tell from a finish. */
export function agentStateWords(status: AgentStatus): string | undefined {
  return glyphStateWords(agentGlyphState(status), status === AGENT_STATUS.CANCELED);
}
