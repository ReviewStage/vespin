// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ReactionChip, ReactionRow } from "../../index.js";

/**
 * reaction-chip.test.ts -- a reaction that may be pressed is a toggle named
 * by who gave it, standing pressed where the reader did, and a press reaches
 * its caller; one that may not be pressed is no press, named the same.
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

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));

  return container;
}

test("a reaction that may be pressed is a toggle named by who gave it, and one that may not is no press", () => {
  const presses: string[] = [];

  const row = render(
    createElement(
      ReactionRow,
      null,
      createElement(ReactionChip, {
        emoji: "👍",
        count: 2,
        label: "You and 1 other reacted with thumbs up",
        reacted: true,
        onPress: () => presses.push("thumbs up"),
      }),
      createElement(ReactionChip, {
        emoji: "🎉",
        count: 3,
        label: "3 reacted with hooray",
        reacted: false,
      }),
    ),
  );

  const [toggle, ...others] = row.querySelectorAll("button");
  assert.equal(others.length, 0);
  assert.equal(toggle?.getAttribute("aria-label"), "You and 1 other reacted with thumbs up");
  assert.equal(toggle?.getAttribute("aria-pressed"), "true");
  act(() => toggle?.click());
  assert.deepEqual(presses, ["thumbs up"]);
  assert.equal(
    row.querySelector("[role=img]")?.getAttribute("aria-label"),
    "3 reacted with hooray",
  );
  assert.equal(row.querySelector("ul")?.getAttribute("aria-label"), "Reactions");
});
