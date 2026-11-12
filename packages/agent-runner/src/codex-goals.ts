/**
 * codex-goals.ts -- Codex's thread goal as a launch drives and reads it: a `/goal` line read as the app-server request it asks for, and each goal update app-server sends read as the move it made, if any.
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

/** What a `/goal` line asks of the thread's goal. */
export const GOAL_ASK = {
  /** Set the goal to the objective, active: a new goal, or the one standing rewritten. */
  SET: "set",
  PAUSE: "pause",
  RESUME: "resume",
  CLEAR: "clear",
  /** Nothing to change: `/goal` alone, which asks where the goal stands, as the row already says. */
  NONE: "none",
} as const;

export type GoalAsk =
  | { readonly kind: typeof GOAL_ASK.SET; readonly objective: string }
  | {
      readonly kind:
        | typeof GOAL_ASK.PAUSE
        | typeof GOAL_ASK.RESUME
        | typeof GOAL_ASK.CLEAR
        | typeof GOAL_ASK.NONE;
    };

/** The words after `/goal` that clear the goal, as Codex's TUI and Claude Code's `/goal` both take them. */
const CLEAR_WORDS: ReadonlySet<string> = new Set([
  "clear",
  "stop",
  "off",
  "reset",
  "none",
  "cancel",
]);

/** The command a goal line opens with. */
const GOAL_COMMAND = /^\s*\/goal(?:\s+([\s\S]*))?$/;

/** What a goal line's words ask of the thread's goal. */
export function goalAskOf(text: string): GoalAsk {
  const words = (GOAL_COMMAND.exec(text)?.[1] ?? "").trim();
  const lowered = words.toLowerCase();

  if (words === "") return { kind: GOAL_ASK.NONE };

  if (lowered === GOAL_ASK.PAUSE) return { kind: GOAL_ASK.PAUSE };

  if (lowered === GOAL_ASK.RESUME) return { kind: GOAL_ASK.RESUME };

  if (CLEAR_WORDS.has(lowered)) return { kind: GOAL_ASK.CLEAR };

  return { kind: GOAL_ASK.SET, objective: words };
}

/** Whether Codex goes on with the goal by itself: it starts a turn toward it whenever the thread is idle. */
export function goalRuns(goal: ThreadGoal | undefined): boolean {
  return goal?.status === CODEX_GOAL_STATUS.ACTIVE;
}

/** The move a status names, from the status the goal stood at before; none where it moved nothing the transcript keeps. */
function statusMove(
  before: ThreadGoalStatus | undefined,
  status: ThreadGoalStatus,
): GoalEvent | undefined {
  switch (status) {
    case CODEX_GOAL_STATUS.ACTIVE:
      return before === undefined ? GOAL_EVENT.SET : GOAL_EVENT.RESUMED;
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
function moveOf(event: GoalEvent, goal: ThreadGoal): RunnerGoal {
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
export function goalMoves(
  before: ThreadGoal | undefined,
  after: ThreadGoal,
): readonly RunnerGoal[] {
  // Note that another objective is a new goal, whatever stood before it.
  const known = before !== undefined && before.objective === after.objective ? before : undefined;

  if (known !== undefined && known.status === after.status) return [];
  // A goal new to the launch is set first, then moved where it stands at anything but active.
  const set = known === undefined ? [moveOf(GOAL_EVENT.SET, after)] : [];
  const event = statusMove(known?.status, after.status);

  return event === undefined || event === GOAL_EVENT.SET ? set : [...set, moveOf(event, after)];
}

/** The GOAL event a cleared goal moves the transcript by; none where the launch knew of no goal. */
export function goalCleared(before: ThreadGoal | undefined): RunnerGoal | undefined {
  return before === undefined ? undefined : moveOf(GOAL_EVENT.CLEARED, before);
}
