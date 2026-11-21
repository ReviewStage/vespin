/**
 * runs-on-places.ts -- where a start may run its agent, as a phone's Runs on lists the places: the cloud, the member's own devices, and the machines the workspace owns, each its own kind of place.
 *
 * The panel's Machine picker (`@repo/panel`'s `runs-on.tsx`) lists the
 * cloud, then the member's devices, then under Workspace machines those
 * the workspace owns, and a pick of one of those is sent as the workspace's
 * machine (`AGENT_MACHINE.WORKSPACE`), never as a device, since the service
 * places, pays for, and steers the two apart. A picker that lists its
 * places as rows by id, as the iPhone's menus do, reads them here, each
 * with the place a start names, so no row's id is ever read back into a
 * kind of machine. A workspace's machine that takes no agent now, offline,
 * still setting up, or failed, is left out, as a device still setting up
 * is, since the service would refuse it.
 */

import { AGENT_MACHINE, type AgentRunsOnRequest, DEVICE_STANDING } from "./agent-wire.js";
import type { DevicePlatform } from "./device-agent-wire.js";
import type { MacOffer } from "./models-wire.js";
import { RUNS_ON_WORDS } from "./task-agents-model.js";
import {
  type WorkspaceMachineLine,
  type WorkspaceMachineStanding,
  workspaceMachineStanding,
} from "./workspace-machine-view.js";

/** The row the cloud stands as, beside each machine's id, which is a uuid. */
const CLOUD_ROW = "cloud";

/** Where a start runs its agent until another place is picked: the cloud, which a start names by naming none. */
export const IN_THE_CLOUD: AgentRunsOnRequest = { machine: AGENT_MACHINE.VERCEL };

/** The standings in which a workspace's machine takes no agent, so it is not offered. */
const TAKES_NO_AGENT: ReadonlySet<WorkspaceMachineStanding> = new Set([
  DEVICE_STANDING.OFFLINE,
  DEVICE_STANDING.SETTING_UP,
  DEVICE_STANDING.FAILED,
]);

/** One place a start may run its agent: its row's id, its name, the platform of the machine it is, none for the cloud, and the place a start that picks it names. */
export interface RunsOnPlace {
  readonly id: string;
  readonly label: string;
  readonly platform: DevicePlatform | undefined;
  readonly runsOn: AgentRunsOnRequest;
}

/** The places in their groups: the cloud and the member's own devices, then those the workspace owns, under Workspace machines. */
export interface RunsOnPlaces {
  readonly own: readonly RunsOnPlace[];
  readonly shared: readonly RunsOnPlace[];
}

/** The places a start may run its agent among the member's `devices` that may run one and the machines `owned` the workspace owns, on the terms the header says. */
export function runsOnPlaces(
  devices: readonly MacOffer[],
  owned: readonly WorkspaceMachineLine[],
): RunsOnPlaces {
  return {
    own: [
      { id: CLOUD_ROW, label: RUNS_ON_WORDS.CLOUD, platform: undefined, runsOn: IN_THE_CLOUD },
      ...devices.map((device) => ({
        id: device.deviceId,
        label: device.name,
        platform: device.platform,
        runsOn: { machine: AGENT_MACHINE.DEVICE, deviceId: device.deviceId },
      })),
    ],
    shared: owned.flatMap((machine) =>
      TAKES_NO_AGENT.has(workspaceMachineStanding(machine))
        ? []
        : [
            {
              id: machine.id,
              label: machine.name,
              platform: machine.platform,
              runsOn: { machine: AGENT_MACHINE.WORKSPACE, deviceId: machine.id },
            },
          ],
    ),
  };
}

/** Every place, in the order they are listed. */
export function everyPlace(places: RunsOnPlaces): readonly RunsOnPlace[] {
  return [...places.own, ...places.shared];
}

/** The row a start's place stands as: the cloud's, or its machine's by id. */
export function placeIdOf(runsOn: AgentRunsOnRequest): string {
  return runsOn.machine === AGENT_MACHINE.VERCEL ? CLOUD_ROW : runsOn.deviceId;
}

/** The place of `places` whose row is `id`; none for a row no longer offered. */
export function placeOfId(places: RunsOnPlaces, id: string): RunsOnPlace | undefined {
  return everyPlace(places).find((place) => place.id === id);
}

/** What a place picked that is no longer offered, such as a machine removed meanwhile, is said as, as an agent's row says its machine gone; the cloud is always offered. */
export function gonePlaceWords(runsOn: AgentRunsOnRequest): string {
  switch (runsOn.machine) {
    case AGENT_MACHINE.VERCEL:
      return RUNS_ON_WORDS.CLOUD;
    case AGENT_MACHINE.DEVICE:
      return RUNS_ON_WORDS.REMOVED;
    case AGENT_MACHINE.WORKSPACE:
      return RUNS_ON_WORDS.REMOVED_MACHINE;
  }
}
