// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  DEVICE_SETUP,
  MACHINE_NETWORK,
} from "@repo/features/device-agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import type { WorkspaceMachineLine } from "@repo/features/workspace-machine-view";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { WorkspaceMachinesSection } from "./workspace-machines-section.js";

/**
 * workspace-machines-section.test.ts -- Settings › Machines' list of the
 * machines a workspace owns, drawn from the read the host holds: each says
 * its platform, architecture, and where it stands, its owners and admins
 * rename and remove it, and a member who is neither reads it alone.
 * Synthetic workspaces and machines.
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

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: null,
};

const BUILD_BOX: WorkspaceMachineLine = {
  id: "5c0f6c84-1d2e-4f3a-8b4c-5d6e7f8a9b01",
  name: "build-01",
  platform: DEVICE_PLATFORM.LINUX,
  arch: DEVICE_ARCH.X64,
  connectedBy: "user-admin",
  network: MACHINE_NETWORK.PRIVATE_ALLOWED,
  calledIn: true,
  away: false,
};

const STUDIO: WorkspaceMachineLine = {
  id: "5c0f6c84-1d2e-4f3a-8b4c-5d6e7f8a9b02",
  name: "Team Mac Studio",
  platform: DEVICE_PLATFORM.DARWIN,
  arch: DEVICE_ARCH.ARM64,
  connectedBy: null,
  network: MACHINE_NETWORK.PUBLIC_ONLY,
  setup: DEVICE_SETUP.PREPARING,
  calledIn: true,
  away: false,
};

/** Lets the window's document, the list's read, and a press's acts land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** The list drawn for `workspace`, its machines laid as the host holds them, the host answering the window's acts as `procedures` say. */
async function drawList(
  workspace: Workspace,
  machines: readonly WorkspaceMachineLine[],
  procedures: Parameters<typeof fakeActPort>[0] = {},
): Promise<void> {
  handState({}, { [LIVE_READ.WORKSPACE_MACHINES]: { [workspace.id]: { rows: machines } } });
  fakeActPort(procedures);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  act(() =>
    root.render(
      withQueryClient(createElement(WorkspaceMachinesSection, { signedIn: true, workspace })),
    ),
  );
  await settle();
}

/** The row of the machine called `name`. */
function rowOf(name: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>(".ui-settings-row")].find(
      (each) => each.textContent?.includes(name) ?? false,
    ) ?? assert.fail(`${name}'s row is drawn`)
  );
}

test("each machine says its platform, its architecture, and where it stands, and a member who is no owner or admin is offered no act on it", async () => {
  await drawList({ ...ACME, role: WORKSPACE_ROLE.MEMBER }, [BUILD_BOX, STUDIO]);

  const box = rowOf("build-01").textContent ?? "";
  assert.ok(box.includes("Linux") && box.includes("x64"), box);
  assert.ok(box.includes("Reaches its private network"), box);
  const studio = rowOf("Team Mac Studio").textContent ?? "";
  assert.ok(studio.includes("Setting up…") && studio.includes("arm64"), studio);
  assert.equal(
    document.querySelector('button[aria-haspopup="menu"]'),
    null,
    "a member is offered neither Rename nor Remove",
  );
});

test("an admin's Remove asks first, and then removes that machine of that workspace", async () => {
  const removed: unknown[] = [];

  await drawList(ACME, [BUILD_BOX, STUDIO], {
    [ACT_KIND.WORKSPACE_OWNED_MACHINE_REMOVE]: async (asked) => {
      removed.push(asked);

      return { done: true, txid: "1" };
    },
  });

  const ellipsis =
    rowOf("Team Mac Studio").querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ??
    assert.fail("an admin's ⋯ is drawn");

  act(() => ellipsis.click());

  const remove =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Remove",
    ) ?? assert.fail("Remove is offered");

  act(() => remove.click());
  const asked = document.querySelector('[role="alertdialog"]')?.textContent ?? "";
  assert.ok(asked.includes("Remove Team Mac Studio?"), asked);
  assert.deepEqual(removed, [], "nothing is removed before the question is answered");

  const confirm =
    [...document.querySelectorAll("button")].find(
      (each) => each.textContent === "Remove machine",
    ) ?? assert.fail("the question offers Remove machine");

  await act(async () => confirm.click());
  await settle();
  assert.deepEqual(removed, [{ workspaceId: ACME.id, id: STUDIO.id }]);
});
