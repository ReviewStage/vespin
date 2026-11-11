/**
 * What a turn row says about the run it records: what opened it and where it
 * stands. Every trigger the brain answers to is a queued turn — a developer's
 * typed or spoken ask, an observed transcript's change, a child's completion —
 * and the origin is the record of which, so a view can mark an action the brain
 * took on its own judgment apart from one the developer asked for. Declared
 * here so the store that writes the row, the service that answers it, and the
 * clients that fold a turn by it all spell the same words.
 */

export const TURN_ORIGIN = {
  TYPED: "typed",
  SPOKEN: "spoken",
  TRANSCRIPT_CHANGE: "transcript_change",
  /** A child run's own turn, opened by the task it was delegated. */
  CHILD: "child",
  /**
   * The requester's turn, opened because a child it delegated to finished.
   * Kept apart from `child` because the two record different judgments: the
   * child's turn is the child's, this one is the parent's, and a reader
   * tracing why the brain spoke should not have to infer which from the
   * conversation's kind.
   */
  CHILD_COMPLETION: "child_completion",
} as const;

export type TurnOrigin = (typeof TURN_ORIGIN)[keyof typeof TURN_ORIGIN];

export const TURN_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  SETTLED: "settled",
  /** Its value keeps the British spelling rows and clients already hold. */
  CANCELED: "cancelled",
  FAILED: "failed",
} as const;

export type TurnStatus = (typeof TURN_STATUS)[keyof typeof TURN_STATUS];

/** The statuses of a turn still open: queued for its runner, or running. */
export const TURN_OPEN = [TURN_STATUS.QUEUED, TURN_STATUS.RUNNING] as const;

export type TurnOpenStatus = (typeof TURN_OPEN)[number];

/** The statuses a turn ends in, from which it never moves again but by a rewind. */
export const TURN_TERMINAL = [
  TURN_STATUS.SETTLED,
  TURN_STATUS.CANCELED,
  TURN_STATUS.FAILED,
] as const;

export type TurnTerminalStatus = (typeof TURN_TERMINAL)[number];
