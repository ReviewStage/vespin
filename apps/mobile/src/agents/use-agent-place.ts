/**
 * use-agent-place.ts -- the glyph an agent's place stands under, by the kind of machine it runs on, as its row and its Machine chip draw it.
 *
 * The panel's runs-on mark (`@repo/panel`'s `agent-place.tsx`) on the
 * phone: the cloud's for an agent in a sandbox; for one on a member's
 * device, its platform's, as the models' read lists the account's devices
 * (`useDevicePlatform`); and for one on a machine its workspace owns, that
 * machine's platform's, as the workspace's own machines read names it
 * (`useWorkspaceMachines`), so an agent on a teammate's Linux box draws a
 * server rather than a Mac. Each read is followed only for an agent of its
 * kind, so a cloud agent's row reads nothing.
 */

import { AGENT_MACHINE, type AgentSummary, agentMachineOf } from "@repo/features/agent-wire";
import { type Glyph, runsOnGlyph } from "@repo/ui-native";
import { useDevicePlatform } from "../tasks/use-start.js";
import { useOfferedWorkspaceMachines } from "../workspace-machines.js";

/** What an agent's place is read from: the kind of machine it runs on, which one, and its workspace, whose own machines name a workspace machine's platform. */
export type PlacedAgent = Pick<AgentSummary, "machine" | "mac"> & {
  readonly workspaceId: string;
};

/** The glyph the place of the agent `agent` stands under, by the kind of machine it runs on. */
export function useAgentPlaceGlyph(agent: PlacedAgent): Glyph {
  const machine = agentMachineOf(agent);
  const deviceId = agent.mac?.deviceId;
  const devicePlatform = useDevicePlatform(machine === AGENT_MACHINE.DEVICE ? deviceId : undefined);

  const owned = useOfferedWorkspaceMachines(
    machine === AGENT_MACHINE.WORKSPACE ? agent.workspaceId : undefined,
  );

  switch (machine) {
    case AGENT_MACHINE.VERCEL:
      return runsOnGlyph({ cloud: true });
    case AGENT_MACHINE.DEVICE:
      return runsOnGlyph({ cloud: false, platform: devicePlatform });
    case AGENT_MACHINE.WORKSPACE:
      return runsOnGlyph({
        cloud: false,
        platform: owned.find((each) => each.id === deviceId)?.platform,
      });
  }
}
