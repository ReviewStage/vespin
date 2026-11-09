import type { ModelUsage } from "@repo/runtime/vocabulary";

/**
 * A developer ask as the turn run owns it from acceptance to its end. The record
 * outlives the call that asked, the renderer that showed it, and the launch
 * that ran it: a submission is acknowledged only once its record is on disk,
 * a wait answers with the record as it stands rather than abandoning the run,
 * and a restart finds every unfinished record and marks it interrupted rather
 * than resuming an action it cannot know the state of.
 */

export const RUN_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  /** Its value keeps the British spelling rows and clients already hold. */
  CANCELED: "cancelled",
  TIMED_OUT: "timed_out",
  INTERRUPTED: "interrupted",
} as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

/**
 * Why a run ended without a reply, as a fixed word rather than a provider's
 * sentence: the host words each one for the thread, so no raw model or
 * network output reaches the developer's record.
 */
export const TURN_FAILURE = {
  /** The model did not answer, or answered nothing readable. */
  MODEL: "model",
  /** A checkpoint could not be written, so the run stopped before or after an action. */
  PERSISTENCE: "persistence",
  /** The run reached its execution deadline: a coding agent's turn ran past its cap (`@repo/features/turn-deadline`). */
  DEADLINE: "deadline",
  /** The model stopped before a reply formed: an incomplete output, or the tool budget spent. */
  INCOMPLETE: "incomplete",
  /**
   * The context had to be compacted before the run could be sent and the
   * compaction did not succeed. The conversation stands exactly as it was;
   * the ask can be made again once the model or the network is back.
   */
  COMPACTION: "compaction",
  /**
   * The run's end was never heard: the turn stood running past the abandon
   * bound and the scheduled sweep settled it, so its record says the run
   * was lost rather than that it is still going.
   */
  ABANDONED: "abandoned",
  /**
   * The run's session ended for good: its runtime refused a message to it as a
   * session it no longer runs, while its turn still stood running, so the
   * turn's end is never coming and its record says the session was lost.
   */
  SESSION_ENDED: "session_ended",
  /** The turn's line stood queued past its pickup deadline with no runner taking it (`@repo/features/turn-deadline`). */
  LINE_UNTAKEN: "line_untaken",
  /** The turn's runner still ran, but the turn made no progress before its progress deadline, so the runner was ended. */
  NO_PROGRESS: "no_progress",
  /** The turn's runner ended, or was replaced by a newer launch, before the turn did. */
  RUNNER_LOST: "runner_lost",
  /** The plan's usage limit cut the turn short, and no launch on the next payer, or past the limit's reset, took it up before its deadline. */
  PLAN_LIMIT: "plan_limit",
  /** The model refused to answer the turn's newest model turn, and no other model retried it. */
  REFUSAL: "refusal",
} as const;

export type TurnFailure = (typeof TURN_FAILURE)[keyof typeof TURN_FAILURE];

/**
 * What a run's inferences cost, summed over every answer the run was given
 * and split the four ways the provider counts: the input the model read, the
 * output it wrote, how much of the input its prefix cache answered, and how
 * much of the output was reasoning before the words. A count the provider
 * did not say adds nothing, so every field is a number from the first answer.
 * Beside them, how much of the input was written to the prefix cache, which
 * only some providers say, so it stands only once an answer has said it.
 */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  cacheWriteTokens?: number;
}

/** One model's share of a run's usage: the counts of every step that ran on it, under the catalog id the step ran under. */
export interface RunModelUsage extends RunUsage {
  readonly model: string;
}

/** One answer's counts added onto a run's so far (nothing, before its first answer), each missing count counting as nothing. */
export function addModelUsage(total: RunUsage | undefined, usage: ModelUsage): RunUsage {
  return {
    inputTokens: (total?.inputTokens ?? 0) + (usage.inputTokens ?? 0),
    outputTokens: (total?.outputTokens ?? 0) + (usage.outputTokens ?? 0),
    cachedInputTokens: (total?.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0),
    reasoningTokens: (total?.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
    ...(total?.cacheWriteTokens === undefined && usage.cacheWriteTokens === undefined
      ? undefined
      : { cacheWriteTokens: (total?.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0) }),
  };
}
