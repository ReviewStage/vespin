// agent-queue-words.ts -- what an agent's queue says, worded once for the panel's queue dock and the iOS app's composer: its acts, why it stands paused, and what a change it took back says.

import { QUEUE_PAUSE, type QueuePaused } from "./agent-queue-wire.js";
import { type AgentQueueChange, QUEUE_CHANGE } from "./agent-wire.js";

/** What the queue over an agent's box says: its list, each message's acts, and why it stands paused. */
export const QUEUE_WORDS = {
  LIST: "Queued messages",
  STEER: "Steer",
  EDIT: "Edit",
  DELETE: "Delete",
  CANCEL: "Cancel",
  RESUME: "Resume",
  STOPPED: "Queue paused because you interrupted",
  TURN_FAILED: "Queue paused because the turn failed",
  REFUSED: "Queue paused: the next message could not be sent",
  BOOT_FAILED: "Queue paused until the machine starts",
  PAUSED: "Queue paused",
} as const;

/** What the toast says of a change the host drew and took back, by what it asked; a hold's refusal closes its edit, which says it. */
export const QUEUE_REFUSED_WORDS: Readonly<Partial<Record<AgentQueueChange["change"], string>>> = {
  [QUEUE_CHANGE.ADD]: "Could not queue the message.",
  [QUEUE_CHANGE.EDIT]: "Could not save the queued message.",
  [QUEUE_CHANGE.DELETE]: "Could not delete the queued message.",
  [QUEUE_CHANGE.STEER]: "Could not send the queued message.",
  [QUEUE_CHANGE.REORDER]: "Could not reorder the queue.",
  [QUEUE_CHANGE.RESUME]: "Could not resume the queue.",
};

/** What the toast says beneath them where the service said the message is no longer in the queue. */
export const QUEUE_LEFT_WORDS = "It already left the queue.";

/** Why a refused hand-off did not go, by the service's word for it, where the dock has words for it. */
const REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  ["agent-plan-limit-reached", "your plan's usage limit was reached"],
  ["agent-credential-missing", "the agent's credential is missing"],
  ["agent-retired", "the agent's session has ended"],
  ["not-permitted", "only the agent's starter can message it"],
  ["unavailable", "Could not reach the agent"],
]);

/** What the queue says over its messages while it stands paused, naming why where the service said and there are words for it. */
export function pausedWords(paused: QueuePaused): string {
  if (paused.because === QUEUE_PAUSE.STOPPED) return QUEUE_WORDS.STOPPED;

  if (paused.because === QUEUE_PAUSE.TURN_FAILED) return QUEUE_WORDS.TURN_FAILED;

  if (paused.because === QUEUE_PAUSE.BOOT_FAILED) return QUEUE_WORDS.BOOT_FAILED;
  const why = paused.refusal === undefined ? undefined : REFUSAL_WORDS.get(paused.refusal);

  return why === undefined ? QUEUE_WORDS.REFUSED : `${QUEUE_WORDS.PAUSED}: ${why}`;
}
