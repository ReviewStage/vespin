/**
 * devices.ts -- a synthetic Mac's layout, as a test registers a device with one, and a machine a workspace owns.
 */

import { randomUUID } from "node:crypto";
import { DEVICE_ARCH, DEVICE_PLATFORM, MACHINE_NETWORK } from "@repo/features/device-agent-wire";
import { DateTime, Effect } from "effect";
import { Database } from "../core/query.js";
import type { DeviceRegistration } from "../models/device-store.js";
import { device } from "../schemas/device.js";

/** A Mac's platform, home, temp, and attachments folders, and bundled CLI, synthetic. */
export const DEVICE_LAYOUT: DeviceRegistration = {
  platform: DEVICE_PLATFORM.DARWIN,
  arch: DEVICE_ARCH.ARM64,
  home: "/Users/fixture",
  tempFolder: "/var/folders/fx/fixture/T/vespin",
  attachmentsFolder: "/Users/fixture/.local/state/vespin-host/attachments",
  claudeExecutable: "/Applications/Vespin.app/Contents/Resources/claude-code/cli.js",
};

/**
 * A Linux box the workspace owns, connected by the account given, its
 * agents kept to the open internet, with the secret hash given where the
 * test reads it by one; its id. Note that it is written straight over the
 * table, since no store function connects a workspace's machine yet.
 */
export const connectWorkspaceMachine = (
  workspaceId: string,
  connectedBy: string,
  secretHash: string | null = null,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(device).values({
      id,
      organizationId: workspaceId,
      connectedBy,
      network: MACHINE_NETWORK.PUBLIC_ONLY,
      name: "build-box",
      platform: DEVICE_PLATFORM.LINUX,
      arch: DEVICE_ARCH.X64,
      secretHash,
      lastSeenAt: now,
    });

    return id;
  });
