/**
 * agent-goal-model.ts -- a coding agent's goal as its transcript says it stands: the condition the agent works toward, how far it has run, and whether it holds, read from the goal notices its turns keep (`@repo/wire/ui-messages`'s `GOAL_PART`).
 *
 * The harness keeps the goal (Claude Code's `/goal`, Codex's thread goal);
 * the transcript keeps each move of it, so the goal is read back from those
 * moves in order rather than held anywhere of the service's own. Note that
 * Claude Code says a project's own blocking Stop hook in the same shape as
 * its checker's verdict, so a verdict counts only where its condition is a
 * goal's. A `/goal` line the developer sent moves the goal as shown at once,
 * ahead of the harness's word (`goalAsShown`). Cursor keeps no goal, and
 * the app builds none of its own, so a Cursor agent is offered no `/goal`,
 * draws no goal row, and is refused a `/goal` line (`goalRefusalWords`).
 */

import { MESSAGE_ROLE } from "@repo/wire";
import {
  GOAL_ASK,
  GOAL_EVENT,
  type GoalAsk,
  type GoalNotice,
  goalAskOf,
} from "@repo/wire/ui-messages";
import { AGENT_PART, agentPart, agentParts, arrivedParts, placedMessages } from "./agent-parts.js";
import { runtimeModelRule } from "./agent-runtime-models.js";
import {
  AGENT_RUNTIME,
  AGENT_SENDER,
  type AgentRuntime,
  type AgentTranscriptMessage,
} from "./agent-wire.js";
import { leadingCommand, SLASH_COMMAND } from "./slash-command.js";

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

type AgentGoalState = (typeof AGENT_GOAL_STATE)[keyof typeof AGENT_GOAL_STATE];

/** What an agent's harness does with a goal: keeps none, sets and clears one (Claude Code's `/goal`), or pauses and resumes it too (Codex's thread goal). */
export const GOAL_REACH = {
  NONE: "none",
  SETS: "sets",
  PAUSES: "pauses",
} as const;

export type GoalReach = (typeof GOAL_REACH)[keyof typeof GOAL_REACH];

/** Each runtime's goal, so a new harness says what it does with one before it builds. */
const RUNTIME_GOAL_REACH = {
  [AGENT_RUNTIME.RETIRED]: GOAL_REACH.NONE,
  [AGENT_RUNTIME.CLAUDE_CODE]: GOAL_REACH.SETS,
  [AGENT_RUNTIME.CODEX]: GOAL_REACH.PAUSES,
  [AGENT_RUNTIME.CURSOR]: GOAL_REACH.NONE,
} as const satisfies Record<AgentRuntime, GoalReach>;

/** What the agent's harness does with a goal; one that sets it where the runtime is not known yet, as a Start's box before its model decides one. */
export function goalReachOf(runtime: AgentRuntime | undefined): GoalReach {
  return runtime === undefined ? GOAL_REACH.SETS : RUNTIME_GOAL_REACH[runtime];
}

/** Whether the agent's harness runs a goal at all. */
export function runsGoal(runtime: AgentRuntime | undefined): boolean {
  return goalReachOf(runtime) !== GOAL_REACH.NONE;
}

/** What a `/goal` line sent to an agent whose harness keeps no goal says as it is refused; none for any other line, or a harness that runs one. */
export function goalRefusalWords(
  runtime: AgentRuntime | undefined,
  text: string,
): string | undefined {
  if (runsGoal(runtime) || leadingCommand(text)?.name !== SLASH_COMMAND.GOAL) return undefined;

  return `${runtimeModelRule(runtime).name} agents don't run goals.`;
}

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
}

/** How long a goal line moves the goal as shown before the harness answers it: both harnesses answer an ask they take at once, so one this old was refused. */
export const GOAL_ASK_WAIT_MS = 30_000;

/** A `/goal` line the developer sent, as what it asks of the goal. */
interface GoalAsked {
  readonly ask: GoalAsk;
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

/** The conditions the transcript's goals were set or moved under, which a verdict must name to be a goal's (`goalVerdict`): every notice's but a verdict's own. */
export function goalConditions(messages: readonly AgentTranscriptMessage[]): ReadonlySet<string> {
  const conditions = new Set<string>();

  for (const message of messages) {
    for (const part of agentParts(message)) {
      if (part.kind === AGENT_PART.GOAL && part.notice.event !== GOAL_EVENT.NOT_MET) {
        conditions.add(part.notice.condition);
      }
    }
  }

  return conditions;
}

/** A verdict as one of the goals' whose conditions are given, its reason split after the goal's own; none where it is a project's own Stop hook. */
export function goalVerdict(
  notice: GoalNotice,
  conditions: ReadonlySet<string>,
): GoalNotice | undefined {
  for (const condition of conditions) {
    const own = ofGoal(notice, condition);

    if (own !== undefined) return own;
  }

  return undefined;
}

/** What a goal's notice says it did, as its trail or its card's head reads. */
const GOAL_NOTICE_WORDS = {
  [GOAL_EVENT.SET]: "Goal set.",
  [GOAL_EVENT.NOT_MET]: "Goal not met yet",
  [GOAL_EVENT.MET]: "Goal met",
  [GOAL_EVENT.IMPOSSIBLE]: "Goal blocked",
  [GOAL_EVENT.PAUSED]: "Goal paused. The agent stops after this turn.",
  [GOAL_EVENT.RESUMED]: "Goal resumed",
  [GOAL_EVENT.BUDGET_LIMITED]: "Goal stopped at its token budget",
  [GOAL_EVENT.CLEARED]: "Goal cleared",
} as const satisfies Record<GoalNotice["event"], string>;

/** The moves said as a trail rather than a card, since they carry nothing to read: the goal's end once met, and each move of its standing. */
const GOAL_TRAILS: ReadonlySet<GoalNotice["event"]> = new Set([
  GOAL_EVENT.MET,
  GOAL_EVENT.PAUSED,
  GOAL_EVENT.RESUMED,
  GOAL_EVENT.CLEARED,
]);

/** How a goal's notice stands in the transcript: a one-line trail, or a card whose reason folds under its head. */
export const GOAL_NOTICE_LOOK = {
  TRAIL: "trail",
  CARD: "card",
} as const;

/** A goal's notice as the transcript draws it: its event, which picks its glyph, and its words; a card also its reason, folded, and the turn it came on. */
export type GoalNoticeShown =
  | {
      readonly look: typeof GOAL_NOTICE_LOOK.TRAIL;
      readonly event: GoalNotice["event"];
      readonly words: string;
    }
  | {
      readonly look: typeof GOAL_NOTICE_LOOK.CARD;
      readonly event: GoalNotice["event"];
      readonly words: string;
      /** The checker's or the harness's reason, which folds under the head; null where it said none. */
      readonly reason: string | null;
      /** The turn it came on ("Turn 3"); none where the harness did not count it. */
      readonly turn: string | undefined;
    };

/**
 * A goal's notice as the transcript draws it, where the goals' conditions
 * are given (`goalConditions`): none for its setting, since the
 * developer's own `/goal` line says it just above, nor for a project's own
 * Stop hook, as before goals; a trail for its end once met and each move of
 * its standing; and a card for each verdict and any other end.
 */
export function goalNoticeShown(
  stored: GoalNotice,
  conditions: ReadonlySet<string>,
): GoalNoticeShown | undefined {
  const notice = stored.event === GOAL_EVENT.NOT_MET ? goalVerdict(stored, conditions) : stored;

  if (notice === undefined || notice.event === GOAL_EVENT.SET) return undefined;
  const words = GOAL_NOTICE_WORDS[notice.event];

  if (GOAL_TRAILS.has(notice.event)) {
    return { look: GOAL_NOTICE_LOOK.TRAIL, event: notice.event, words };
  }

  return {
    look: GOAL_NOTICE_LOOK.CARD,
    event: notice.event,
    words,
    reason: notice.reason,
    turn: notice.turns === null ? undefined : `Turn ${notice.turns}`,
  };
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
      ...counted,
    };
  }

  if (goal === undefined) return goal;
  const own = ofGoal(notice, goal.condition);

  // A move of another goal than the one standing is a project's own hook or a goal long gone.
  if (own === undefined) return goal;

  if (own.event === GOAL_EVENT.CLEARED) return undefined;
  const at = { ...goal, ...counted, turns: own.turns ?? goal.turns };

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
        reason: own.reason ?? goal.reason,
      };
  }
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
function goalAsked(goal: AgentGoal | undefined, asked: GoalAsked): AgentGoal | undefined {
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
 * The agent's goal as its transcript's notices leave it, none where it set
 * none, cleared it, or wrote again after it settled; and the newest ask no
 * move has answered since. A line steered into a turn is read where it
 * arrived among the turn's steps, as the transcript draws it. `older` says
 * older pages stand unread, where a move the harness said of a goal set on
 * them stands for its setting (`takenUp`).
 */
export function readGoal(messages: readonly AgentTranscriptMessage[], older = false): GoalRead {
  let goal: AgentGoal | undefined;
  let asked: GoalAsked | undefined;

  // A line the developer wrote once the goal settled lets it go: its end was seen, and the conversation moved on. Note that a pause, resume, or clear is no such line, since the transcript draws it as no message.
  const seen = (line: AgentTranscriptMessage) => {
    if (!developersLine(line)) return;
    const text = lineText(line);

    if (goal !== undefined && goalSettled(goal) && !goalControlWords(text)) goal = undefined;
    const ask = goalAskOf(text);

    if (ask !== undefined && ask.kind !== GOAL_ASK.NONE) {
      asked = { ask, sentAt: line.sentAt };
    }
  };

  for (const { message, arrived } of placedMessages(messages)) {
    if (message.role === MESSAGE_ROLE.USER) {
      seen(message);
      continue;
    }

    for (const part of arrivedParts(message, arrived)) {
      if (part.kind === AGENT_PART.ARRIVED) seen(part.line);

      if (part.kind !== AGENT_PART.GOAL) continue;
      const notice = part.notice;

      // Note that a project's own Stop hook, said as a verdict of no goal's, answers no ask.
      if (
        notice.event === GOAL_EVENT.NOT_MET &&
        (goal === undefined || ofGoal(notice, goal.condition) === undefined)
      ) {
        continue;
      }

      asked = undefined;
      goal =
        goal === undefined && older && notice.event !== GOAL_EVENT.SET
          ? takenUp(notice, message)
          : moved(goal, notice, message);
    }
  }

  return { goal, asked };
}

/**
 * The goal as the row shows it: as the transcript leaves it, moved by the
 * newest ask the harness has not answered for `GOAL_ASK_WAIT_MS` after it
 * went, then by each goal line still on its way (`going`, their words). Note
 * that a goal set while the agent works waits past that, because a cold start
 * can take longer before the harness reads the line. `now` is epoch
 * milliseconds.
 */
export function goalAsShown(
  read: GoalRead,
  going: readonly string[],
  working: boolean,
  now: number,
): AgentGoal | undefined {
  const { asked } = read;

  const waited =
    asked?.sentAt !== undefined &&
    (now - asked.sentAt < GOAL_ASK_WAIT_MS || (working && asked.ask.kind === GOAL_ASK.SET));

  let shown = waited ? goalAsked(read.goal, asked) : read.goal;

  for (const words of going) {
    const ask = goalAskOf(words);

    if (ask !== undefined) shown = goalAsked(shown, { ask, sentAt: now });
  }

  return shown;
}
