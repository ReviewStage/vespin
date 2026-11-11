import type { DatabaseServices } from "@repo/database/core/query";
import { beginTaskWork } from "@repo/database/models/task-store";
import { failureKind } from "@repo/runtime/effect";
import { Effect } from "effect";
import { archivedWithDoneTask } from "../agents/agent-change.js";

/**
 * task-finish.ts -- what a coding agent's turn asks of its task: in progress again once an agent takes it up, and an agent still at work archived with a task moved to Done.
 *
 * A task's status is its agents' to keep, from their instructions
 * (`coder-host/instructions.ts`), and a member's: nothing moves it to done on
 * its own, so a task an agent misses stands in progress until someone marks it.
 *
 * Only a member's or an agent's move to Done archives the task's agents
 * standing idle with it, as them (`task-store.ts`'s `updateTaskCommitted`),
 * but the agent that moved it. An agent still at work then, a turn whose
 * Stop is on its way among it, since its runner still holds its folder, and
 * the agent that moved the task, are not stopped: the turn's end archives
 * each, as whoever moved the task, where the task still stands Done by their
 * move (`settleTaskAfterTurn`, through `agent-change.ts`'s
 * `archivedWithDoneTask`).
 *
 * The other way, a task done or canceled moves back to in progress when an
 * agent is started on it (`coder-host/start.ts`) and when a coding agent's
 * turn starts on it, as one in the backlog or to do does
 * (`beginTaskWork`); a voice call alone reopens nothing, and neither brings
 * back an agent its Done archived, which only a member's or an agent's move
 * off Done does. Either move is a change beside the turn it rides on: a
 * failure is logged and never the turn's.
 */

/** The task's move logged rather than failed, since it rides on another write. */
function logged<A>(what: string, move: Effect.Effect<A, unknown, DatabaseServices>) {
  return move.pipe(
    Effect.asVoid,
    Effect.catch((failure) =>
      Effect.logWarning(`${what} was not settled: ${failureKind(failure)}`),
    ),
  );
}

/**
 * What a coding agent's turn ending asks of its task: where a member, another
 * agent, or the agent itself moved the task to Done or Canceled while the
 * agent worked, the agent archived with it as them and let go of; a failure
 * logged.
 */
export function settleTaskAfterTurn(
  userId: string,
  taskId: string,
  agentId: string,
): Effect.Effect<void, never, DatabaseServices> {
  return logged("a done task's agent archive", archivedWithDoneTask(userId, taskId, agentId));
}

/** The task moved back to in progress where it was done or canceled, as a turn starting on it does; a failure logged. */
export function reopenTaskForWork(
  userId: string,
  taskId: string,
): Effect.Effect<void, never, DatabaseServices> {
  return logged("a task's reopening", beginTaskWork(userId, taskId));
}
