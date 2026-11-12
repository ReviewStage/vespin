/** goal.ts -- the durable notice a native agent's goal leaves where it moved: set, judged not yet met, met, judged impossible, paused, resumed, stopped at its budget, or cleared. */
import { Schema } from "effect";

export const GOAL_PART = "data-goal";

/** How a goal moved, as its harness said it (Claude Code's `/goal`, Codex's `thread/goal/*`). */
export const GOAL_EVENT = {
  /** A goal was set, its condition the directive the agent now works toward. */
  SET: "set",
  /** A turn ended and the goal does not hold yet; the reason is the checker's, which steers the next turn. */
  NOT_MET: "not_met",
  /** The goal holds, and is settled. */
  MET: "met",
  /** The checker judged the goal can never hold, and it is settled. */
  IMPOSSIBLE: "impossible",
  /** The goal was paused: the agent takes no turn toward it until it is resumed. */
  PAUSED: "paused",
  /** A paused goal was resumed. */
  RESUMED: "resumed",
  /** The goal spent its token budget, and the agent wrapped up rather than go on. */
  BUDGET_LIMITED: "budget_limited",
  /** The goal was cleared before it settled. */
  CLEARED: "cleared",
} as const;
export type GoalEvent = (typeof GOAL_EVENT)[keyof typeof GOAL_EVENT];

export const GoalNoticeSchema = Schema.Struct({
  event: Schema.Literals(Object.values(GOAL_EVENT)),
  /** The goal's condition as it was set, whole. */
  condition: Schema.String,
  /** What the harness said of it: the checker's reason on a verdict; null where it said none. */
  reason: Schema.NullOr(Schema.String),
  /** The turns the goal has run, where the harness counted them; null where it did not say. */
  turns: Schema.NullOr(Schema.Number),
  /** The tokens the goal has spent, where the harness counted them; null where it did not say. */
  tokens: Schema.NullOr(Schema.Number),
  /** The goal's token budget, where it has one; null where it has none or the harness did not say. */
  tokenBudget: Schema.NullOr(Schema.Number),
});
export type GoalNotice = typeof GoalNoticeSchema.Type;
