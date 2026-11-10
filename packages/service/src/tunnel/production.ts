/**
 * production.ts -- the tunnel's dependencies as the deployment stands them: the agent read by the one rule, its sandbox's PTY minted through `Sandbox` and reached by WebSocket (`sandbox-pty.ts`), and the touch.
 *
 * Each dependency answers over the services the function's runtime holds,
 * captured once as the service stands, so the relay itself requires none.
 * A touch the sandbox did not confirm is logged, since the next tries again.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { hasRepository, readVisibleAgent } from "@repo/database/models/agent-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { Sandbox } from "@repo/sandbox";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { controlsAgent } from "../agents/agent-reach.js";
import { agentSandboxName } from "../agents/agent-sandbox-open.js";
import type { AgentImage } from "../agents/coder-host/agent-image.js";
import { connectPty } from "../agents/sandbox-pty.js";
import { touchAgentSandbox } from "../agents/sandbox-use.js";
import { AgentSandbox, agentSandboxLayer } from "../agents/terminal/agent-sandbox.js";
import type { TunnelDependencies } from "./relay.js";

/** What the tunnel's dependencies answer over: the agents' image among it, which a sandbox is made again from. */
export type TunnelServices = DatabaseServices | HttpClient.HttpClient | AgentImage | Sandbox;

/** The tunnel's dependencies over the services the runtime holds now. */
export const tunnelDependencies: Effect.Effect<TunnelDependencies, never, TunnelServices> =
  Effect.gen(function* () {
    const context = yield* Effect.context<TunnelServices>();
    const sandboxes = yield* Sandbox;
    const run = <A, E>(effect: Effect.Effect<A, E, TunnelServices>) =>
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
            // Note that a tunnel into an agent on its starter's own GitHub token is its starter's alone, as its Terminal is.
            if (!controlsAgent(userId, agent)) return Option.none();
            // An agent with no repository opens no sandbox for a tunnel to reach.
            if (!hasRepository(agent)) return Option.none();
            const [session] = yield* standingSessionsOf(agent.userId, [agent.conversationId]);
            return Option.some({ sessionId: session?.sessionId });
          }),
        ),
      open: (sessionId) => sandbox.open(sessionId),
      connect: (shell) => connectPty(sandboxes, shell),
      touch: (sessionId) => run(touchAgentSandbox(agentSandboxName(sessionId))),
    };
  });
