import { expect, it } from "vitest";
import { DEVICE_PLATFORM, DEVICE_SETUP } from "./device-agent-wire.js";
import type { MacOffer } from "./models-wire.js";
import { runsOnPlaces } from "./runs-on-places.js";
import type { WorkspaceMachineLine } from "./workspace-machine-view.js";

/**
 * runs-on-places.test.ts -- a phone's Runs on sends a workspace's machine as
 * the workspace's, never as a device, and leaves out one that takes no agent.
 * Synthetic machines.
 */

const LAPTOP: MacOffer = {
  deviceId: "1d6e2c4a-8b0f-4e1a-9c3d-5f7a9b1c3e01",
  name: "Ada's MacBook Pro",
  providers: [],
  platform: DEVICE_PLATFORM.DARWIN,
};

/** One of the workspace's machines, ready unless a field says otherwise. */
function owned(id: string, name: string, extra: Partial<WorkspaceMachineLine> = {}) {
  const machine: WorkspaceMachineLine = {
    id,
    name,
    platform: DEVICE_PLATFORM.LINUX,
    connectedBy: null,
    calledIn: true,
    away: false,
    ...extra,
  };

  return machine;
}

it("offers the cloud and the member's devices apart from the workspace's ready machines, each sent as its own kind", () => {
  const places = runsOnPlaces(
    [LAPTOP],
    [
      owned("5c0f6c84-2a7e-4d1b-9e3f-0b8d6a4c2e71", "build-01"),
      owned("5c0f6c84-2a7e-4d1b-9e3f-0b8d6a4c2e72", "build-02", { away: true }),
      owned("5c0f6c84-2a7e-4d1b-9e3f-0b8d6a4c2e73", "Team Mac Studio", {
        setup: DEVICE_SETUP.PREPARING,
      }),
      owned("5c0f6c84-2a7e-4d1b-9e3f-0b8d6a4c2e74", "build-03", { setup: DEVICE_SETUP.FAILED }),
    ],
  );

  expect(places.own.map((place) => place.runsOn)).toEqual([
    { machine: "vercel" },
    { machine: "device", deviceId: LAPTOP.deviceId },
  ]);

  expect(places.shared.map(({ label, runsOn }) => ({ label, runsOn }))).toEqual([
    {
      label: "build-01",
      runsOn: { machine: "workspace", deviceId: "5c0f6c84-2a7e-4d1b-9e3f-0b8d6a4c2e71" },
    },
  ]);
});
