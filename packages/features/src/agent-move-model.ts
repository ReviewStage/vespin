/**
 * agent-move-model.ts -- where an agent may be moved in place, between the cloud and the member's own devices, and what each place says under its name, as the panel's Move to › and the iPhone's agent page both offer it.
 *
 * A move keeps the agent, its transcript, its branch and its pull request,
 * and changes only where it runs (the service's `coder-host/move.ts`). An
 * agent in the cloud may go to any of the member's devices; one on a device
 * may go to the cloud or another device, bringing only what it pushed; one
 * on a device the service did not name is offered the cloud alone, since
 * any device listed may be the one it runs on. An agent still writing is
 * stopped first, as Stop does, and moved once the Stop took.
 */

import { AGENT_MACHINE, type AgentRunsOnRequest, type AgentSummary } from "./agent-wire.js";
import type { MacOffer } from "./models-wire.js";
import { agentStillWriting } from "./task-agents-model.js";

/** What a move's places say beyond their names. */
export const MOVE_WORDS = {
  PUSHED_ONLY: "Only pushed work comes along",
  STOPS_FIRST: "Stops the agent first",
  STOPS_FIRST_PUSHED_ONLY: "Stops the agent first; only pushed work comes along",
} as const;

/** The cloud, as a move names it. */
export const TO_THE_CLOUD: AgentRunsOnRequest = { machine: AGENT_MACHINE.VERCEL };

/** The agent a move is offered on, as its places are read from it. */
export type MovedAgent = Pick<AgentSummary, "id" | "status" | "archivedAt" | "machine" | "mac">;

/** No devices, held steady for an agent offered none. */
const NO_DEVICES: readonly MacOffer[] = [];

/** What each place says under its name: that the agent is stopped first while it writes, and that only pushed work comes along from a device; none where neither holds. */
export function moveDetail(agent: MovedAgent): string | undefined {
  const pushedOnly = agent.machine === AGENT_MACHINE.DEVICE;

  if (!agentStillWriting(agent.status)) return pushedOnly ? MOVE_WORDS.PUSHED_ONLY : undefined;

  return pushedOnly ? MOVE_WORDS.STOPS_FIRST_PUSHED_ONLY : MOVE_WORDS.STOPS_FIRST;
}

/** Where an agent may be moved: the cloud, where it runs on a device, and the member's devices but its own, none of them where the service did not name its device. */
export interface MovePlaces {
  readonly cloud: boolean;
  readonly devices: readonly MacOffer[];
}

/** The places `agent` may be moved to among the member's `devices`, on the terms the header says. */
export function movePlaces(agent: MovedAgent, devices: readonly MacOffer[]): MovePlaces {
  const local = agent.machine === AGENT_MACHINE.DEVICE;
  const here = local ? agent.mac?.deviceId : undefined;

  return {
    cloud: local,
    devices:
      local && here === undefined ? NO_DEVICES : devices.filter((each) => each.deviceId !== here),
  };
}
