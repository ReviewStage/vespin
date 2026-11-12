/**
 * port-tools.ts -- the tools a coding agent lists the ports listening in its own cloud sandbox by, and shares one by link, so it can hand the developer a preview.
 *
 * `list_ports` and `share_port` are doors over the one ports operation
 * (`agent-ports.ts`) that the hosted `agentPorts` procedures run too: each
 * reaches the agent's sandbox as the member the call acts for, by the
 * Terminal tab's rule, so a tool reaches no sandbox its member's own
 * controls would not. A coding agent's call names no agent and acts on its
 * own (`../tool-catalog/catalog.ts`), and the catalog offers both only to an
 * agent in a sandbox of ours. Sharing answers the agent's members-only
 * preview host, as the member's own Share does, replaces any port shared
 * before, and lives only while the sandbox runs; a `share_port` of null
 * closes it. The member MCP server's `list_agent_ports` and
 * `share_agent_port` run these same calls on an agent its input names, as
 * the admitted member (`../member-mcp/tools.ts`); its list reads the shared
 * link back beside the ports. Every answer is data the model reads, never a
 * credential.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { portShareRequestSchema } from "@repo/features/listening-ports-wire";
import { FORWARD_PORT } from "@repo/features/sandbox-tunnel-wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  type UnparsedWireValue,
  type WireRecord,
} from "../core.js";
import type { HostedRefusal } from "../http/http-effect.js";
import type { PageLinks } from "../pages/page-links.js";
import {
  listAgentPorts,
  shareAgentPort,
  sharedAgentPort,
  unshareAgentPort,
} from "./agent-ports.js";
import { agentToolRejected } from "./agent-tools.js";
import type { AgentSandbox } from "./terminal/agent-sandbox.js";

/** Why a call changed nothing, in words the model can act on. */
export const PORT_TOOL_REFUSAL = {
  UNREADABLE_SHARE:
    `Not shared: give a port from ${FORWARD_PORT.MIN} to ${FORWARD_PORT.MAX}, as ` +
    `${AGENT_TOOL.LIST_PORTS} lists them, or null to stop sharing.`,
  STOPPED: "Not shared: the sandbox is not running, so no link can open on it.",
  SNAPSHOT_GONE: "Not run: the sandbox's snapshot is gone, so nothing in it can be reached.",
  UNREACHED: "Not run: the sandbox is not one you may reach.",
  UNAVAILABLE: "Not run: the sandbox could not be reached just now. The call may be made again.",
} as const;

/** Each refusal of the ports operation in the words above; any other is the sandbox unavailable. */
const REFUSAL_WORDS = new Map<HostedRefusal["error"], string>([
  [HOSTED_API_ERROR.SANDBOX_STOPPED, PORT_TOOL_REFUSAL.STOPPED],
  [HOSTED_API_ERROR.SANDBOX_SNAPSHOT_GONE, PORT_TOOL_REFUSAL.SNAPSHOT_GONE],
  [HOSTED_API_ERROR.NOT_FOUND, PORT_TOOL_REFUSAL.UNREACHED],
  [HOSTED_API_ERROR.NOT_PERMITTED, PORT_TOOL_REFUSAL.UNREACHED],
  [HOSTED_API_ERROR.AGENT_RETIRED, PORT_TOOL_REFUSAL.UNREACHED],
]);

const LIST_PORTS_INPUT = Schema.Struct({});

const SHARE_PORT_INPUT = Schema.Struct({
  port: describeWire(
    Schema.NullOr(portShareRequestSchema.fields.port),
    `The port to share, one a server listens on as ${AGENT_TOOL.LIST_PORTS} lists them; null to ` +
      "stop sharing.",
  ),
});

const readShareAsked = Schema.decodeUnknownResult(SHARE_PORT_INPUT);

/** The tools as every coding agent in a sandbox of ours is offered them: each its name, its words, and its input schema. */
export const LIST_PORTS_TOOL = {
  name: AGENT_TOOL.LIST_PORTS,
  description:
    "List the TCP ports a server listens on in your own sandbox, such as a dev server you " +
    `started, the lowest first, to choose one to share with ${AGENT_TOOL.SHARE_PORT}. Answers ` +
    "`accepted` with whether your sandbox is running, its ports, and labels saying what serves " +
    "each port where it could be read (such as `storybook dev`), or `rejected` and why.",
  inputSchema: LIST_PORTS_INPUT,
} as const;

export const SHARE_PORT_TOOL = {
  name: AGENT_TOOL.SHARE_PORT,
  description:
    "Share a port of your own sandbox by a link, so the developer can open a running app, " +
    "such as a dev server you started, from their own browser: a member of your workspace " +
    "who can reach you opens it signed in. One port is shared at a time: " +
    "sharing another replaces the first, and the link lives only while your sandbox runs. " +
    "Pass null to stop sharing. Answers `accepted` with the port and its link, or with shared " +
    "null once sharing stopped, or `rejected` and why.",
  inputSchema: SHARE_PORT_INPUT,
} as const;

/** The agent whose sandbox a call reaches, by its id, and the member the call reaches it as. */
export interface PortsReach {
  readonly userId: string;
  readonly agentId: string;
}

/** What a tool answers: the operation's answer as accepted, or its refusal in words. */
function answered<A extends object>(
  operation: Effect.Effect<A, HostedRefusal, AgentSandbox | DatabaseServices | PageLinks>,
): Effect.Effect<WireRecord, never, AgentSandbox | DatabaseServices | PageLinks> {
  return operation.pipe(
    Effect.map((answer) => ({ status: ACTION_RESULT_STATUS.ACCEPTED, ...answer })),
    Effect.catch((refusal) =>
      Effect.succeed(
        agentToolRejected(REFUSAL_WORDS.get(refusal.error) ?? PORT_TOOL_REFUSAL.UNAVAILABLE),
      ),
    ),
  );
}

/** One call of `list_ports`: the ports listened on in the agent's sandbox, and whether it runs. */
export function runListPorts(
  reach: PortsReach,
): Effect.Effect<WireRecord, never, AgentSandbox | DatabaseServices | PageLinks> {
  return answered(listAgentPorts(reach.userId, reach.agentId));
}

/** One call of a member's `list_agent_ports`: the ports as `list_ports` answers them, and the port shared now with its link, so the link is read back. */
export function runListPortsShared(
  reach: PortsReach,
): Effect.Effect<WireRecord, never, AgentSandbox | DatabaseServices | PageLinks> {
  return answered(
    Effect.zipWith(
      listAgentPorts(reach.userId, reach.agentId),
      sharedAgentPort(reach.userId, reach.agentId),
      (listed, shared) => ({ ...listed, ...shared }),
    ),
  );
}

/** One call of `share_port`: the port shared by link, answering it with its link, or the share closed. */
export function runSharePort(
  reach: PortsReach,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentSandbox | DatabaseServices | PageLinks> {
  const asked = readShareAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(PORT_TOOL_REFUSAL.UNREADABLE_SHARE));
  }

  const { port } = asked.success;

  if (port === null) return answered(unshareAgentPort(reach.userId, reach.agentId));

  return answered(
    Effect.map(shareAgentPort(reach.userId, reach.agentId, port), ({ url }) => ({ port, url })),
  );
}
