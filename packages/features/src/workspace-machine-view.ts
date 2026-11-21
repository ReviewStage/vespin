import { Option, Schema } from "effect";
import { DEVICE_STANDING } from "./agent-wire.js";
import { workspaceMachinesContract } from "./contract/workspace-machines.js";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  type DeviceArch,
  type DevicePlatform,
  type DeviceSetup,
  MACHINE_NETWORK,
  type MachineNetwork,
} from "./device-agent-wire.js";
import { answerView, HOSTED_CALL_FAILURE } from "./hosted-failure.js";
import { type LiveRowOf, orderedLiveRows } from "./live-read.js";
import { WORKSPACE_MACHINES_READ } from "./workspace-machine-live.js";

/**
 * workspace-machine-view.ts -- the machines a workspace owns as a window draws them: each line its live read answers, where it stands, and what a rename or a remove answers.
 *
 * A workspace's machine is drawn from its live read
 * (`WORKSPACE_MACHINES_READ`), each field this build does not know left
 * out, so a platform or a setup a newer service names hides none of the
 * others. One whose box has yet to collect its secret is left out once the
 * pairing that made it lapses, at the reader's own instant, since a live
 * statement reads no clock (`host-live.ts`'s hosts alike).
 *
 * Where it stands is read off the row alone: failed where its setup
 * failed, setting up while its host program has yet to call in or its
 * setup still prepares, which a workspace's machine does until its agent
 * image is pulled, offline while the service's sweep marks it away, and
 * online otherwise. Note that a member's own device is judged by the
 * window's presence read (`hosts.presence`), which names the account's
 * devices alone, so a workspace's machine is judged by its own row.
 */

/** One machine as the statement delivers it. */
export type WorkspaceMachineLiveRow = LiveRowOf<typeof WORKSPACE_MACHINES_READ.parts.machines>;

/** One machine the workspace owns as a window draws it: its name, platform and architecture, who connected it, the networks its agents may reach, where its setup stands, whether its host program called in, and whether it went away. */
export interface WorkspaceMachineLine {
  readonly id: string;
  readonly name: string;
  readonly platform?: DevicePlatform;
  readonly arch?: DeviceArch;
  /** Who connected it, by account; null once that account is gone. */
  readonly connectedBy: string | null;
  readonly network?: MachineNetwork;
  /** Where its setup stands, absent once it is ready. */
  readonly setup?: DeviceSetup;
  readonly calledIn: boolean;
  readonly away: boolean;
}

const readPlatform = Schema.decodeUnknownOption(Schema.Literals(Object.values(DEVICE_PLATFORM)));
const readArch = Schema.decodeUnknownOption(Schema.Literals(Object.values(DEVICE_ARCH)));
const readNetwork = Schema.decodeUnknownOption(Schema.Literals(Object.values(MACHINE_NETWORK)));
const readSetup = Schema.decodeUnknownOption(Schema.Literals(Object.values(DEVICE_SETUP)));

/** The workspace's machines as the held read answers them at `now`, by name and then id, those whose pairing lapsed uncollected left out. */
export function workspaceMachinesOfLiveRows(
  rows: readonly WorkspaceMachineLiveRow[],
  now: number,
): readonly WorkspaceMachineLine[] {
  return orderedLiveRows(WORKSPACE_MACHINES_READ.parts.machines, rows).flatMap((row) => {
    if (row.pairingLapsesAt !== null && row.pairingLapsesAt <= now) return [];
    const platform = readPlatform(row.platform);
    const arch = readArch(row.arch);
    const network = readNetwork(row.network);
    const setup = readSetup(row.setup);

    return [
      {
        id: row.id,
        name: row.name,
        ...(Option.isSome(platform) ? { platform: platform.value } : undefined),
        ...(Option.isSome(arch) ? { arch: arch.value } : undefined),
        connectedBy: row.connectedBy,
        ...(Option.isSome(network) ? { network: network.value } : undefined),
        ...(Option.isSome(setup) ? { setup: setup.value } : undefined),
        calledIn: row.calledIn,
        away: row.away,
      },
    ];
  });
}

/** The instant after `now` the soonest uncollected machine's pairing lapses, which is when the machines built from `rows` next leave one out with no row moving; none where none will. */
export function nextWorkspaceMachineLapse(
  rows: readonly WorkspaceMachineLiveRow[],
  now: number,
): number | undefined {
  const lapsing = rows.flatMap((row) =>
    row.pairingLapsesAt !== null && row.pairingLapsesAt > now ? [row.pairingLapsesAt] : [],
  );

  return lapsing.length === 0 ? undefined : Math.min(...lapsing);
}

/** Where one of the workspace's machines can stand, each told from its own row. */
export type WorkspaceMachineStanding =
  | typeof DEVICE_STANDING.ONLINE
  | typeof DEVICE_STANDING.OFFLINE
  | typeof DEVICE_STANDING.SETTING_UP
  | typeof DEVICE_STANDING.FAILED;

/** Where one of the workspace's machines stands: by its setup, then whether its host program called in, then whether the sweep marks it away. */
export function workspaceMachineStanding(
  machine: Pick<WorkspaceMachineLine, "setup" | "calledIn" | "away">,
): WorkspaceMachineStanding {
  if (machine.setup === DEVICE_SETUP.FAILED) return DEVICE_STANDING.FAILED;

  if (!machine.calledIn || machine.setup === DEVICE_SETUP.PREPARING) {
    return DEVICE_STANDING.SETTING_UP;
  }

  return machine.away ? DEVICE_STANDING.OFFLINE : DEVICE_STANDING.ONLINE;
}

/** What renaming or removing one of the workspace's machines answers as it crosses to a window: done, with the transaction it was written in, or why not. */
export const workspaceMachineDoneViewSchema = answerView(workspaceMachinesContract.remove);

export type WorkspaceMachineDoneView = typeof workspaceMachineDoneViewSchema.Type;

/** A rename or a remove that reached no answer, as each answers one. */
export const WORKSPACE_MACHINE_UNANSWERED = { failure: HOSTED_CALL_FAILURE.UNANSWERED } as const;
