import { TURN_STATUS, type TurnStatus } from "@repo/wire";
import { BOOT_PHASE, type BootPhase, bootHolds } from "./agent-boot.js";
import { AGENT_STATUS, type AgentStatus, type AgentTurn, turnStatusOfWord } from "./agent-wire.js";

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
 * `statusClockEdge`, the instant the clock alone moves it. An agent whose
 * first launch boots its machine before its first turn (`agent-boot.ts`)
 * reads from its boot record instead: starting for as long as it boots,
 * however long its setup takes, since the boot's own deadline is what fails
 * a boot that never comes up, and failed once it did.
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
} as const satisfies Record<TurnStatus, AgentStatus>;

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
  /** Where the agent's first launch stands, while its boot record does; unsaid reads as none. */
  readonly boot?: BootPhase | null | undefined;
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
  if (newest === undefined && bootHolds(standing.boot)) {
    return standing.boot === BOOT_PHASE.FAILED ? AGENT_STATUS.FAILED : AGENT_STATUS.STARTING;
  }
  if (newest === undefined && standing.blank === true) return AGENT_STATUS.COMPLETED;
  if (newest === undefined) {
    return standing.now - standing.createdAt <= STARTING_GRACE_MILLIS
      ? AGENT_STATUS.STARTING
      : AGENT_STATUS.FAILED;
  }
  return turnAgentStatus(newest);
}

/** Where an agent stands by its newest turn alone: as the turn's status word reads, canceled where it still runs with a Stop asked of it. */
export function turnAgentStatus(turn: StatusTurn): AgentStatus {
  const status = STATUS_OF_TURN[turnStatusOfWord(turn.status)];
  return status === AGENT_STATUS.RUNNING && turn.cancelRequested ? AGENT_STATUS.CANCELED : status;
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
  if (newest !== undefined || standing.blank === true || bootHolds(standing.boot)) return undefined;
  const edge = standing.createdAt + STARTING_GRACE_MILLIS;
  return standing.now <= edge ? edge + 1 : undefined;
}

/** The turn statuses a turn has not ended in: queued for a runner, or running. */
const OPEN_TURN_STATUSES: ReadonlySet<TurnStatus> = new Set([
  TURN_STATUS.QUEUED,
  TURN_STATUS.RUNNING,
]);

/**
 * Whether a turn as its record says it has not ended: queued for a runner,
 * or running, a Stop asked of it or not, since a stopped turn runs until its
 * runner ends it. Its row's deadlines are what end a turn whose runner never
 * does, never the reader's clock.
 */
export function turnOpen(turn: Pick<AgentTurn, "status">): boolean {
  return OPEN_TURN_STATUSES.has(turn.status);
}

/**
 * The newer of two turn records, by when each was queued and then by id, as
 * the turns of a conversation are ordered; `a` where both name the same
 * turn, so the reader passes the record it holds freshest first. Either may
 * be absent, and the other is newer then.
 */
export function newerTurn(
  a: AgentTurn | undefined,
  b: AgentTurn | undefined,
): AgentTurn | undefined {
  if (a === undefined || b === undefined) return a ?? b;
  if (a.queuedAt !== b.queuedAt) return a.queuedAt > b.queuedAt ? a : b;
  return b.id > a.id ? b : a;
}
