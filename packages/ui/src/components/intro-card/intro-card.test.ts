// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { IntroCard } from "./intro-card.js";

/**
 * intro-card.test.ts -- Learn more hands its address to the window's link
 * door and never follows it, so a press on it never takes the window to the
 * docs; Got it asks that the card go.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DOCS = "https://vespin.dev/docs/inbox";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("Learn more opens the docs through the window's door, and Got it dismisses the card", () => {
  const opened: string[] = [];
  let dismissed = 0;
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);

  act(() =>
    root.render(
      createElement(IntroCard, {
        shown: true,
        glyph: null,
        learnMore: DOCS,
        open: (href: string) => opened.push(href),
        onDismiss: () => {
          dismissed += 1;
        },
        children: "Agents post here when they need you.",
      }),
    ),
  );

  const link = container.querySelector("a") ?? assert.fail("Learn more");
  assert.equal(link.textContent, "Learn more");
  const press = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => link.dispatchEvent(press));
  assert.deepEqual(opened, [DOCS]);
  assert.equal(press.defaultPrevented, true);

  const gotIt =
    [...container.querySelectorAll("button")].find((button) => button.textContent === "Got it") ??
    assert.fail("Got it");

  act(() => gotIt.click());
  assert.equal(dismissed, 1);
});
