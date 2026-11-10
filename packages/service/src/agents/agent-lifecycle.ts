/**
 * agent-lifecycle.ts -- a coding agent deleted for good, taken back to one of the developer's lines, kept warm, and its sandbox resumed, for the account that reaches it.
 *
 * This is the one implementation every door runs: the hosted `agents`
 * procedures a member's desktop, web, and CLI call (`agents-procedures.ts`),
 * and the member MCP server's `delete_agent`, `rewind_agent`, and
 * `wake_agent` (`../member-mcp/tools.ts`), which reach the agent as the
 * admitted member. Each door adds only its input, who is asking, and its
 * words.
 *
 * The agent is reached as every agent procedure reaches it
 * (`agent-reach.ts`): one of a workspace the account is a member of, every
 * other read as none. A delete is any reaching member's, as a task's is,
 * and stops the agent for good first, so a turn under way is no refusal of
 * its own: only a Stop that does not take is. A rewind is the agent's
 * controller's (`coder-host/rewind.ts`). A warm launches the runner only
 * for its controller and answers anyone else the same; a resume takes the
 * Terminal tab's rule (`terminal/sandbox-reach.ts`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, deleteAgent } from "@repo/database/models/agent-store";
import type { StoreWriter } from "@repo/database/models/writer";
import type { AgentSummary } from "@repo/features/agent-wire";
import { SANDBOX_STATE, type SandboxState } from "@repo/features/terminal-wire";
import type { Sandbox } from "@repo/sandbox";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { controlsAgent, reachedAgentById } from "./agent-reach.js";
import { clearedAgent } from "./coder-host/clear.js";
import { rewoundAgent } from "./coder-host/rewind.js";
import { runnerWarmed } from "./coder-host/runtime-sessions.js";
import { startedBlank } from "./coder-host/status.js";
import { standsStopped, stoppedForGood, summaryOf } from "./coder-host/stop.js";
import { retiredBeforeDelete, retiringReach } from "./retire-sessions.js";
import { AgentSandbox } from "./terminal/agent-sandbox.js";
import { reachedAgentSession, sandboxOrUpstream } from "./terminal/sandbox-reach.js";

/** Whether the agent, read again under its conversation's lock, still stands as a Stop left it, as a task's archive reads each of its own. */
function agentStandsStopped(agent: Agent) {
  return standsStopped([
    {
      id: agent.id,
      conversationId: agent.conversationId,
      createdAt: agent.createdAt,
      blank: startedBlank(agent),
    },
  ]);
}

/**
 * The agent deleted for good, by the steps a task's delete takes for each
 * of its agents (`tasks-procedures.ts`): stopped for good first, then,
 * under its conversation's lock, its session retired
 * (`retire-sessions.ts`), the words said on its calls deleted, its row
 * deleted, and its conversation stamped deleted for the purge. A harness
 * that refuses the Stop, an agent with a turn still coming that no Stop can
 * name yet, or one a message woke after the Stop, stands and is refused as
 * not ready.
 */
export const deletedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  account: string,
  id: string,
): Effect.fn.Return<
  { readonly deleted: true; readonly txid: string },
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | Sandbox
> {
  const { userId, agent } = yield* reachedAgentById(account, id);
  const retiring = yield* retiringReach(userId);
  yield* stoppedForGood(writer, userId, agent);
  const deleted = yield* hostedStoreOrUnavailable(
    deleteAgent(userId, agent.id, {
      standsStopped: agentStandsStopped,
      beforeDelete: retiredBeforeDelete(retiring),
    }).pipe(Effect.catchTag("TaskAgentUnstopped", () => Effect.succeed(undefined))),
  );
  if (deleted === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  if (Option.isNone(deleted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return { deleted: true as const, txid: deleted.value.txid };
});

/** The agent's harness started on a fresh session in the same agent (`coder-host/clear.ts`), answered as it then stands. */
export const clearedAgentById = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  account: string,
  id: string,
): Effect.fn.Return<AgentSummary, HostedRefusal, DatabaseServices> {
  const { userId, agent } = yield* reachedAgentById(account, id);
  yield* clearedAgent(writer, userId, agent);
  return yield* summaryOf(userId, agent);
});

/** The agent taken back to just before the developer's line named (`coder-host/rewind.ts`), answered as it then stands. */
export const rewoundAgentById = /* @__PURE__ */ Effect.fnUntraced(function* (
  account: string,
  id: string,
  messageId: string,
): Effect.fn.Return<AgentSummary, HostedRefusal, DatabaseServices> {
  const { userId, agent } = yield* reachedAgentById(account, id);
  yield* rewoundAgent(userId, agent, messageId);
  return yield* summaryOf(userId, agent);
});

/**
 * The agent kept warm (`runnerWarmed`), its runner launched where none
 * runs. Kept for a member who may message it alone, whose message the warm
 * runner would take; anyone else is answered the same, and nothing is kept.
 */
export const warmedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  account: string,
  id: string,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  const { userId, agent } = yield* reachedAgentById(account, id);
  if (controlsAgent(userId, agent)) yield* runnerWarmed(agent);
});

/** The agent's sandbox resumed from its snapshot, answering where it stands after; one not opened yet stands starting and is resumed by nothing. */
export const resumedAgentSandbox = /* @__PURE__ */ Effect.fnUntraced(function* (
  account: string,
  id: string,
): Effect.fn.Return<SandboxState, HostedRefusal, DatabaseServices | AgentSandbox> {
  const { sessionId } = yield* reachedAgentSession(account, id);
  if (sessionId === undefined) return SANDBOX_STATE.STARTING;
  const sandbox = yield* AgentSandbox;
  return yield* sandboxOrUpstream(sandbox.resume(sessionId));
});
