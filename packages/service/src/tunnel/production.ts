/**
 * production.ts -- the tunnel's dependencies as the deployment stands them: the agent read by the one rule, its sandbox's PTY minted through `Sandbox` and reached by WebSocket (`sandbox-pty.ts`).
 *
 * Each dependency answers over the services the function's runtime holds,
 * captured once as the service stands, so the relay itself requires none.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { Sandbox } from "@repo/sandbox";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import type { AgentImage } from "../agents/coder-host/agent-image.js";
import { connectPty } from "../agents/sandbox-pty.js";
import { AgentSandbox, agentSandboxLayer } from "../agents/terminal/agent-sandbox.js";
import { relayReachedAgent } from "../agents/terminal/sandbox-reach.js";
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
      // Note that a tunnel reaches an agent by its Terminal's rule.
      reach: (userId, agentId) =>
        run(
          Effect.map(
            relayReachedAgent(userId, agentId),
            Option.map(({ sessionId }) => ({ sessionId })),
          ),
        ),
      open: (sessionId) => sandbox.open(sessionId),
      connect: (shell) => connectPty(sandboxes, shell),
    };
  });
