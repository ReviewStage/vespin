/**
 * sandbox-reach.ts -- which coding agent's sandbox a member's request reaches, by the Terminal tab's rule, a sandbox or shell that did not answer as the refusal a route answers, and the agent's shells as they stand.
 *
 * Every route that acts in an agent's sandbox for a member, its shells, its
 * resume, and the ports listened on in it, reads the agent through here, so
 * who may reach a sandbox is decided once (`../agent-reach.ts`'s
 * `controlsAgent`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { SANDBOX_STATE } from "@repo/features/terminal-wire";
import type { SandboxError } from "@repo/sandbox";
import { Effect } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { controlsAgent, reachedAgentById } from "../agent-reach.js";
import { AgentSandbox, SHELL_REFUSAL, type ShellRefusal } from "./agent-sandbox.js";

/** The agent a sandbox route reaches: the session its sandbox is tagged with, and the machine it runs on. */
interface ReachedAgentSession {
  readonly sessionId: string | undefined;
  readonly machine: Agent["machine"];
  /** The agent itself, for a route that reads more of it, such as its repository's run actions. */
  readonly agent: Agent;
}

/**
 * The agent the path names, still standing: the session its sandbox is
 * tagged with, or none where the agent has not run yet, and its machine. An archived agent
 * is gone, as its tab is, and one on its starter's own GitHub token gives its
 * sandbox to its starter alone.
 */
export const reachedAgentSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  id: string,
): Effect.fn.Return<ReachedAgentSession, HostedRefusal, DatabaseServices> {
  const { agent } = yield* reachedAgentById(userId, id);
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  const [session] = yield* hostedStoreOrUnavailable(
    standingSessionsOf(agent.userId, [agent.conversationId]),
  );
  return {
    sessionId: session?.sessionId,
    machine: agent.machine,
    agent,
  };
});

/**
 * A sandbox that could not be asked about, as the upstream's refusal a
 * caller may retry, apart from the store's own unavailable, so the tab can
 * say it was the agent's sandbox that did not answer: the sandbox's
 * provider, or a command in a sandbox it answered for. A sandbox whose
 * snapshot is gone is refused as that, since no retry resumes it. The log
 * names the failure in the sandbox's own words.
 */
export function sandboxOrUpstream<A, R>(
  effect: Effect.Effect<A, SandboxError, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return effect.pipe(
    Effect.tapError((failure) =>
      Effect.logWarning(`an agent's sandbox call failed: ${failure.message}`),
    ),
    Effect.catchTag(
      "SnapshotGone",
      () => Effect.fail(HOSTED_REFUSAL.SANDBOX_SNAPSHOT_GONE),
      () => Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR),
    ),
  );
}

/** Why a shell could not be had, as the refusal a route answers. */
export function shellRefusal(refusal: ShellRefusal): HostedRefusal {
  if (refusal.kind === SHELL_REFUSAL.NOT_FOUND) return HOSTED_REFUSAL.NOT_FOUND;
  return refusal.sandbox === SANDBOX_STATE.STARTING
    ? HOSTED_REFUSAL.AGENT_NOT_READY
    : HOSTED_REFUSAL.SANDBOX_STOPPED;
}

/** The agent's shells as they stand now, the answer every change of one returns too. */
export const listedShells = /* @__PURE__ */ Effect.fnUntraced(function* (
  sessionId: string | undefined,
) {
  if (sessionId === undefined) return { sandbox: SANDBOX_STATE.STARTING, terminals: [] };
  const sandbox = yield* AgentSandbox;
  return yield* sandboxOrUpstream(sandbox.terminals(sessionId));
});
