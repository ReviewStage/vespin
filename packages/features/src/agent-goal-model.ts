/**
 * agent-goal-model.ts -- a coding agent's goal as its transcript says it stands: the condition the agent works toward, how far it has run, and whether it holds, read from the goal notices its turns keep (`@repo/wire/ui-messages`'s `GOAL_PART`).
 *
 * The harness keeps the goal (Claude Code's `/goal`, Codex's thread goal);
 * the transcript keeps each move of it where it happened, so the goal is
 * read back from those moves in order rather than held anywhere of the
 * service's own. A verdict whose condition is no goal set is a project's own
 * blocking Stop hook, which Claude Code says in the same shape, and moves
 * nothing; where older pages of the transcript stand unread, which may hold a
 * goal's setting, any other move of a goal stands for it. A goal that settled stands until the developer writes again, so
 * its end is seen and then makes way; a cleared one stands nowhere.
 *
 * A `/goal` line the developer sent moves the goal as it is shown at once,
 * ahead of the harness's own word of the move (`goalAsShown`): the line
 * still on its way, and the newest one the harness has not answered yet,
 * while the agent works on it or for `GOAL_ASK_WAIT_MS` after it went,
 * since a harness that refuses an ask says nothing of it.
 * Nothing here draws.
 */

import { MESSAGE_ROLE } from "@repo/wire";
import {
  GOAL_ASK,
  GOAL_EVENT,
  type GoalAsk,
  type GoalNotice,
  goalAskOf,
} from "@repo/wire/ui-messages";
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

/**
 * How long a goal line the agent is not at work on moves the goal as shown
 * before the harness answers it: both harnesses answer an ask they take at
 * once, so one this old went unanswered and was refused.
 */
export const GOAL_ASK_WAIT_MS = 30_000;

/** A `/goal` line the developer sent, as what it asks of the goal. */
export interface GoalAsked {
  readonly ask: GoalAsk;
  /** The line's id, which a goal it sets is taken to hold until the harness says it. */
  readonly messageId: string;
  /** Epoch milliseconds it was sent; none where the transcript does not say. */
  readonly sentAt: number | undefined;
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

/** The steps of its turn a line arrived after, as the transcript draws it (`agent-parts.ts`); none for a line no turn took in under way. */
function afterStepOf(line: AgentTranscriptMessage): number {
  return line.arrivedIn?.afterStep ?? 0;
}

/**
 * The goal a notice of it says stands, where the transcript read holds no
 * setting of it: older pages, unread, hold that. Note that a verdict that the
 * goal is not met yet takes none up, because a project's own blocking Stop
 * hook says its feedback in the same shape; every other move is said by the
 * harness's goal itself (Claude Code's transcript, Codex's thread goal).
 */
function takenUp(notice: GoalNotice, message: AgentTranscriptMessage): AgentGoal | undefined {
  if (notice.event === GOAL_EVENT.CLEARED || notice.event === GOAL_EVENT.NOT_MET) return undefined;

  const standing: AgentGoal = {
    condition: notice.condition,
    state: AGENT_GOAL_STATE.ACTIVE,
    setAt: undefined,
    turns: 0,
    tokens: null,
    tokenBudget: null,
    reason: null,
    messageId: message.id,
  };

  return moved(standing, notice, message);
}

/** The words of a line, its text parts one after another. */
function lineText(message: AgentTranscriptMessage): string {
  return message.parts
    .flatMap((stored) => {
      const part = agentPart(stored);

      return part.kind === AGENT_PART.TEXT ? [part.text] : [];
    })
    .join("\n");
}

/** The asks that only move the goal standing, which its row's acts send and its own trail records, so the line that asks one is no message to draw. */
const CONTROLS: ReadonlySet<GoalAsk["kind"]> = new Set([
  GOAL_ASK.PAUSE,
  GOAL_ASK.RESUME,
  GOAL_ASK.CLEAR,
]);

/** Whether words are a `/goal` line that pauses, resumes, or clears the goal, rather than one that sets it or asks where it stands. */
export function goalControlWords(text: string): boolean {
  const ask = goalAskOf(text);

  return ask !== undefined && CONTROLS.has(ask.kind);
}

/** Whether a line is the developer's own `/goal` pause, resume, or clear: the goal's trail says where it moved, so the transcript draws no message for it. */
export function goalControlLine(message: AgentTranscriptMessage): boolean {
  return (
    message.role === MESSAGE_ROLE.USER &&
    developersLine(message) &&
    goalControlWords(lineText(message))
  );
}

/** The goal as it reads once a line asks a move of it, ahead of the harness's word: none where it asks the goal cleared. */
export function goalAsked(goal: AgentGoal | undefined, asked: GoalAsked): AgentGoal | undefined {
  const { ask } = asked;

  switch (ask.kind) {
    case GOAL_ASK.SET:
      return {
        condition: ask.objective,
        state: AGENT_GOAL_STATE.ACTIVE,
        setAt: asked.sentAt,
        turns: 1,
        tokens: null,
        tokenBudget: null,
        reason: null,
        messageId: asked.messageId,
      };
    case GOAL_ASK.PAUSE:
      return goal?.state === AGENT_GOAL_STATE.ACTIVE
        ? { ...goal, state: AGENT_GOAL_STATE.PAUSED }
        : goal;
    case GOAL_ASK.RESUME:
      return goal?.state === AGENT_GOAL_STATE.PAUSED
        ? { ...goal, state: AGENT_GOAL_STATE.ACTIVE }
        : goal;
    case GOAL_ASK.CLEAR:
      return undefined;
    case GOAL_ASK.NONE:
      return goal;
  }
}

/** The agent's goal as its transcript leaves it, and the newest `/goal` line of the developer's no move of the goal has answered since. */
export interface GoalRead {
  readonly goal: AgentGoal | undefined;
  readonly asked: GoalAsked | undefined;
}

/**
 * The agent's goal as its transcript's notices leave it; none where it set
 * none, cleared it, or wrote again after it settled. A line the developer
 * steered into a turn under way is read where it arrived among the turn's
 * steps, as the transcript draws it, not after the turn it is stored behind.
 * `older` says whether older pages of the transcript stand unread: then a
 * move the harness's goal itself said, of a goal whose setting is on them,
 * stands for it (`takenUp`).
 */
export function agentGoal(
  messages: readonly AgentTranscriptMessage[],
  older = false,
): AgentGoal | undefined {
  return readGoal(messages, older).goal;
}

/** The goal and the newest ask no move of it has answered yet, as `agentGoal` reads the transcript. */
export function readGoal(messages: readonly AgentTranscriptMessage[], older = false): GoalRead {
  const journals = new Set(messages.map((message) => message.id));
  const arrived = new Map<string, AgentTranscriptMessage[]>();

  for (const message of messages) {
    const journalId = message.arrivedIn?.journalId;

    if (journalId === undefined || !journals.has(journalId)) continue;
    arrived.set(journalId, [...(arrived.get(journalId) ?? []), message]);
  }

  let goal: AgentGoal | undefined;
  let asked: GoalAsked | undefined;

  // A line the developer wrote once the goal settled lets it go: its end was seen, and the conversation moved on.
  const seen = (line: AgentTranscriptMessage) => {
    if (!developersLine(line)) return;

    if (goal !== undefined && goalSettled(goal)) goal = undefined;
    const ask = goalAskOf(lineText(line));

    if (ask !== undefined && ask.kind !== GOAL_ASK.NONE) {
      asked = { ask, messageId: line.id, sentAt: line.sentAt };
    }
  };

  for (const message of messages) {
    if (message.role === MESSAGE_ROLE.USER) {
      const journalId = message.arrivedIn?.journalId;

      if (journalId === undefined || !journals.has(journalId)) seen(message);
      continue;
    }

    const waiting = (arrived.get(message.id) ?? []).toSorted(
      (a, b) => afterStepOf(a) - afterStepOf(b),
    );

    let begun = 0;

    const arrive = (steps: number) => {
      while (waiting[0] !== undefined && afterStepOf(waiting[0]) <= steps) {
        const line = waiting.shift();

        if (line !== undefined) seen(line);
      }
    };

    for (const stored of message.parts) {
      const part = agentPart(stored);

      if (part.kind === AGENT_PART.STEP_START) {
        arrive(begun);
        begun += 1;
        continue;
      }

      if (part.kind !== AGENT_PART.GOAL) continue;
      asked = undefined;
      goal =
        goal === undefined && older && part.notice.event !== GOAL_EVENT.SET
          ? takenUp(part.notice, message)
          : moved(goal, part.notice, message);
    }

    arrive(Number.POSITIVE_INFINITY);
  }

  return { goal, asked };
}

/**
 * The goal as the row shows it: as the transcript leaves it, moved by the
 * newest ask the harness has not answered, while the agent works on it or
 * for `GOAL_ASK_WAIT_MS` after it went, and then by each goal line still on
 * its way, oldest first. `now` is epoch milliseconds.
 */
export function goalAsShown(
  read: GoalRead,
  going: readonly { readonly id: string; readonly text: string }[],
  working: boolean,
  now: number,
): AgentGoal | undefined {
  const { asked } = read;

  const waited =
    asked !== undefined &&
    (working || asked.sentAt === undefined || now - asked.sentAt < GOAL_ASK_WAIT_MS);

  let shown = waited ? goalAsked(read.goal, asked) : read.goal;

  for (const line of going) {
    const ask = goalAskOf(line.text);

    if (ask !== undefined) shown = goalAsked(shown, { ask, messageId: line.id, sentAt: now });
  }

  return shown;
}
