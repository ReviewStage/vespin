/**
 * week-pace.ts -- a plan's pace through its weekly usage window: whether, at the rate it has used the week so far, it runs out before the reset, leaves much of the week unused, or lands about on it.
 *
 * The pace is a straight line from the week's start, when the window stood
 * empty, through the one reading the plan last heard, carried on to the
 * reset: the rate the week has been used at so far is the rate it is read
 * to go on at. Note that it is read from the reading's own time, never the
 * clock's, because a reading heard days ago says nothing of the days since,
 * and reading those days as idle would read every quiet plan as unused.
 *
 * Too early in the week, a few hours' use says too little of the week to
 * forecast, so no pace is read until `PACE_FROM_MS` of it has passed.
 */

import type { WeeklyPlanUsage } from "@repo/features/provider-key-wire";

const HOUR_MS = 60 * 60 * 1000;

/** How long a weekly window runs. */
const WEEK_MS = 7 * 24 * HOUR_MS;

/** How much of the week must have passed at the reading before a pace is read from it. */
const PACE_FROM_MS = 12 * HOUR_MS;

/** The share of the week, in percent, a pace must leave unused to say so. */
const UNUSED_FROM_PERCENT = 20;

/** The whole window, in percent. */
const WHOLE_PERCENT = 100;

/** What a pace says of the week. */
export const WEEK_PACE = {
  /** It runs out before the reset. */
  RUNS_OUT: "runs_out",
  /** It leaves at least `UNUSED_FROM_PERCENT` of the week unused. */
  UNUSED: "unused",
  /** It lands about on the whole week. */
  ON_TRACK: "on_track",
} as const;

export type WeekPaceKind = (typeof WEEK_PACE)[keyof typeof WEEK_PACE];

/** The week a pace is read in: when it started, when it was read, how much was used then, and when it resets, in epoch milliseconds and percent. */
interface PaceWeek {
  readonly startsAt: number;
  readonly readAt: number;
  readonly usedPercent: number;
  readonly resetsAt: number;
}

/** A plan's pace through its week. */
export type WeekPace = PaceWeek &
  (
    | {
        readonly kind: typeof WEEK_PACE.RUNS_OUT;
        /** When the pace reaches the whole week; at or before the reading for a week already spent. */
        readonly runsOutAt: number;
      }
    | {
        readonly kind: typeof WEEK_PACE.UNUSED | typeof WEEK_PACE.ON_TRACK;
        /** How much of the week the pace has used by the reset, in percent. */
        readonly projectedPercent: number;
      }
  );

/**
 * The plan's pace through its week, as its last weekly reading says it;
 * none where the reading was heard too early in the week to say.
 */
export function weekPace(usage: WeeklyPlanUsage): WeekPace | undefined {
  const { usedPercent, readAt, resetsAt } = usage;
  const startsAt = resetsAt - WEEK_MS;
  const elapsed = readAt - startsAt;
  if (elapsed < PACE_FROM_MS) return undefined;
  const week = { startsAt, readAt, usedPercent, resetsAt };
  const projectedPercent = (usedPercent * WEEK_MS) / elapsed;
  if (projectedPercent > WHOLE_PERCENT) {
    return {
      ...week,
      kind: WEEK_PACE.RUNS_OUT,
      runsOutAt: startsAt + (elapsed * WHOLE_PERCENT) / usedPercent,
    };
  }
  const kind =
    WHOLE_PERCENT - projectedPercent >= UNUSED_FROM_PERCENT ? WEEK_PACE.UNUSED : WEEK_PACE.ON_TRACK;
  return { ...week, kind, projectedPercent };
}

/** Where the pace's dashed line ends: at the whole week when it runs out, else at the reset, at what it has used by then. */
export function paceEnd(pace: WeekPace): { readonly at: number; readonly percent: number } {
  if (pace.kind === WEEK_PACE.RUNS_OUT) {
    return { at: Math.max(pace.runsOutAt, pace.readAt), percent: WHOLE_PERCENT };
  }
  return { at: pace.resetsAt, percent: pace.projectedPercent };
}
