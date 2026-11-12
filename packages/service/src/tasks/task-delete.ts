/**
 * task-delete.ts -- a task deleted, as every door deletes one: its coding agents stopped for good, their sessions retired, then the task.
 *
 * The app's delete (`plans.delete`) and a member's `delete_task` go through
 * this one operation, so one rule holds for each: the task is one the
 * account reaches, every coding agent of it is stopped for good first, as a
 * Stop stops one, so none works on for a task that is gone; then the
 * agents' sessions are retired (`retire-sessions.ts`), with no transaction
 * open; then the task, under its lock, which reads again which agents
 * stand. A harness that refuses a Stop, an agent with a turn still coming
 * that no Stop can name yet, or an agent started while the others were
 * stopped, leaves the task standing and refused. Each door reads its own
 * input and answers in its own words.
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
import { everyStoppedForGood } from "../agents/coder-host/stop.js";
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
