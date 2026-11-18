import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { beginTaskWork, readTaskHeader } from "@repo/database/models/task-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { isTaskSettled, TASK_STATUS_ORDER } from "@repo/features/task-wire";
import { failureKind } from "@repo/runtime/effect";
import { Effect, Option } from "effect";
import { archivedWithDoneTask } from "../agents/agent-change.js";

/**
 * task-finish.ts -- what a coding agent's turn asks of its task: in progress again once an agent takes it up, and an agent still at work archived with a task moved to Done.
 *
 * A task's status is its agents' to keep, from their instructions
 * (`coder-host/instructions.ts`), and a member's: nothing moves it to done on
 * its own, so a task an agent misses stands in progress until someone marks it,
 * but for the task an automation's run made for itself, which moves to Done
 * as "Mark finished runs Done" puts its run away (`../automations/run-archive.ts`).
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
 *
 * Note that a tool call never takes that reopen: a tool that would start a
 * turn on an agent whose task stands done or canceled, a message, a thread
 * line, an answer, or a queue change, is refused (`settledTaskRefusal`), so
 * the caller moves the task with `update_task` first. Each tool does one
 * thing; only a member's own words in the window, and the lines GitHub,
 * Slack, and an automation send, reopen the task as their turn starts.
 */

/** The statuses a settled task may be moved back to, in the order a menu lists them. */
const OPEN_STATUSES = TASK_STATUS_ORDER.filter((status) => !isTaskSettled(status));

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

/**
 * Why a tool's words may not reach an agent: its task stands done or
 * canceled, so the turn they would start would reopen it unasked, and its end
 * archive the agent; none for an agent on no task, or on one still open.
 * Answered in words naming the task and the statuses it may move to, so one
 * `update_task` and a retry mend the call.
 */
export function settledTaskRefusal(
  userId: string,
  taskId: string | null,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  if (taskId === null) return Effect.succeedNone;

  return Effect.map(readTaskHeader(userId, taskId), (header) =>
    Option.flatMap(header, ({ status }) =>
      isTaskSettled(status)
        ? Option.some(
            `Not sent: that agent's task ${taskId} is ${status}, and a tool never reopens a ` +
              `task. Move it first with ${AGENT_TOOL.UPDATE_TASK} (taskId ${taskId}, status one of ` +
              `${OPEN_STATUSES.join(", ")}), then call again.`,
          )
        : Option.none(),
    ),
  );
}
