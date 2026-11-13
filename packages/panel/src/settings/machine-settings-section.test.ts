// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { MACHINE_COMMAND_MODE } from "@repo/features/machine-command-wire";
import type { MachineLine } from "@repo/features/machine-live";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge, fakeAppBridgeCalls } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { handBeats } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { MachineSettingsSection } from "./machine-settings-section.js";

/**
 * machine-settings-section.test.ts -- Settings › Machines' What agents may
 * do, drawn from the machines the host holds: a change made on a machine's
 * rows is sent for that machine, and only a machine that runs no agents is
 * offered a Remove here. Synthetic ids and names.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installScrollIntoView();
  fakeAppPlatform({ assetBase: () => "https://app.test/" });
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A Mac that runs the account's agents, asking before each command and always allowing Notes. */
const STUDIO: MachineLine = {
  id: "5a7c9e1b-3d5f-4a6b-8c0d-2e4f6a8b0c11",
  name: "Studio",
  platform: DEVICE_PLATFORM.DARWIN,
  host: true,
  listening: true,
  settings: {
    commandMode: MACHINE_COMMAND_MODE.ASK,
    computerUse: true,
    alwaysAllowedApps: ["com.apple.Notes"],
  },
};

/** A laptop that only runs the app, gone quiet. */
const LAPTOP: MachineLine = {
  id: "6b8d0f2c-4e6a-4b7c-9d1e-3f5a7b9c1d22",
  name: "Laptop",
  platform: DEVICE_PLATFORM.DARWIN,
  host: false,
  listening: false,
  settings: { commandMode: MACHINE_COMMAND_MODE.NEVER, computerUse: false, alwaysAllowedApps: [] },
};

/** The machines laid as the host holds them, under the account the window's document names, with Computer use on. */
function holdMachines(machines: readonly MachineLine[]): void {
  // Note that the beats' document names the account signed in, which the machines are laid under.
  handBeats({});
  const handed = fakeAppBridgeCalls().requestAppState;

  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: async () => {
      const snapshot = await (handed ?? assert.fail("a document is handed"))();
      const { account } = snapshot;

      if (account.status !== ACCOUNT_STATUS.SIGNED_IN || account.id === undefined) {
        assert.fail("the window is signed in");
      }

      const settings = snapshot.settings ?? assert.fail("the document holds settings");

      return {
        ...snapshot,
        settings: {
          ...settings,
          experiments: { ...settings.experiments, [EXPERIMENT.COMPUTER_USE]: true },
        },
        [LIVE_READ.MACHINES]: { [account.id]: { rows: machines } },
      };
    },
  });
}

/** Every change the section sent, as the host was asked it. */
async function drawMachines(): Promise<unknown[]> {
  const sent: unknown[] = [];

  fakeActPort({
    [ACT_KIND.MACHINES_CHANGE]: async (change) => {
      sent.push(change);

      return { done: true } as const;
    },
    [ACT_KIND.HOSTS_ALLOWED_APPS]: async () => ({
      machines: [
        {
          deviceId: STUDIO.id,
          name: STUDIO.name,
          apps: ["com.apple.Notes"],
          looks: [{ app: "com.apple.Notes", name: "Notes" }],
        },
      ],
    }),
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(withQueryClient(createElement(MachineSettingsSection, { signedIn: true }))),
  );
  await vi.waitFor(() => assert.ok(pageText().includes("Laptop"), pageText()));

  return sent;
}

/** The page's words. */
function pageText(): string {
  return document.body.textContent ?? "";
}

/** The settings row whose words name `name`. */
function rowOf(name: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>(".ui-settings-row")].find(
      (each) => each.textContent?.startsWith(name) ?? false,
    ) ?? assert.fail(`${name}'s row is drawn`)
  );
}

test("a machine's apps switch and an app's Remove are sent for that machine alone", async () => {
  holdMachines([STUDIO, LAPTOP]);
  const sent = await drawMachines();

  // Note that the app is named by its bundle id until the machine's names for its apps are read.
  const remove = await vi.waitFor(
    () =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Remove Notes"]') ??
      assert.fail("Notes' Remove is drawn"),
  );

  await act(async () => remove.click());

  const switches = [
    ...document.querySelectorAll<HTMLElement>('[aria-label="Let agents use its apps"]'),
  ];

  // The laptop's switch, its machine's second, is off; pressing it turns that machine's on.
  await act(async () => switches[1]?.click());

  assert.deepEqual(sent, [
    { id: STUDIO.id, removeApp: "com.apple.Notes" },
    { id: LAPTOP.id, computerUse: true },
  ]);
});

test("only a machine that runs no agents is offered a Remove here", async () => {
  holdMachines([STUDIO, LAPTOP]);
  await drawMachines();

  assert.equal(rowOf("Studio").querySelector('button[aria-haspopup="menu"]'), null);
  assert.notEqual(rowOf("Laptop").querySelector('button[aria-haspopup="menu"]'), null);
});
