/**
 * workspace-machine-reads.ts -- whether the build asking reads an agent on a machine its workspace owns.
 *
 * A build before `HOSTED_API_VERSION` 7 reads an agent's machine only as
 * the cloud or a device, so the service keeps an agent on a workspace's
 * machine (`AGENT_MACHINE.WORKSPACE`), and what belongs to it, out of every
 * answer to such a build: its lists leave the agent out, a read of it by
 * its id is not found, and its live reads leave it out through a param
 * (`WORKSPACE_MACHINE_LIVE`). Note that the agent is never told to such a
 * build as a device or the cloud, which it is not. A request that names no
 * version, a build from before the headers, is one of those.
 */

import { AGENT_MACHINE, type AgentMachineKind } from "@repo/features/agent-wire";
import { presentedClient } from "@repo/features/client-identity";

/** The first hosted API version whose builds read an agent on a workspace's machine (`client-identity.ts`'s `HOSTED_API_VERSION`). */
const WORKSPACE_MACHINE_API_VERSION = 7;

/** Whether the build asking can decode an agent on a workspace's machine in an answer. */
export function readsWorkspaceMachines(request: Request): boolean {
  const client = presentedClient(request.headers);

  return client !== undefined && client.apiVersion >= WORKSPACE_MACHINE_API_VERSION;
}

/** Whether an agent is one the build asking reads (`readsWorkspaceMachines`), by where it runs. */
export function servesAgent(
  request: Request,
  agent: { readonly machine?: AgentMachineKind | undefined },
): boolean {
  return agent.machine !== AGENT_MACHINE.WORKSPACE || readsWorkspaceMachines(request);
}

/** Whether a live read carries what stands on a workspace's machine, as a param the service binds from the build asking (`LIVE_PARAM.SERVED`), since a param is text. */
export const WORKSPACE_MACHINE_LIVE = {
  CARRIED: "carried",
  LEFT_OUT: "leftOut",
} as const;

export type WorkspaceMachineLive =
  (typeof WORKSPACE_MACHINE_LIVE)[keyof typeof WORKSPACE_MACHINE_LIVE];

/** Whether a live read carries what stands on a workspace's machine to the build asking (`readsWorkspaceMachines`), as the param it binds. */
export function workspaceMachineLiveParam(request: Request): WorkspaceMachineLive {
  return readsWorkspaceMachines(request)
    ? WORKSPACE_MACHINE_LIVE.CARRIED
    : WORKSPACE_MACHINE_LIVE.LEFT_OUT;
}
