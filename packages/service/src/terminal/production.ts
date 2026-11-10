/**
 * production.ts -- the terminal relay's dependencies as the deployment stands them: the agent read by the one rule, its sandbox through `Sandbox`, the PTY reached by WebSocket (`sandbox-pty.ts`), and the credential's renewal claim in the store.
 *
 * Each dependency answers over the services the function's runtime holds,
 * captured once as the relay stands, so the relay itself requires none. A
 * store that cannot claim the credential's renewal is
 * read as not claimed, and one that cannot give a claim back is logged, so
 * the claim lapses on the agent's own rule. One that cannot say when the
 * credential was last renewed is logged and read as never, so the claim
 * decides. A touch the sandbox did not confirm is logged, since the next
 * one tries again.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { hasRepository, readVisibleAgent } from "@repo/database/models/agent-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import {
  claimCredentialRenewal,
  credentialRenewedAt,
  releaseCredentialRenewal,
} from "@repo/database/models/sandbox-terminal-lease";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Sandbox } from "@repo/sandbox";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { controlsAgent } from "../agents/agent-reach.js";
import { agentSandboxName } from "../agents/agent-sandbox-open.js";
import type { AgentImage } from "../agents/coder-host/agent-image.js";
import { agentRepositoryToken } from "../agents/coder-host/checkout.js";
import { connectPty } from "../agents/sandbox-pty.js";
import { touchAgentSandbox } from "../agents/sandbox-use.js";
import { AgentSandbox, agentSandboxLayer } from "../agents/terminal/agent-sandbox.js";
import type { GitHubApp } from "../github/github-app.js";
import type { RelayDependencies } from "./relay.js";

/** What the relay's dependencies answer over: the agents' image among it, which a sandbox is made again from. */
export type RelayServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | AgentImage
  | Sandbox;

/** The relay's dependencies over the services the runtime holds now. */
export const relayDependencies: Effect.Effect<RelayDependencies, never, RelayServices> = Effect.gen(
  function* () {
    const context = yield* Effect.context<RelayServices>();
    const sandboxes = yield* Sandbox;
    const run = <A, E>(effect: Effect.Effect<A, E, RelayServices>) =>
      Effect.provideContext(effect, context);
    const sandbox = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* AgentSandbox;
      }),
      agentSandboxLayer,
    );
    return {
      reach: (userId, agentId) =>
        run(
          Effect.gen(function* () {
            const found = yield* readVisibleAgent(userId, agentId);
            if (Option.isNone(found) || found.value.archivedAt !== null) return Option.none();
            const agent = found.value;
            // Note that a shell in an agent on its starter's own GitHub token is its starter's alone.
            if (!controlsAgent(userId, agent)) return Option.none();
            // An agent with no repository opens no sandbox for a shell to reach.
            if (!hasRepository(agent)) return Option.none();
            const target = { userId: agent.userId, conversationId: agent.conversationId };
            const [session] = yield* standingSessionsOf(agent.userId, [agent.conversationId]);
            return Option.some({
              userId: agent.userId,
              conversationId: agent.conversationId,
              sessionId: session?.sessionId,
              repositoryCredential: run(agentRepositoryToken(target, agent)),
              memberToken: agent.githubAccess === GITHUB_ACCESS.TOKEN,
            });
          }),
        ),
      sandbox,
      connect: (shell) => connectPty(sandboxes, shell),
      touch: (sessionId) => run(touchAgentSandbox(agentSandboxName(sessionId))),
      claimRenewal: (conversationId, sandboxSessionId, now, renewedBefore) =>
        run(claimCredentialRenewal(conversationId, sandboxSessionId, now, renewedBefore)).pipe(
          Effect.orElseSucceed(() => false),
        ),
      renewedAt: (conversationId, sandboxSessionId) =>
        run(credentialRenewedAt(conversationId, sandboxSessionId)).pipe(
          Effect.catch(() =>
            Effect.as(
              Effect.logWarning("a terminal's credential renewal was not read"),
              Option.none(),
            ),
          ),
        ),
      releaseRenewal: (conversationId, sandboxSessionId, claimedAt) =>
        run(releaseCredentialRenewal(conversationId, sandboxSessionId, claimedAt)).pipe(
          Effect.catch(() => Effect.logWarning("a terminal's credential claim was not given back")),
        ),
    };
  },
);
