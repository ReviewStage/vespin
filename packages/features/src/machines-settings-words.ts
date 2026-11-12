/**
 * machines-settings-words.ts -- what Settings › Machines says of the member's machines, and where each stands, on the desktop, the web, and the iOS app alike.
 *
 * A machine is setting up while it joins, fetches its agents' tools, or
 * updates; failed where its setup failed or it never called in within
 * `CALL_IN_CEILING_MS` of joining; offline while the service's sweep marks
 * it away; and online otherwise (`hostStanding`).
 */

import { DEVICE_STANDING, type DeviceStanding } from "./agent-wire.js";
import { DEVICE_SETUP, HOST_UPDATE } from "./device-agent-wire.js";
import type { HostLine } from "./host-live.js";
import { PRODUCT_NAME } from "./product-name.js";

/** How long a host may take to call in after joining before it reads failed. */
const CALL_IN_CEILING_MS = 10 * 60 * 1_000;

/** What the page and a machine's Remove say. */
export const MACHINES_WORDS = {
  TITLE: "Your machines",
  NONE: "No machines yet.",
  REMOVE: "Remove",
  REMOVE_FAILED: "Could not remove this machine. Try again.",
  /** What Remove adds for a machine that reads offline, which hears it was removed only once it is online again, and the command for one that never is. */
  REMOVED_OFFLINE:
    "It's offline, so it does that the next time it's online. If it won't be, run this on it:",
  UNINSTALL_FIELD: "Uninstall command",
} as const;

/** What a machine's line leads with, by where it stands; a standing not yet told says nothing. */
export const MACHINE_STANDING_WORDS = {
  [DEVICE_STANDING.ONLINE]: "Online",
  [DEVICE_STANDING.OFFLINE]: "Offline",
  [DEVICE_STANDING.SETTING_UP]: "Setting up…",
  [DEVICE_STANDING.FAILED]: "Failed",
} as const satisfies Partial<Record<DeviceStanding, string>>;

/** Where a machine the account's read names stands, which its line leads with. */
export type HostStanding = keyof typeof MACHINE_STANDING_WORDS;

/** What Remove asks of the machine called `label`: the host removes itself from the machine as it hears so (`apps/host`'s `removeItself`). */
export function removeMachineQuestion(label: string) {
  return {
    title: `Remove ${label}?`,
    body: `It stops taking agents now, and ${PRODUCT_NAME} removes itself from the machine, keeping its agents' folders in ~/.vespin/agents. Their tasks and transcripts stay in ${PRODUCT_NAME}.`,
    verb: MACHINES_WORDS.REMOVE,
    running: "Removing",
  } as const;
}

/** Where a host's setup keeps it from taking an agent at `now`, whatever its presence; none for a host that is ready. */
function setupStanding(host: HostLine, now: number): HostStanding | undefined {
  if (host.update === HOST_UPDATE.UPDATING) return DEVICE_STANDING.SETTING_UP;

  if (host.setup === DEVICE_SETUP.FAILED) return DEVICE_STANDING.FAILED;

  if (host.calledIn === false) {
    const waited = now - (host.joinedAt ?? now);

    return waited > CALL_IN_CEILING_MS ? DEVICE_STANDING.FAILED : DEVICE_STANDING.SETTING_UP;
  }

  return host.setup === DEVICE_SETUP.PREPARING ? DEVICE_STANDING.SETTING_UP : undefined;
}

/** Where a host the account's read names stands at `now`: by its setup, and then whether the sweep marks it away. */
export function hostStanding(host: HostLine, now: number): HostStanding {
  return (
    setupStanding(host, now) ??
    (host.away === true ? DEVICE_STANDING.OFFLINE : DEVICE_STANDING.ONLINE)
  );
}
