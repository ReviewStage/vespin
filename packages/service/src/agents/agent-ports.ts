/**
 * agent-ports.ts -- the TCP ports a server listens on in a coding agent's cloud sandbox, and the one shared by link: listed, shared, read back, and closed, for the account that reaches the agent.
 *
 * This is the one implementation every door runs: the hosted `agentPorts`
 * procedures a member's desktop and web call (`agent-ports-procedures.ts`),
 * the agent's own `list_ports` and `share_port` (`port-tools.ts`), which
 * reach its sandbox as the member who started it, and the member MCP
 * server's `list_agent_ports` and `share_agent_port` over them
 * (`../member-mcp/tools.ts`), which reach it as the admitted member. Each
 * door adds only its input, who is asking, and its words.
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
 * stopped otherwise, and the link lives only while the sandbox runs. Sharing
 * another port replaces the first. The sandbox's own route to the port is
 * never handed out: the link answered is the agent's preview host
 * (`../previews/preview-links.ts`), which only a signed-in member who reaches
 * the agent can open, on a deployment with the page sandbox; one without it,
 * a Preview or a local run, answers the route. The share is read back from
 * the sandbox's routes.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import type {
  ListeningPortsAnswer,
  PortShareAnswer,
  SharedPortAnswer,
} from "@repo/features/listening-ports-wire";
import type { SandboxError } from "@repo/sandbox";
import { Effect } from "effect";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";
import { PageLinks } from "../pages/page-links.js";
import { previewOrigin } from "../previews/preview-links.js";
import { AgentSandbox, type AgentSandboxService } from "./terminal/agent-sandbox.js";
import { reachedAgentSession, sandboxOrUpstream } from "./terminal/sandbox-reach.js";

/** One operation on an agent's ports, refused as every sandbox route refuses. */
type PortsEffect<A> = Effect.Effect<A, HostedRefusal, AgentSandbox | DatabaseServices | PageLinks>;

/** The session of the agent's cloud sandbox the account reaches; none for an agent on a Mac or one that has not run. */
const cloudSession = (userId: string, id: string) =>
  Effect.map(reachedAgentSession(userId, id), (reached) =>
    reached.machine === AGENT_MACHINE.DEVICE ? undefined : reached.sessionId,
  );

/** One call on the agent's sandbox, a failure of the sandbox's refused as upstream. */
const onSandbox = <A>(call: (sandbox: AgentSandboxService) => Effect.Effect<A, SandboxError>) =>
  Effect.gen(function* () {
    return yield* sandboxOrUpstream(call(yield* AgentSandbox));
  });

/** The link a member is handed for the agent's shared port: its preview host where the deployment has one, the route otherwise. */
const linkOf = (id: string, route: string) =>
  Effect.gen(function* () {
    const { sandbox } = yield* PageLinks;
    return sandbox === undefined ? route : `${previewOrigin(sandbox, id)}/`;
  });

/** The ports listened on in the agent's sandbox, and whether it is running. */
export function listAgentPorts(userId: string, id: string): PortsEffect<ListeningPortsAnswer> {
  return Effect.flatMap(cloudSession(userId, id), (sessionId) =>
    sessionId === undefined
      ? Effect.succeed({ running: false, ports: [], labels: [] })
      : onSandbox((sandbox) => sandbox.listeningPorts(sessionId)),
  );
}

/** The port shared by link, replacing any shared before; a sandbox not running is refused as stopped. */
export function shareAgentPort(
  userId: string,
  id: string,
  port: number,
): PortsEffect<PortShareAnswer> {
  return Effect.gen(function* () {
    const sessionId = yield* cloudSession(userId, id);
    if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.SANDBOX_STOPPED);
    const url = yield* onSandbox((sandbox) => sandbox.share(sessionId, port));
    if (url === undefined) return yield* Effect.fail(HOSTED_REFUSAL.SANDBOX_STOPPED);
    return { url: yield* linkOf(id, url) };
  });
}

/** The shared port's link closed, whatever the sandbox stands; one never opened shares none. */
export function unshareAgentPort(userId: string, id: string): PortsEffect<SharedPortAnswer> {
  return Effect.gen(function* () {
    const sessionId = yield* cloudSession(userId, id);
    if (sessionId !== undefined) yield* onSandbox((sandbox) => sandbox.unshare(sessionId));
    return { shared: null };
  });
}

/** The port shared now and its link; none where none is shared or the sandbox is not running. */
export function sharedAgentPort(userId: string, id: string): PortsEffect<SharedPortAnswer> {
  return Effect.gen(function* () {
    const sessionId = yield* cloudSession(userId, id);
    if (sessionId === undefined) return { shared: null };
    const shared = yield* onSandbox((sandbox) => sandbox.shared(sessionId));
    if (shared === null) return { shared: null };
    return { shared: { port: shared.port, url: yield* linkOf(id, shared.url) } };
  });
}
