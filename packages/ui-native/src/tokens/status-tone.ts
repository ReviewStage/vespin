// status-tone.ts -- the six tones a status is drawn in, apart from the colors that ink them, so a model reads them without React Native.

/**
 * Where something stands, as its color says it: the same six tones
 * `@repo/ui`'s `status-tone.ts` names, so a task done reads in one green on
 * the Mac and the iPhone alike.
 */
export const STATUS_TONE = {
  /** At rest, or ended with nothing to say: backlog, todo, canceled. */
  NEUTRAL: "neutral",
  /** Still going, with nothing to do yet: a task in progress. */
  WORKING: "working",
  /** Needs a person: an ask waiting on you. */
  ATTENTION: "attention",
  /** Finished well: a task done, an agent finished. */
  COMPLETE: "complete",
  /** GitHub's shipped: a merged pull request. */
  MERGED: "merged",
  /** Failed, or can't go on. */
  DANGER: "danger",
} as const;

export type StatusTone = (typeof STATUS_TONE)[keyof typeof STATUS_TONE];
