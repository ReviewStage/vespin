// @vitest-environment jsdom

import assert from "node:assert/strict";
import { SANDBOX_STATE } from "@repo/features/agent-sandbox-wire";
import {
  AGENT_MACHINE,
  type AgentRunsOnRequest,
  type AgentSummary,
} from "@repo/features/agent-wire";
import type { MacOffer } from "@repo/features/models-wire";
import { SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { OpenSettingsProvider } from "../open-settings.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { handBeats, handState } from "../testing/app-state.js";
import { withQueryClient, writeAppState } from "../testing/copy-feedback.js";
import { AgentPlace } from "./agent-place.js";
import type { PlaceMove } from "./move-agent.js";

/**
 * agent-place.test.ts -- the chip an agent's box wears says where it runs: a device named with its standing as the window's shared presence read says it, not as the agent's own read once did, or the cloud, which a reader hears with its sandbox's state and whose popover lists that state and the sandbox's size; and where a move is offered, it lists the places to move the agent to, or where to add a Mac where the member has none.
 * Synthetic ids and names.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

/** Lets go of every box drawn so far. */
function clear(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
}

afterEach(clear);

const DEVICE = "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d15";

const AGENT_ID = "7a1c4e9b-2f3d-4b6a-8c5e-1d0f9a8b7c6e";

/** A minute and a half since the agent's own read saw a beat: past the window the label judges by. */
const READ_SEEN_AT = Date.now() - 90_000;

/** Lets the label's presence read and its redraw land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** An agent's box drawn with `agent` while the beats stand as `ages` says, each device's age, or failed where none is given, and what the box then says. */
async function placeOf(
  agent: Pick<AgentSummary, "mac" | "machine" | "sandbox" | "sandboxVcpus">,
  ages: Readonly<Record<string, number>> | undefined,
): Promise<string> {
  clear();
  fakeActPort({});
  // Note that the bridge is laid afresh, so a case's state never reaches the next.
  handState({});
  handBeats(ages);
  // Note that the label is read once, so the document is in the client from its first frame, as the root's `ensureQueryData` leaves it.
  writeAppState(await appBridge().requestAppState());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(withQueryClient(createElement(AgentPlace, { agent: { id: AGENT_ID, ...agent } }))),
  );
  await settle();
  return document.body.textContent ?? "";
}

/** The chip of an agent on a device whose own read, a minute and a half ago, saw a beat, drawn while the beats stand as `ages` says. */
function labelWhile(ages: Readonly<Record<string, number>> | undefined): Promise<string> {
  return placeOf(
    {
      machine: AGENT_MACHINE.DEVICE,
      mac: { name: "Charles's MacBook Air", seenAt: READ_SEEN_AT, deviceId: DEVICE },
    },
    ages,
  );
}

test("a device the presence read finds beating reads online though the agent's own read is old, its glyph's dot saying so as its row's does", async () => {
  const label = await labelWhile({ [DEVICE]: 5_000 });
  assert.equal(label, "Runs on: Charles's MacBook Air");
  assert.equal(document.querySelector('[role="img"]')?.getAttribute("aria-label"), "Online");
});

test("a device the presence read finds silent reads offline", async () => {
  const label = await labelWhile({ [DEVICE]: 90_000 });
  assert.equal(label, "Runs on: Charles's MacBook Air · Offline");
});

test("a presence read that fails says the status cannot be checked, never offline", async () => {
  await labelWhile(undefined);
  // Note that the read's failure reaches the presence query a moment after the document does.
  await vi.waitFor(() =>
    assert.equal(document.body.textContent, "Runs on: Charles's MacBook Air · Can't check status"),
  );
});

test("a device the account does not own, which the read does not name, shows its name alone", async () => {
  const label = await labelWhile({});
  assert.equal(label, "Runs on: Charles's MacBook Air");
});

/** The Cloud chip, which a reader hears as its label says. */
function cloudChip(): HTMLButtonElement {
  return (
    document.querySelector<HTMLButtonElement>('button[aria-label^="Runs on"]') ??
    assert.fail("the Cloud chip stands")
  );
}

/** The facts the open popover lists, each its label and its value. */
function factsShown(): readonly (readonly [string, string])[] {
  return [...document.querySelectorAll(".ui-fact")].map(
    (fact) =>
      [
        fact.querySelector("dt")?.textContent ?? "",
        fact.querySelector("dd")?.textContent ?? "",
      ] as const,
  );
}

test("a cloud agent's chip reads Cloud alone, a reader hearing its sandbox's state, and its popover lists the state and the sandbox's size", async () => {
  const running = {
    state: SANDBOX_STATE.RUNNING,
    stateAt: Date.now(),
    runsUntil: Date.now() + 60_000,
  };
  await placeOf({ sandbox: running, sandboxVcpus: 4 }, undefined);
  assert.equal(cloudChip().textContent, "Cloud");
  assert.equal(cloudChip().getAttribute("aria-label"), "Runs on: Cloud, Running");

  act(() => cloudChip().click());
  assert.deepEqual(factsShown(), [
    ["Status", "Running"],
    ["CPU", "4 vCPUs"],
    ["Memory", "8 GB"],
  ]);

  await placeOf({}, undefined);
  assert.equal(cloudChip().getAttribute("aria-label"), "Runs on: Cloud, Off");
});

/** The cloud agent's chip drawn with the move given, opened, and the rows its menu lists, the settings the window was asked to open kept. */
async function placeMenuOf(move: PlaceMove, opened: SettingsLink[]): Promise<HTMLElement[]> {
  clear();
  fakeActPort({});
  handState({});
  handBeats({});
  writeAppState(await appBridge().requestAppState());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(
          OpenSettingsProvider,
          { value: (link: SettingsLink) => opened.push(link) },
          createElement(AgentPlace, {
            agent: { id: AGENT_ID },
            move,
          }),
        ),
      ),
    ),
  );
  await settle();
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label^="Runs on"]')?.click());
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

test("where a move is offered, the popover lists the places under its facts, Cloud wearing its sandbox's dot, and moves the agent to the one picked, and with no Mac sends the member to add one", async () => {
  const moved: AgentRunsOnRequest[] = [];
  const opened: SettingsLink[] = [];
  const studio: MacOffer = { deviceId: DEVICE, name: "Studio", providers: [] };
  const withMac = {
    devices: [studio],
    moveTo: (to: AgentRunsOnRequest) => moved.push(to),
    pushedOnly: false,
    detail: undefined,
  };

  const rows = await placeMenuOf(withMac, opened);
  assert.deepEqual(factsShown(), [["Status", "Off"]]);
  assert.equal(rows[0]?.querySelector('[role="img"]')?.getAttribute("aria-label"), "Off");
  assert.deepEqual(
    rows.map((row) => row.textContent?.includes("Studio") ?? false),
    [false, true],
  );
  act(() => rows[1]?.click());
  assert.deepEqual(moved, [{ machine: AGENT_MACHINE.DEVICE, deviceId: DEVICE }]);

  const bare = await placeMenuOf({ ...withMac, devices: [] }, opened);
  act(() => bare.find((row) => row.textContent?.includes("Set up a Mac"))?.click());
  assert.deepEqual(opened, [{ page: SETTINGS_VIEW.HOSTS }]);
  assert.equal(moved.length, 1);
});
