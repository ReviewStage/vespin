// @vitest-environment jsdom

import assert from "node:assert/strict";
import { SANDBOX_STATE } from "@repo/features/agent-sandbox-wire";
import {
  AGENT_MACHINE,
  type AgentRunsOnRequest,
  type AgentSummary,
} from "@repo/features/agent-wire";
import type { MacOffer } from "@repo/features/models-wire";
import { TOOL_BLOCK, TOOL_STATE } from "@repo/features/tool-call-block";
import { CALL_KIND } from "@repo/features/turn-rows";
import { AGENT_ACT_KIND } from "@repo/host/contract";
import { SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { OpenSettingsProvider } from "../open-settings.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { handBeats, handHostReads, handState } from "../testing/app-state.js";
import { withQueryClient, writeAppState } from "../testing/copy-feedback.js";
import { useCallRoute } from "./agent-machines.js";
import { AgentPlace } from "./agent-place.js";
import type { PlaceMove } from "./move-agent.js";
import { CallPlaceProvider, TranscriptTool } from "./transcript-blocks.js";

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
  assert.equal(label, "Machine: Charles's MacBook Air");
  assert.equal(document.querySelector('[role="img"]')?.getAttribute("aria-label"), "Online");
});

test("a device the presence read finds silent reads offline", async () => {
  const label = await labelWhile({ [DEVICE]: 90_000 });
  assert.equal(label, "Machine: Charles's MacBook Air · Offline");
});

test("a presence read that fails says the status cannot be checked, never offline", async () => {
  await labelWhile(undefined);
  // Note that the read's failure reaches the presence query a moment after the document does.
  await vi.waitFor(() =>
    assert.equal(document.body.textContent, "Machine: Charles's MacBook Air · Can't check status"),
  );
});

test("a device the account does not own, which the read does not name, shows its name alone", async () => {
  const label = await labelWhile({});
  assert.equal(label, "Machine: Charles's MacBook Air");
});

test("an agent on a machine its workspace owns names that machine, never the cloud", async () => {
  const label = await placeOf(
    { machine: AGENT_MACHINE.WORKSPACE, mac: { name: "build-01", deviceId: DEVICE } },
    {},
  );

  assert.equal(label, "Machine: build-01");
});

/** The chip whose press opens where the agent works, which a reader hears as its label says. */
function placeChip(): HTMLButtonElement {
  return (
    document.querySelector<HTMLButtonElement>('button[aria-label^="Machine"]') ??
    assert.fail("the place chip stands")
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

/** The rows of the listbox a reader hears by the name given, as each reads. */
function optionsOf(list: string): readonly string[] {
  return [
    ...document.querySelectorAll(`[role="listbox"][aria-label="${list}"] [role="option"]`),
  ].map((option) => option.textContent ?? "");
}

test("a cloud agent's chip reads Cloud alone, a reader hearing its sandbox's state, and its popover lists the state and the sandbox's size over where it runs", async () => {
  const running = {
    state: SANDBOX_STATE.RUNNING,
    stateAt: Date.now(),
    runsUntil: Date.now() + 60_000,
  };

  await placeOf({ sandbox: running, sandboxVcpus: 4 }, undefined);
  assert.equal(placeChip().textContent, "Cloud");
  assert.equal(placeChip().getAttribute("aria-label"), "Machine: Cloud, Running");

  act(() => placeChip().click());
  assert.deepEqual(factsShown(), [
    ["Status", "Running"],
    ["CPU", "4 vCPUs"],
    ["Memory", "8 GB"],
  ]);
  assert.deepEqual(optionsOf("Where this agent works"), ["Agent runs inCloud"]);

  await placeOf({}, undefined);
  assert.equal(placeChip().getAttribute("aria-label"), "Machine: Cloud, Off");
});

/** The cloud agent's chip drawn with the move given, opened on its Agent runs in row, and the places its submenu lists, the settings the window was asked to open kept. */
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
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label^="Machine"]')?.click());
  act(() => document.querySelector<HTMLElement>('[role="option"]')?.click());

  return [
    ...document.querySelectorAll<HTMLElement>(
      '[role="listbox"][aria-label="Move this agent to"] [role="option"]',
    ),
  ];
}

test("where a move is offered, Agent runs in opens the places, Cloud wearing its sandbox's dot, and moves the agent to the one picked, and with no Mac sends the member to add one", async () => {
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
  assert.equal(rows[0]?.querySelector('[role="img"]')?.getAttribute("aria-label"), "Off");
  assert.deepEqual(
    rows.map((row) => row.textContent?.includes("Studio") ?? false),
    [false, true],
  );
  act(() => rows[1]?.click());
  assert.deepEqual(moved, [{ machine: AGENT_MACHINE.DEVICE, deviceId: DEVICE }]);

  const bare = await placeMenuOf({ ...withMac, devices: [] }, opened);
  act(() => bare.find((row) => row.textContent?.includes("Add a machine"))?.click());
  assert.deepEqual(opened, [{ page: SETTINGS_VIEW.HOSTS }]);
  assert.equal(moved.length, 1);
});

test("the Default machine row names the agent's default with its dot, offline as such, a teammate's face before a machine of theirs, and a pick of another machine sets it, named from the press while the service has yet to answer and no longer once a newer pick answered; a local agent's chip opens the same rows", async () => {
  const sent: unknown[] = [];
  const owner = { userId: "user-ada", name: "Ada Lovelace" };

  fakeActPort({
    [AGENT_ACT_KIND.AGENTS_SET_DEFAULT_MACHINE]: (payload) => {
      sent.push(payload);

      // Note that the service never answers a pick of the studio, so it is still out when the chip opens again, and answers a later pick of the laptop at once.
      return payload.machineId === "studio" ? new Promise(() => undefined) : Promise.resolve({});
    },
  });

  handState({});
  handBeats({});

  handHostReads({
    workspaceTools: {
      [AGENT_ID]: {
        rows: {
          runOnMac: {
            on: false,
            reason: "mac-away",
            owner,
            machine: { id: "laptop", name: "Laptop" },
          },
          machines: [
            { id: "laptop", name: "Laptop", owner, online: false },
            { id: "studio", name: "Studio", owner, online: true },
          ],
        },
      },
    },
  });
  writeAppState(await appBridge().requestAppState());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(createElement(AgentPlace, { agent: { id: AGENT_ID } }))));
  await settle();
  act(() => placeChip().click());
  const rows = optionsOf("Where this agent works");

  const standing = document
    .querySelectorAll('[role="option"]')[1]
    ?.querySelector('[role="img"]')
    ?.getAttribute("aria-label");

  act(() => document.querySelectorAll<HTMLElement>('[role="option"]')[1]?.click());
  const machines = optionsOf("Commands run here");

  act(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="listbox"][aria-label="Commands run here"] [role="option"]',
      ),
    ][1]?.click(),
  );
  await settle();

  // Note that the machines are a teammate's, Ada's, so each wears her face, "A", before its name, and a cloud agent's row says the agent keeps running without the machine.
  assert.deepEqual(rows, [
    "Agent runs inCloud",
    "Commands run onVespin there runs its terminal commands, and on a Mac its computer use too. If that machine goes offline, the agent keeps running.ALaptop",
  ]);
  assert.equal(standing, "Offline");
  assert.equal(machines.length, 2);
  assert.deepEqual(sent, [{ agentId: AGENT_ID, machineId: "studio" }]);

  const local = {
    id: AGENT_ID,
    machine: AGENT_MACHINE.DEVICE,
    mac: { name: "Mini", seenAt: Date.now(), deviceId: DEVICE },
  };

  act(() => root.render(withQueryClient(createElement(AgentPlace, { agent: local }))));
  await settle();
  act(() => placeChip().click());
  assert.deepEqual(optionsOf("Where this agent works"), [
    "Agent runs inMini",
    "Commands run onAStudio",
  ]);

  // Note that the laptop is picked back while the studio's pick is still out, and its answer comes first; the service's default stands then, never the older pick.
  act(() => document.querySelectorAll<HTMLElement>('[role="option"]')[1]?.click());
  act(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="listbox"][aria-label="Commands run here"] [role="option"]',
      ),
    ][0]?.click(),
  );
  await settle();
  assert.deepEqual(sent, [
    { agentId: AGENT_ID, machineId: "studio" },
    { agentId: AGENT_ID, machineId: "laptop" },
  ]);
  act(() => root.render(withQueryClient(createElement(AgentPlace, { agent: local }))));
  await settle();
  act(() => placeChip().click());
  assert.deepEqual(optionsOf("Where this agent works"), [
    "Agent runs inMini",
    "Commands run onALaptop",
  ]);
});

/** The machine a running action on an app, naming the machine of the id given or none, says it goes to, as its row's chip names it. */
function RunningCall({ named }: { named: string | undefined }): ReactElement {
  return createElement(CallPlaceProvider, {
    owner: undefined,
    route: useCallRoute(AGENT_ID),
    children: createElement(TranscriptTool, {
      state: TOOL_STATE.INPUT_AVAILABLE,
      kind: CALL_KIND.COMPUTER,
      namedMachine: named,
      subject: "Arc",
      input: { kind: TOOL_BLOCK.JSON, text: "{}" },
      output: undefined,
      errorText: undefined,
    }),
  });
}

test("a running action on an app names the machine it names, not the agent's default, and a call naming none names the default", async () => {
  const owner = { userId: "user-ada", name: "Ada Lovelace" };
  const teammate = { userId: "user-ben", name: "Ben Okafor" };

  handState({});
  handBeats({});

  handHostReads({
    workspaceTools: {
      [AGENT_ID]: {
        rows: {
          runOnMac: { on: true, owner, machine: { id: "laptop", name: "Laptop" } },
          machines: [
            { id: "laptop", name: "Laptop", owner, online: true },
            { id: "studio", name: "Studio", owner: teammate, online: true },
          ],
        },
      },
    },
  });
  writeAppState(await appBridge().requestAppState());

  const placeOf = async (named: string | undefined) => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(withQueryClient(createElement(RunningCall, { named }))));
    await settle();

    return container.querySelector(".tool-place .ui-inline-ref-label")?.textContent ?? undefined;
  };

  assert.equal(await placeOf("studio"), "Studio");
  assert.equal(await placeOf(undefined), "Laptop");
  // Note that a machine the agent's tools do not list goes unnamed until the call answers, rather than named as the default.
  assert.equal(await placeOf("elsewhere"), undefined);
});
