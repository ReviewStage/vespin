import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  readAgentRouting,
  recordAgentNativeSession,
} from "@repo/database/models/agent-store";
import { cancelAgentWakeup } from "@repo/database/models/agent-wakeups";
import { latestTurnsOf } from "@repo/database/models/message-reads";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import type { StoreWriter } from "@repo/database/models/writer";
import { Effect, Option, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { admitsPlanWriter, controlsAgent } from "../agent-reach.js";
import { harnessOf } from "./native-runtime.js";
import { runnerHalted } from "./runtime-sessions.js";

/**
 * clear.ts -- a coding agent's harness started on a fresh session in the same agent (`/clear`), its transcript kept with a mark where the session changed.
 *
 * The agent keeps its sandbox, its checkout, its branch, and everything it
 * said: only the harness's own session is let go, so the next message
 * opens a fresh one, handed none of the conversation before it, as a
 * session opened with no session to resume is (`runner-sessions.ts`'s
 * `resumedSessionWhen`). Its runner is ended first, keeping its sandbox,
 * since a warm one would take the next message on the session it holds.
 * The transcript gains a mark after its last row (`markSessionCleared`),
 * which the tab draws as the line between the two sessions. An agent at
 * work is refused rather than stopped, so a clear never cuts a turn short;
 * so is one on no harness, which has no session to let go.
 */

/** The agent's harness started on a fresh session, as above; refused where the caller may not write to it, where it works, or where it runs on no harness. */
export const clearedAgent = /* @__PURE__ */ Effect.fn("web/clearedAgent")(function* (
  writer: Effect.Effect<StoreWriter>,
  account: string,
  agent: Agent,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  // An agent on its starter's own GitHub token takes words from its starter alone, and so is cleared by them alone.
  if (!controlsAgent(account, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* admitsPlanWriter(account, agent);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const latest = yield* hostedStoreOrUnavailable(
    latestTurnsOf(agent.userId, [agent.conversationId]),
  );
  if (latest.get(agent.conversationId)?.settledAt === null) {
    return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  }
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(agent.userId, agent.id));
  const runtime = harnessOf(Option.getOrUndefined(routing)?.runtime);
  if (runtime === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  // A wakeup the agent booked belongs to the session let go.
  yield* hostedStoreOrUnavailable(cancelAgentWakeup(agent.id));
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId !== undefined && !(yield* runnerHalted(agent, runtime, sessionId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  yield* hostedStoreOrUnavailable(recordAgentNativeSession(agent.userId, agent.id, null));
  const store = yield* writer;
  const marked = yield* hostedStoreOrUnavailable(store.markSessionCleared(target));
  if (Result.isFailure(marked)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
});
