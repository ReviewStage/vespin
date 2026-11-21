// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  MACHINE_NETWORK,
  MACHINE_OWNER,
} from "@repo/features/device-agent-wire";
import { HOST_PAIRING_CALL_FAILURE, type HostPairingView } from "@repo/features/host-pairing-view";
import type { HostPairingAnswer } from "@repo/features/host-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { HostConnectDialog } from "./host-connect-dialog.js";

/**
 * host-connect-dialog.test.ts -- a pairing's link asks whose box it is
 * before anything is pressed: Connect approves the code the link named and
 * closes onto the list, and a code that cannot be approved says what to do
 * next. Where the service offers a workspace for the box, the member picks
 * who it is for and whether its agents reach its private network; where it
 * offers none, the box is theirs alone. Synthetic names, codes, and
 * documentation addresses.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  fakeAppPlatform({ assetBase: () => "https://app.test/" });
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

const CODE = "BCDFGHJK";

const BOX: HostPairingView = {
  name: "fra-03",
  platform: DEVICE_PLATFORM.LINUX,
  arch: DEVICE_ARCH.X64,
  ip: "203.0.113.7",
  expiresAt: 1_800_000_000_000,
};

const WORKSPACE = { id: "workspace-lab", name: "Lab" };

/** The pressable named by its words, which a test expects drawn. */
function pressable(role: string, name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(`[role="${role}"], button`)].find(
    (each) =>
      (each.getAttribute("role") ?? "button") === role &&
      (each.getAttribute("aria-label") ?? each.textContent ?? "").includes(name),
  );

  assert.ok(found !== undefined, `${role} ${name} is drawn`);

  return found;
}

/** The approves sent once the box's read lands with these workspaces offered. */
function approvesFor(workspaces: HostPairingAnswer["workspaces"]): unknown[] {
  const approved: unknown[] = [];
  fakeActPort({
    [ACT_KIND.HOSTS_PAIRING_READ]: () =>
      Promise.resolve(workspaces === undefined ? BOX : { ...BOX, workspaces }),
    [ACT_KIND.HOSTS_PAIRING_APPROVE]: (payload) => {
      approved.push(payload);

      return Promise.resolve({ deviceId: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14" });
    },
  });

  return approved;
}

/** Lets the dialog's read and a press's acts land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** The dialog for the code, drawn and its read landed, and what it told its owner. */
async function opened(): Promise<string[]> {
  const told: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(HostConnectDialog, {
          code: CODE,
          onClose: () => told.push("closed"),
        }),
      ),
    ),
  );
  await settle();
  // Note that the pairing lands through a query, so the dialog is read once it no longer reads it.
  await vi.waitFor(() =>
    assert.equal((document.body.textContent ?? "").includes("Reading the code"), false),
  );

  return told;
}

test("Connect approves the code the link named, once the box it names is shown, as the member's own where no workspace is offered, and closes onto the list", async () => {
  const approved: unknown[] = [];
  fakeActPort({
    [ACT_KIND.HOSTS_PAIRING_READ]: () => Promise.resolve(BOX),
    [ACT_KIND.HOSTS_PAIRING_APPROVE]: (payload) => {
      approved.push(payload);

      return Promise.resolve({ deviceId: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14" });
    },
  });
  const told = await opened();

  const text = document.body.textContent ?? "";
  assert.ok(text.includes("Connect fra-03?"), text);
  assert.ok(text.includes("Linux server, x64, 203.0.113.7"), "the box is shown as it named itself");
  assert.ok(text.includes("BCDF-GHJK"), "the code is shown as the box shows it");
  assert.deepEqual(approved, [], "nothing is approved before Connect is pressed");
  assert.equal(
    document.querySelector('[role="radio"]'),
    null,
    "a box offered no workspace asks no one it is for",
  );

  const connect = [...document.querySelectorAll("button")].find(
    (each) => each.textContent === "Connect",
  );

  assert.ok(connect !== undefined, "Connect is drawn");
  await act(async () => connect.click());
  await settle();

  assert.deepEqual(approved, [{ code: CODE }]);
  assert.deepEqual(told, ["closed"]);
});

test("a code no pairing has, or one held after too many such codes, says so and to run the command again", async () => {
  for (const [refusal, says] of [
    [{ failure: HOST_PAIRING_CALL_FAILURE.NOT_FOUND }, "This code can't be used"],
    [{ failure: HOST_PAIRING_CALL_FAILURE.HELD }, "Too many codes tried"],
  ] as const) {
    fakeActPort({ [ACT_KIND.HOSTS_PAIRING_READ]: () => Promise.resolve(refusal) });
    await opened();
    // Note that the code read last stands while it is read again, so the refusal is read once it is this one's.
    await vi.waitFor(() => assert.equal((document.body.textContent ?? "").includes(says), true));

    const text = document.body.textContent ?? "";
    assert.ok(text.includes(says), text);
    assert.ok(text.includes("Run the command on the machine again for a new code."), text);
    assert.ok(
      ![...document.querySelectorAll("button")].some((each) => each.textContent === "Connect"),
      "nothing offers to approve it",
    );

    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.replaceChildren();
  }
});

test("a workspace picked for the box connects it as that workspace's, its private network off until switched on", async () => {
  const approved = approvesFor([WORKSPACE]);
  await opened();

  assert.equal(pressable("radio", "Just me").getAttribute("aria-checked"), "true");
  assert.equal(
    document.querySelector('[role="switch"]'),
    null,
    "the network is asked only of a workspace",
  );

  await act(async () => pressable("radio", "Lab").click());
  const network = pressable("switch", "private network");
  assert.equal(network.getAttribute("aria-checked"), "false");
  await act(async () => network.click());
  await act(async () => pressable("button", "Connect").click());
  await settle();

  assert.deepEqual(approved, [
    {
      code: CODE,
      target: {
        kind: MACHINE_OWNER.WORKSPACE,
        workspaceId: WORKSPACE.id,
        network: MACHINE_NETWORK.PRIVATE_ALLOWED,
      },
    },
  ]);
});
