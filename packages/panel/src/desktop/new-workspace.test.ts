// @vitest-environment jsdom

/**
 * new-workspace.test.ts -- New workspace's cards as the shell holds them: they open past the window's leave guard, and a sign-out puts them away for good.
 */

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { AppStateDelivery, AppStateSnapshot } from "@repo/host/app-state";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { type PlaceLeave, usePlaceLeave } from "../places/place-leave.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { deliveryOf, signedInAs } from "../testing/app-state.js";
import { settleQueries, withQueryClient, writeAppState } from "../testing/copy-feedback.js";
import { windowRouter } from "../testing/window-router.js";
import { type NewWorkspace, useNewWorkspace } from "./new-workspace.js";

const ADA = signedInAs({ id: "user-ada", email: "ada@example.com", name: "Ada" });
const SIGNED_OUT: AppStateSnapshot = { ...ADA, account: { status: ACCOUNT_STATUS.SIGNED_OUT } };

const roots: Root[] = [];

/** Each window hearing main's document, which a delivery reaches. */
const listeners = new Set<(delivery: AppStateDelivery) => void>();

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  fakeAppBridge({
    onAppState: (heard) => {
      listeners.add(heard);

      return () => listeners.delete(heard);
    },
    requestAppState: () => Promise.resolve(ADA),
  });
  writeAppState(ADA);
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

/** Delivers `snapshot` as main's document at `version`, as main's push does. */
async function deliver(snapshot: AppStateSnapshot, version: number): Promise<void> {
  act(() => {
    for (const heard of listeners) heard(deliveryOf({ ...snapshot, version }));
  });
  await settleQueries();
}

/** The cards over the window's own leave guard, under a router standing on an automation. */
function mount() {
  const held = windowRouter(createMemoryHistory({ initialEntries: ["/acme/automations"] }));
  let leave: PlaceLeave | undefined;
  let cards: NewWorkspace | undefined;

  function Probe() {
    leave = usePlaceLeave();
    cards = useNewWorkspace(leave);

    return null;
  }

  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(held.provide(withQueryClient(createElement(Probe)))));

  return {
    leave: () => leave ?? assert.fail("the leave guard is made"),
    cards: () => cards ?? assert.fail("the cards are held"),
  };
}

test("New workspace over a page holding unsaved work asks, Stay leaves the cards put away, and Leave opens them", async () => {
  const window = mount();
  const asked: { leave: () => void; stay: () => void }[] = [];
  act(() => void window.leave().stand((leave, stay) => void asked.push({ leave, stay })));

  act(() => window.cards().onOpen());
  await settleQueries();
  act(() => asked[0]?.stay());
  const stayed = window.cards().open;
  act(() => window.cards().onOpen());
  await settleQueries();
  act(() => asked[1]?.leave());

  assert.equal(stayed, false);
  assert.equal(asked.length, 2);
  assert.equal(window.cards().open, true);
});

test("New workspace's cards opened before a sign-out stay put away when the account signs in again", async () => {
  const window = mount();

  act(() => window.cards().onOpen());
  const opened = window.cards().open;
  await deliver(SIGNED_OUT, ADA.version + 1);
  await deliver(ADA, ADA.version + 2);

  assert.equal(opened, true);
  assert.equal(window.cards().open, false);
});
