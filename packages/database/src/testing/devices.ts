/**
 * devices.ts -- a synthetic Mac's layout, as a test registers a device with one, and a machine a workspace owns.
 */

import { randomUUID } from "node:crypto";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  MACHINE_NETWORK,
  MACHINE_OWNER,
} from "@repo/features/device-agent-wire";
import { HOST_VERSION_FOR } from "@repo/features/host-wire";
import { Effect } from "effect";
import type { DeviceRegistration } from "../models/device-store.js";
import {
  approveHostPairing,
  HOST_PAIRING_APPROVAL,
  HOST_PAIRING_GUESS,
  openHostPairing,
  pollHostPairing,
} from "../models/host-pairing-store.js";

/** A Mac's platform, home, temp, and attachments folders, and bundled CLI, synthetic. */
export const DEVICE_LAYOUT: DeviceRegistration = {
  platform: DEVICE_PLATFORM.DARWIN,
  arch: DEVICE_ARCH.ARM64,
  home: "/Users/fixture",
  tempFolder: "/var/folders/fx/fixture/T/vespin",
  attachmentsFolder: "/Users/fixture/.local/state/vespin-host/attachments",
  claudeExecutable: "/Applications/Vespin.app/Contents/Resources/claude-code/cli.js",
};

/** The daemon version a test box pairs with, the first a workspace may own. */
const WORKSPACE_BOX_VERSION = HOST_VERSION_FOR.WORKSPACE_MACHINE;

/**
 * A Linux box the workspace owns, approved for it by the account given as
 * its admins approve one, its agents kept to the open internet: its pairing
 * opened, approved to the workspace, and, where a secret hash is given,
 * collected under that hash as its box's poll collects it; its id. Note
 * that whether the account may connect it is the service's to judge, not
 * the store's.
 */
export const connectWorkspaceMachine = (
  workspaceId: string,
  connectedBy: string,
  secretHash: string | null = null,
) =>
  Effect.gen(function* () {
    const id = randomUUID();
    const userCode = randomUUID();
    const pollSecretHash = `poll-${randomUUID()}`;

    yield* openHostPairing({
      pollSecretHash,
      userCode,
      name: "build-box",
      platform: DEVICE_PLATFORM.LINUX,
      arch: DEVICE_ARCH.X64,
      version: WORKSPACE_BOX_VERSION,
      machineId: randomUUID(),
      ip: null,
    });

    const approved = yield* approveHostPairing(connectedBy, userCode, id, {
      kind: MACHINE_OWNER.WORKSPACE,
      workspaceId,
      network: MACHINE_NETWORK.PUBLIC_ONLY,
    });

    if (
      approved.guess !== HOST_PAIRING_GUESS.FOUND ||
      approved.found.approval !== HOST_PAIRING_APPROVAL.APPROVED
    ) {
      return yield* Effect.die(new Error("A test box's pairing was not approved."));
    }

    if (secretHash !== null) yield* pollHostPairing(pollSecretHash, secretHash);

    return id;
  });
