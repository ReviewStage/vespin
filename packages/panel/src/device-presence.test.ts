// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { DEVICE_SETUP } from "@repo/features/device-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { presenceStanding, useDevicePresence } from "./device-presence.js";
import { fakeActPort } from "./testing/app-bridge.js";
import { handBeats } from "./testing/app-state.js";
import { withQueryClient, writeHandedAppState } from "./testing/copy-feedback.js";

/**
 * device-presence.test.ts -- the shared presence says a host setting up or failed by its setup, and otherwise offline only where the sweep marked it away, and says it cannot check, not offline, where its read failed.
 * Synthetic ids.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** The id of the nth synthetic device. */
const deviceOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** What a surface draws of each device it names: its standing as the shared book says it, or nothing where the book does not name it. */
function Standings({ ids }: { ids: readonly string[] }): React.JSX.Element {
  const book = useDevicePresence(true);
  return createElement("p", null, ids.map((id) => presenceStanding(book, id) ?? "none").join(","));
}

/** Draws the devices `ids` name and lets the read land. */
async function draw(ids: readonly string[]): Promise<HTMLElement> {
  await writeHandedAppState();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(createElement(Standings, { ids }))));
  // Note that the read lands once it reaches the beats' query, until when every device reads checking.
  await vi.waitFor(() =>
    assert.equal(container.textContent?.includes(DEVICE_STANDING.CHECKING), false),
  );
  return container;
}

test("a host the sweep marked away reads offline, and one it did not reads online", async () => {
  fakeActPort({});
  handBeats({ [deviceOf(1)]: 1_000, [deviceOf(2)]: 61_000 });
  const container = await draw([deviceOf(1), deviceOf(2)]);

  assert.equal(container.textContent, `${DEVICE_STANDING.ONLINE},${DEVICE_STANDING.OFFLINE}`);
});

test("a device the read does not name as the account's own has no standing", async () => {
  fakeActPort({});
  handBeats({ [deviceOf(1)]: 1_000 });
  const container = await draw([deviceOf(1), deviceOf(9)]);

  assert.equal(container.textContent, `${DEVICE_STANDING.ONLINE},none`);
});

test("a read that failed says unknown, never offline", async () => {
  fakeActPort({});
  handBeats(undefined);
  assert.equal((await draw([deviceOf(1)])).textContent, DEVICE_STANDING.UNKNOWN);
});

test("a host still fetching its tools, one whose setup failed, and one that never called in ten minutes after joining read setting up, failed, and failed, though none is away", async () => {
  fakeActPort({});
  const host = (n: number) => ({ id: deviceOf(n), name: `host-${n}` });
  handBeats(
    { [deviceOf(1)]: 1_000, [deviceOf(2)]: 1_000, [deviceOf(3)]: 1_000 },
    {
      hosts: [
        { ...host(1), setup: DEVICE_SETUP.PREPARING, calledIn: true },
        { ...host(2), setup: DEVICE_SETUP.FAILED, calledIn: true },
        { ...host(3), calledIn: false, joinedAt: Date.now() - 11 * 60 * 1_000 },
      ],
    },
  );
  const container = await draw([deviceOf(1), deviceOf(2), deviceOf(3)]);

  assert.equal(
    container.textContent,
    `${DEVICE_STANDING.SETTING_UP},${DEVICE_STANDING.FAILED},${DEVICE_STANDING.FAILED}`,
  );
});
