/**
 * agent-ports-procedures.ts -- the TCP ports a server listens on in a coding agent's cloud sandbox, for a member's Forward to localhost and Share by link controls, on the hosted oRPC router.
 *
 * Each procedure is a door over the one operation (`agent-ports.ts`): the
 * agent its path names, reached as the signed-in account, on the agent's
 * sandbox as the deployment composes it.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { Sandbox } from "@repo/sandbox";
import { Effect, type Layer } from "effect";
import type { HttpClient } from "effect/http";
import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  listAgentPorts,
  shareAgentPort,
  sharedAgentPort,
  unshareAgentPort,
} from "./agent-ports.js";
import type { AgentSandbox } from "./terminal/agent-sandbox.js";

export interface AgentPortsProcedureSeams {
  resolveUserId: UserIdResolver;
  /** The agent's sandbox as the ports are read in it: over the runtime's `Sandbox` in production, a script's in a test. */
  readonly sandbox: Layer.Layer<
    AgentSandbox,
    never,
    HttpClient.HttpClient | DatabaseServices | Sandbox
  >;
}

/** The agent ports resource: its read, and its one shared port, to a signed-in caller. */
export function agentPortsProcedures(seams: AgentPortsProcedureSeams) {
  const signedIn = hosted.agentPorts.use(accountMiddleware(seams.resolveUserId));

  return {
    /** The ports listened on in the agent's sandbox, and whether it is running. */
    list: signedIn.list.effect(function* ({ input, context }) {
      return yield* Effect.provide(listAgentPorts(context.userId, input.id), seams.sandbox);
    }),
    /** The port shared by a public link; a sandbox not running is refused as stopped. */
    share: signedIn.share.effect(function* ({ input, context }) {
      return yield* Effect.provide(
        shareAgentPort(context.userId, input.params.id, input.body.port),
        seams.sandbox,
      );
    }),
    /** The shared port's link closed. */
    unshare: signedIn.unshare.effect(function* ({ input, context }) {
      return yield* Effect.provide(unshareAgentPort(context.userId, input.id), seams.sandbox);
    }),
    /** The port shared now and its link. */
    shared: signedIn.shared.effect(function* ({ input, context }) {
      return yield* Effect.provide(sharedAgentPort(context.userId, input.id), seams.sandbox);
    }),
  };
}
