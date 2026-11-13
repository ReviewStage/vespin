/**
 * codex-goals.ts -- Codex's thread goal as a launch drives and reads it: each goal update app-server sends read as the move it made, if any; a `/goal` line is read by `@repo/wire`'s `goalAskOf`.
 *
 * Codex runs a goal itself: set active on an idle thread, app-server starts
 * a turn toward it, and at each turn's end goes on with another while the
 * goal stays active and within its budget, until the model marks it complete,
 * the budget runs out, or it is paused or cleared. App-server's TUI commands
 * are not read from a turn's words, so the launch asks for each with
 * `thread/goal/set` and `thread/goal/clear` (`codex.ts`). App-server sends
 * `thread/goal/updated` on every change, its token count among them, so only
 * a change of the goal itself or of its status is a move the transcript keeps.
 */

import { GOAL_EVENT, type GoalEvent } from "@repo/wire/ui-messages";
import { Schema } from "effect";
import type { ThreadGoal, ThreadGoalStatus } from "./codex-protocol/v2/index.js";
import { RUNNER_EVENT, type RunnerGoal } from "./protocol.js";

/** Codex's goal statuses, as app-server spells them. */
export const CODEX_GOAL_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
  BLOCKED: "blocked",
  USAGE_LIMITED: "usageLimited",
  BUDGET_LIMITED: "budgetLimited",
  COMPLETE: "complete",
} as const satisfies Record<string, ThreadGoalStatus>;

/** The longest objective app-server takes, which it refuses past (`MAX_THREAD_GOAL_OBJECTIVE_CHARS`), as Claude Code's `/goal` does. */
export const GOAL_OBJECTIVE_MAX = 4000;

/** The thread's goal as the launch reads it: what it is, where it stands, and what it spent. */
export type GoalSeen = Pick<
  ThreadGoal,
  "objective" | "status" | "tokensUsed" | "tokenBudget" | "updatedAt"
>;

const GoalSeenSchema = Schema.Struct({
  objective: Schema.String,
  status: Schema.Literals(Object.values(CODEX_GOAL_STATUS)),
  tokensUsed: Schema.Number,
  tokenBudget: Schema.NullOr(Schema.Number),
  updatedAt: Schema.Number,
});

/** App-server's answer to `thread/goal/get` and `thread/goal/set`: the goal as it now stands, none where the thread has none. */
export const decodeGoalAnswer = Schema.decodeUnknownOption(
  Schema.Struct({ goal: Schema.NullOr(GoalSeenSchema) }),
);

/** Whether Codex goes on with the goal by itself: it starts a turn toward it whenever the thread is idle. */
export function goalRuns(goal: GoalSeen | undefined): boolean {
  return goal?.status === CODEX_GOAL_STATUS.ACTIVE;
}

/** The statuses a goal ends at, which only a new ask sets going again. */
const SETTLED: ReadonlySet<ThreadGoalStatus> = new Set([
  CODEX_GOAL_STATUS.COMPLETE,
  CODEX_GOAL_STATUS.BLOCKED,
  CODEX_GOAL_STATUS.BUDGET_LIMITED,
]);

/** The move a status names, from the status the goal stood at before; none where it moved nothing the transcript keeps. */
function statusMove(
  before: ThreadGoalStatus | undefined,
  status: ThreadGoalStatus,
): GoalEvent | undefined {
  switch (status) {
    // Note that a goal set going again once it settled is set anew, since its end was already seen and let go.
    case CODEX_GOAL_STATUS.ACTIVE:
      return before === undefined || SETTLED.has(before) ? GOAL_EVENT.SET : GOAL_EVENT.RESUMED;
    // Note that a goal Codex holds for the plan's limit stands paused until it lifts, as one paused by hand does.
    case CODEX_GOAL_STATUS.PAUSED:
    case CODEX_GOAL_STATUS.USAGE_LIMITED:
      return GOAL_EVENT.PAUSED;
    case CODEX_GOAL_STATUS.BLOCKED:
      return GOAL_EVENT.IMPOSSIBLE;
    case CODEX_GOAL_STATUS.BUDGET_LIMITED:
      return GOAL_EVENT.BUDGET_LIMITED;
    case CODEX_GOAL_STATUS.COMPLETE:
      return GOAL_EVENT.MET;
  }
}

/** A move of the goal as the GOAL event says it, its counts as app-server last said them. */
function moveOf(event: GoalEvent, goal: GoalSeen): RunnerGoal {
  return {
    type: RUNNER_EVENT.GOAL,
    event,
    condition: goal.objective,
    reason: null,
    turns: null,
    tokens: goal.tokensUsed,
    tokenBudget: goal.tokenBudget,
  };
}

/** The GOAL events a goal update moves the transcript by, from the goal the launch last read; none where only its counts changed. */
export function goalMoves(before: GoalSeen | undefined, after: GoalSeen): readonly RunnerGoal[] {
  // Note that another objective is a new goal, whatever stood before it.
  const known = before !== undefined && before.objective === after.objective ? before : undefined;

  if (known !== undefined && known.status === after.status) return [];
  // A goal new to the launch is set first, then moved where it stands at anything but active.
  const set = known === undefined ? [moveOf(GOAL_EVENT.SET, after)] : [];
  const event = statusMove(known?.status, after.status);

  if (event === undefined) return set;

  return event === GOAL_EVENT.SET
    ? [moveOf(GOAL_EVENT.SET, after)]
    : [...set, moveOf(event, after)];
}

/**
 * Whether a goal update is app-server saying again, as it resumes a thread,
 * the goal the launch read as it opened the thread: the same goal at the
 * same moment of it. It may come after a line's own ask was answered, so it
 * is told by what it says rather than by when it comes.
 */
export function sameGoal(said: GoalSeen | undefined, read: GoalSeen | undefined): boolean {
  if (said === undefined || read === undefined) return said === read;

  return (
    said.objective === read.objective &&
    said.status === read.status &&
    said.updatedAt === read.updatedAt
  );
}

/**
 * Whether a goal update is newer than the goal the launch awaits app-server
 * saying again: the same goal, changed since. Note that app-server keeps
 * `updatedAt` in seconds, so an update of the same second is taken as one it
 * queued before, which only an update it sends ahead of the awaited one is.
 */
export function newerGoal(said: GoalSeen | undefined, awaited: GoalSeen | undefined): boolean {
  return (
    said !== undefined &&
    awaited !== undefined &&
    said.objective === awaited.objective &&
    said.updatedAt > awaited.updatedAt
  );
}

/** The GOAL event a cleared goal moves the transcript by; none where the launch knew of no goal. */
export function goalCleared(before: GoalSeen | undefined): RunnerGoal | undefined {
  return before === undefined ? undefined : moveOf(GOAL_EVENT.CLEARED, before);
}
