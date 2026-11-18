/**
 * task-delete.ts -- a task deleted: its coding agents stopped for good or found stopped, their sessions retired, then the task.
 *
 * The app's delete (`tasks.delete`) goes through `deleteTaskStoppingAgents`:
 * the task is one the account reaches, every coding agent of it is stopped
 * for good first, as a Stop stops one, so none works on for a task that is
 * gone; then the agents' sessions are retired (`retire-sessions.ts`), with
 * no transaction open; then the task, under its lock, which reads again
 * which agents stand. A harness that refuses a Stop, an agent with a turn still coming
 * that no Stop can name yet, or an agent started while the others were
 * stopped, leaves the task standing and refused.
 *
 * A member's `delete_task` goes through `deleteTaskOfStoppedAgents`, which
 * stops nothing, since only `stop_agent` stops an agent: it is refused while
 * any agent of the task is starting or running, read first so a refusal
 * touches nothing, and read again under the task's and the agents' locks at
 * the delete, so one a message set to work meanwhile still refuses it; the
 * sessions are retired there, under those locks, as an agent's delete
 * retires its one, so a refused delete has retired none. Each door reads its
 * own input and answers in its own words.
 *
 * The Stops and the retires reach the agents' sessions for the account the
 * caller resolved to (`coder-host/runtime-sessions.ts`), the retires a
 * courtesy the delete does not wait on.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { listAgents } from "@repo/database/models/agent-store";
import { deleteTaskCommitted } from "@repo/database/models/task-store";
import type { StoreWriter } from "@repo/database/models/writer";
import type { Sandbox } from "@repo/sandbox";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { startedBlank } from "../agents/coder-host/status.js";
import { everyStoppedForGood, standsStopped } from "../agents/coder-host/stop.js";
import { retiredBeforeDelete, retiringReach } from "../agents/retire-sessions.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";

/** The task the account reaches deleted, with the transaction its row went in; refused not found where it reaches none, and not ready where an agent stands that the delete did not stop. */
export const deleteTaskStoppingAgents = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  taskId: string,
): Effect.fn.Return<
  { readonly txid: string },
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | Sandbox
> {
  const retiring = yield* retiringReach(userId);

  const agents = yield* hostedStoreOrUnavailable(
    listAgents(userId, taskId, { includeArchived: true }),
  );

  yield* everyStoppedForGood(writer, userId, agents);
  // The stopped agents' sessions are retired before the delete's transaction, so no lock waits on a harness;
  // an agent started meanwhile is none of these, keeps its session, and refuses the delete below.
  yield* hostedStoreOrUnavailable(
    retiredBeforeDelete(retiring)(agents.map(({ conversationId }) => conversationId)),
  );
  const stopped = new Set(agents.map(({ id }) => id));

  const deleted = yield* hostedStoreOrUnavailable(
    deleteTaskCommitted(userId, taskId, { stoppedAgentIds: stopped }).pipe(
      Effect.catchTag("TaskAgentUnstopped", () => Effect.succeed(undefined)),
    ),
  );

  // An agent started while the others were stopped is one this delete has not stopped yet.
  if (deleted === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);

  if (Option.isNone(deleted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return deleted.value;
});

/**
 * The task the account reaches deleted as above, stopping nothing: refused
 * not ready where any of its agents is starting or running, before anything
 * is touched or at the delete itself, and not found where it reaches none.
 */
export const deleteTaskOfStoppedAgents = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
): Effect.fn.Return<
  { readonly txid: string },
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient
> {
  const retiring = yield* retiringReach(userId);

  const agents = yield* hostedStoreOrUnavailable(
    listAgents(userId, taskId, { includeArchived: true }),
  );

  const stopped = yield* hostedStoreOrUnavailable(
    standsStopped(
      agents.map((agent) => ({
        id: agent.id,
        conversationId: agent.conversationId,
        createdAt: agent.createdAt,
        blank: startedBlank(agent),
      })),
    ),
  );

  if (!stopped) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);

  // Note that the sessions are retired under the agents' locks once they read stopped there, because an
  // agent a message set to work since the read above would otherwise lose its session to a delete then refused.
  const deleted = yield* hostedStoreOrUnavailable(
    deleteTaskCommitted(userId, taskId, {
      stoppedAgentIds: new Set(agents.map(({ id }) => id)),
      standing: { standsStopped, beforeDelete: retiredBeforeDelete(retiring) },
    }).pipe(Effect.catchTag("TaskAgentUnstopped", () => Effect.succeed(undefined))),
  );

  // An agent started, or set to work by a message, since the read above stands at work.
  if (deleted === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);

  if (Option.isNone(deleted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return deleted.value;
});
