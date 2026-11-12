/**
 * agent-goal-model.ts -- a coding agent's goal as its transcript says it stands: the condition the agent works toward, how far it has run, and whether it holds, read from the goal notices its turns keep (`@repo/wire/ui-messages`'s `GOAL_PART`).
 *
 * The harness keeps the goal (Claude Code's `/goal`, Codex's thread goal);
 * the transcript keeps each move of it where it happened, so the goal is
 * read back from those moves in order rather than held anywhere of the
 * service's own. A verdict whose condition is no goal set is a project's own
 * blocking Stop hook, which Claude Code says in the same shape, and moves
 * nothing. A goal that settled stands until the developer writes again, so
 * its end is seen and then makes way; a cleared one stands nowhere.
 * Nothing here draws.
 */

import { MESSAGE_ROLE } from "@repo/wire";
import { GOAL_EVENT, type GoalNotice } from "@repo/wire/ui-messages";
import { AGENT_PART, agentPart } from "./agent-parts.js";
import { AGENT_SENDER, type AgentTranscriptMessage } from "./agent-wire.js";

/** Where a goal stands. */
export const AGENT_GOAL_STATE = {
  /** The agent works toward it, or will on its next turn. */
  ACTIVE: "active",
  /** It was paused, and the agent takes no turn toward it until it is resumed. */
  PAUSED: "paused",
  MET: "met",
  /** The checker judged it can never hold. */
  IMPOSSIBLE: "impossible",
  /** It spent its token budget, and the agent wrapped up. */
  BUDGET_LIMITED: "budget_limited",
} as const;
export type AgentGoalState = (typeof AGENT_GOAL_STATE)[keyof typeof AGENT_GOAL_STATE];

/** The agent's goal as its transcript says it stands. */
export interface AgentGoal {
  readonly condition: string;
  readonly state: AgentGoalState;
  /** Epoch milliseconds the turn it was set in began; none where the transcript does not say. */
  readonly setAt: number | undefined;
  /** The turns it has run: the harness's count where it said one, else the checker's verdicts so far and the turn under way. */
  readonly turns: number;
  /** The tokens it has spent and its budget, where the harness counts them (Codex); null where it does not. */
  readonly tokens: number | null;
  readonly tokenBudget: number | null;
  /** The checker's newest reason; null before it gave one. */
  readonly reason: string | null;
  /** The message that holds its newest notice, which the transcript is taken to. */
  readonly messageId: string;
}

/** Whether a goal is settled for good, met or not: it moves no more. */
export function goalSettled(goal: AgentGoal): boolean {
  return (
    goal.state === AGENT_GOAL_STATE.MET ||
    goal.state === AGENT_GOAL_STATE.IMPOSSIBLE ||
    goal.state === AGENT_GOAL_STATE.BUDGET_LIMITED
  );
}

/** The state a settling notice leaves the goal in; none for a notice that settles nothing. */
function settledState(event: GoalNotice["event"]): AgentGoalState | undefined {
  switch (event) {
    case GOAL_EVENT.MET:
      return AGENT_GOAL_STATE.MET;
    case GOAL_EVENT.IMPOSSIBLE:
      return AGENT_GOAL_STATE.IMPOSSIBLE;
    case GOAL_EVENT.BUDGET_LIMITED:
      return AGENT_GOAL_STATE.BUDGET_LIMITED;
    default:
      return undefined;
  }
}

/** The words that part a Stop hook's prompt from its reason in Claude Code's feedback (`claude-code-moments.ts`), which the service split at the first of them. */
const FEEDBACK_SPLIT = "]: ";

/**
 * The notice as a move of the goal whose condition is given, or none where
 * it is another's. Note that a verdict of a condition holding the words that
 * part it from its reason was split inside the condition, since the service
 * reads no goal; its condition and reason are joined again and split after
 * the goal's own.
 */
function ofGoal(notice: GoalNotice, condition: string): GoalNotice | undefined {
  if (notice.condition === condition) return notice;
  if (notice.event !== GOAL_EVENT.NOT_MET || notice.reason === null) return undefined;
  const said = `${notice.condition}${FEEDBACK_SPLIT}${notice.reason}`;
  const head = `${condition}${FEEDBACK_SPLIT}`;
  return said.startsWith(head)
    ? { ...notice, condition, reason: said.slice(head.length) }
    : undefined;
}

/** Whether a line is the developer's own, rather than one the app, an automation, or GitHub sent, as a wakeup or a check's word is. */
function developersLine(message: AgentTranscriptMessage): boolean {
  const kind = message.sentBy?.kind;
  return kind === undefined || kind === AGENT_SENDER.MEMBER || kind === AGENT_SENDER.FORMER;
}

/** The goal after one more of its notices, in `message`; none where the notice cleared it. */
function moved(
  goal: AgentGoal | undefined,
  notice: GoalNotice,
  message: AgentTranscriptMessage,
): AgentGoal | undefined {
  const counted = {
    ...(notice.tokens === null ? undefined : { tokens: notice.tokens }),
    ...(notice.tokenBudget === null ? undefined : { tokenBudget: notice.tokenBudget }),
  };
  if (notice.event === GOAL_EVENT.SET) {
    return {
      condition: notice.condition,
      state: AGENT_GOAL_STATE.ACTIVE,
      setAt: message.startedAt ?? message.sentAt,
      turns: notice.turns ?? 1,
      tokens: null,
      tokenBudget: null,
      reason: null,
      messageId: message.id,
      ...counted,
    };
  }
  if (goal === undefined) return goal;
  const own = ofGoal(notice, goal.condition);
  // A move of another goal than the one standing is a project's own hook or a goal long gone.
  if (own === undefined) return goal;
  if (own.event === GOAL_EVENT.CLEARED) return undefined;
  const at = { ...goal, ...counted, messageId: message.id };
  switch (own.event) {
    case GOAL_EVENT.NOT_MET:
      return { ...at, turns: own.turns ?? goal.turns + 1, reason: own.reason };
    case GOAL_EVENT.PAUSED:
      return { ...at, state: AGENT_GOAL_STATE.PAUSED };
    case GOAL_EVENT.RESUMED:
      return { ...at, state: AGENT_GOAL_STATE.ACTIVE };
    default:
      return {
        ...at,
        state: settledState(own.event) ?? goal.state,
        turns: own.turns ?? goal.turns,
        reason: own.reason ?? goal.reason,
      };
  }
}

/** The agent's goal as its transcript's notices leave it; none where it set none, cleared it, or wrote again after it settled. */
export function agentGoal(messages: readonly AgentTranscriptMessage[]): AgentGoal | undefined {
  let goal: AgentGoal | undefined;
  for (const message of messages) {
    // A line the developer wrote once the goal settled lets it go: its end was seen, and the conversation moved on.
    if (message.role === MESSAGE_ROLE.USER) {
      if (goal !== undefined && goalSettled(goal) && developersLine(message)) goal = undefined;
      continue;
    }
    for (const stored of message.parts) {
      const part = agentPart(stored);
      if (part.kind === AGENT_PART.GOAL) goal = moved(goal, part.notice, message);
    }
  }
  return goal;
}
