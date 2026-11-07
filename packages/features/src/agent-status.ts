import { TURN_STATUS } from "@repo/wire";
import { AGENT_STATUS, type AgentStatus } from "./agent-wire.js";

/**
 * agent-status.ts -- where a coding agent stands, read from its newest turn: the one rule the service and the desktop both read an agent's status by.
 *
 * An agent's status is its conversation's newest turn row, the one record of
 * a turn (`@repo/database`'s `turn-state.ts`): `running` while that turn is
 * queued for a runner or runs, and how it ended after. A line of the
 * developer's is written with the turn it awaits, so a line waiting reads
 * through that turn, and a turn past its deadline is failed on its row by
 * the minute sweep, so nothing here reads the clock to say a turn is over.
 * A turn still running that carries a Stop stamp reads as canceled already,
 * since the Stop is on its way to the agent's harness and nothing the turn
 * still does changes where it ends.
 *
 * The one thing the row does not say is an agent's start before its first
 * turn lands: an agent with no turn row reads as starting for
 * `STARTING_GRACE_MILLIS` past its Start and as failed after, as one that
 * never started, and an agent started blank, with no first turn on its way,
 * as completed. That is why the rule takes the instant it reads at, and a
 * reader following the rows live reads the status again at
 * `statusClockEdge`, the instant the clock alone moves it.
 */

/**
 * How long after its Start an agent with no turn row yet still reads as
 * starting. The Start writes its first line with the turn it queues, a
 * moment after the agent's own row; an agent still without one past this is
 * read as failed, so nothing reads starting forever.
 */
export const STARTING_GRACE_MILLIS = 5 * 60 * 1000;

/** The status a turn row's own status word reads as. */
const STATUS_OF_TURN = {
  [TURN_STATUS.QUEUED]: AGENT_STATUS.RUNNING,
  [TURN_STATUS.RUNNING]: AGENT_STATUS.RUNNING,
  [TURN_STATUS.SETTLED]: AGENT_STATUS.COMPLETED,
  [TURN_STATUS.CANCELED]: AGENT_STATUS.CANCELED,
  [TURN_STATUS.FAILED]: AGENT_STATUS.FAILED,
} as const satisfies Record<string, AgentStatus>;

const STATUS_WORDS: ReadonlySet<string> = new Set(Object.keys(STATUS_OF_TURN));

function isTurnStatusWord(status: string): status is keyof typeof STATUS_OF_TURN {
  return STATUS_WORDS.has(status);
}

/** What of an agent's newest turn its status is read from. */
export interface StatusTurn {
  /** The turn's own status word. */
  readonly status: string;
  /** Whether a Stop was asked of it. */
  readonly cancelRequested: boolean;
}

/** When the agent was started and the instant it is read at, in epoch milliseconds, and whether it was started blank. */
export interface StatusStanding {
  readonly createdAt: number;
  readonly now: number;
  /** Whether the agent was started blank, handed neither the description nor a prompt, so no first turn is on its way; unsaid reads as not. */
  readonly blank?: boolean | undefined;
}

/**
 * Whether a Stop has something to stop: the newest turn runs, and no Stop
 * was asked of it yet. What the Stop button is offered by, so a second press
 * on a turn already stopped, or one pressed while its line still awaits a
 * runner to take it, is never taken and silently dropped.
 */
export function turnStoppable(turn: StatusTurn | undefined): boolean {
  return turn?.status === TURN_STATUS.RUNNING && !turn.cancelRequested;
}

/**
 * Where an agent stands, from its newest turn: as that turn's status word
 * reads, canceled where it still runs with a Stop asked of it; with no turn,
 * completed where it was started blank, starting inside the grace, and failed
 * past it.
 */
export function agentStatusAt(
  newest: StatusTurn | undefined,
  standing: StatusStanding,
): AgentStatus {
  if (newest === undefined && standing.blank === true) return AGENT_STATUS.COMPLETED;
  if (newest === undefined) {
    return standing.now - standing.createdAt <= STARTING_GRACE_MILLIS
      ? AGENT_STATUS.STARTING
      : AGENT_STATUS.FAILED;
  }
  // A word outside the vocabulary is a state a newer service writes of a turn not yet ended, since every ending is
  // already a word here, so it reads as running; the service's deadlines, not this reader, are what end it.
  const status = isTurnStatusWord(newest.status)
    ? STATUS_OF_TURN[newest.status]
    : AGENT_STATUS.RUNNING;
  return status === AGENT_STATUS.RUNNING && newest.cancelRequested ? AGENT_STATUS.CANCELED : status;
}

/**
 * The next instant past which the clock alone moves the agent's status, in
 * epoch milliseconds: with no turn yet, the starting grace running out, from
 * starting to failed. None where only a row changing can move it: a turn
 * stands, the agent was started blank, or the grace is already past.
 */
export function statusClockEdge(
  newest: StatusTurn | undefined,
  standing: StatusStanding,
): number | undefined {
  if (newest !== undefined || standing.blank === true) return undefined;
  const edge = standing.createdAt + STARTING_GRACE_MILLIS;
  return standing.now <= edge ? edge + 1 : undefined;
}
