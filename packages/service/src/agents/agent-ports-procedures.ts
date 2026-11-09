/**
 * agent-ports-procedures.ts -- the TCP ports a server listens on in a coding agent's cloud sandbox, for a member's Forward to localhost control, on the hosted oRPC router.
 *
 * The agent is reached by the Terminal tab's own rule
 * (`terminal/sandbox-reach.ts`): a member of its workspace, its starter
 * alone for one on the starter's own GitHub token, and an archived agent
 * gone; every other account reads it as none. The ports are read from the
 * running sandbox each time they are asked (`terminal/listening-ports.ts`),
 * one look at where the sandbox stands and one short command in it, so the
 * desktop polls this every few seconds while the control is open or
 * forwarding is on. A sandbox that is not running, stopped or never opened,
 * is never woken here, and answers so with no ports; an agent on a Mac has
 * no sandbox, and answers the same.
 *
 * One port may be shared, only from a running sandbox: a share is refused as
 * stopped otherwise, and the link lives only while the sandbox runs. The
 * sandbox's own route to the port is never handed out: the link answered is
 * the agent's preview host (`previews/preview-links.ts`), which only a
 * signed-in member who reaches the agent can open, on a deployment with the
 * page sandbox; one without it, a Preview or a local run, answers the route.
 * The share is read back from the sandbox's routes.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import type { Sandbox, SandboxError } from "@repo/sandbox";
import { Effect, type Layer } from "effect";
import type { HttpClient } from "effect/http";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { PageLinks } from "../pages/page-links.js";
import { previewOrigin } from "../previews/preview-links.js";
import { AgentSandbox, type AgentSandboxService } from "./terminal/agent-sandbox.js";
import { reachedAgentSession, sandboxOrUpstream } from "./terminal/sandbox-reach.js";

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
  /** The session of the agent's cloud sandbox the caller reaches; none for an agent on a Mac or one that has not run. */
  const cloudSession = (userId: string, id: string) =>
    Effect.map(reachedAgentSession(userId, id), (reached) => ({
      sessionId: reached.machine === AGENT_MACHINE.DEVICE ? undefined : reached.sessionId,
    }));
  /** One call on the agent's sandbox, a failure of the sandbox's refused as upstream. */
  const onSandbox = <A>(call: (sandbox: AgentSandboxService) => Effect.Effect<A, SandboxError>) =>
    Effect.provide(
      Effect.gen(function* () {
        return yield* sandboxOrUpstream(call(yield* AgentSandbox));
      }),
      seams.sandbox,
    );
  /** The link a member is handed for the agent's shared port: its preview host where the deployment has one, the route otherwise. */
  const linkOf = (agentId: string, route: string) =>
    Effect.gen(function* () {
      const { sandbox } = yield* PageLinks;
      return sandbox === undefined ? route : `${previewOrigin(sandbox, agentId)}/`;
    });
  return {
    /** The ports listened on in the agent's sandbox, and whether it is running. */
    list: signedIn.list.effect(function* ({ input, context }) {
      const { sessionId } = yield* cloudSession(context.userId, input.id);
      if (sessionId === undefined) return { running: false, ports: [] };
      return yield* onSandbox((sandbox) => sandbox.listeningPorts(sessionId));
    }),
    /** The port shared by a public link; a sandbox not running is refused as stopped. */
    share: signedIn.share.effect(function* ({ input, context }) {
      const { sessionId } = yield* cloudSession(context.userId, input.params.id);
      if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.SANDBOX_STOPPED);
      const url = yield* onSandbox((sandbox) => sandbox.share(sessionId, input.body.port));
      if (url === undefined) return yield* Effect.fail(HOSTED_REFUSAL.SANDBOX_STOPPED);
      return { url: yield* linkOf(input.params.id, url) };
    }),
    /** The shared port's link closed. */
    unshare: signedIn.unshare.effect(function* ({ input, context }) {
      const { sessionId } = yield* cloudSession(context.userId, input.id);
      if (sessionId !== undefined) yield* onSandbox((sandbox) => sandbox.unshare(sessionId));
      return { shared: null };
    }),
    /** The port shared now and its link. */
    shared: signedIn.shared.effect(function* ({ input, context }) {
      const { sessionId } = yield* cloudSession(context.userId, input.id);
      if (sessionId === undefined) return { shared: null };
      const shared = yield* onSandbox((sandbox) => sandbox.shared(sessionId));
      if (shared === null) return { shared: null };
      return { shared: { port: shared.port, url: yield* linkOf(input.id, shared.url) } };
    }),
  };
}
