// @vitest-environment jsdom

import assert from "node:assert/strict";
import { SETTINGS_ACT_KIND } from "@repo/host/contract";
import { INTRO } from "@repo/settings";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { PageIntro } from "./page-intro.js";
import { fakeActPort, fakeActPortCalls, refusedOnPort } from "./testing/app-bridge.js";
import { handSettings } from "./testing/app-state.js";
import { withQueryClient } from "./testing/copy-feedback.js";

/**
 * page-intro.test.ts -- a page's intro never stands before the service has
 * answered the account's preferences, since an account made before the
 * intros shipped reads them all as seen; once answered it stands, and Got it
 * keeps it gone, for the next page drawn too. A Got it the window refuses
 * brings the card back, to be pressed again.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** The Inbox's intro, drawn on the test's client. */
function drawIntro(): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(createElement(PageIntro, { intro: INTRO.INBOX }))));

  return container;
}

/** The card's Got it, where it stands. */
function gotIt(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Got it",
  );
}

/** Whether the card stands in `container`. */
function stands(container: HTMLElement): boolean {
  return gotIt(container) !== undefined;
}

test("an intro waits for the account's preferences, then stands until Got it, which keeps it gone", async () => {
  handSettings({ accountRead: false });
  const unread = drawIntro();
  await act(async () => undefined);
  assert.equal(stands(unread), false);

  handSettings({ accountRead: true });
  const read = drawIntro();
  const press = await vi.waitFor(() => gotIt(read) ?? assert.fail("the intro"));
  act(() => press.click());
  await vi.waitFor(() => assert.equal(stands(read), false));

  // Note that a page drawn after reads the dismissal from the account's preferences, not the card's own state.
  const next = drawIntro();
  await act(async () => undefined);
  assert.equal(stands(next), false);
});

test("a Got it whose write is refused brings the card back", async () => {
  handSettings({ accountRead: true });
  fakeActPort({
    ...fakeActPortCalls(),
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: () => Promise.reject(refusedOnPort("Not saved.")),
  });
  const page = drawIntro();
  const press = await vi.waitFor(() => gotIt(page) ?? assert.fail("the intro"));
  act(() => press.click());
  await vi.waitFor(() => assert.equal(stands(page), true));
});
