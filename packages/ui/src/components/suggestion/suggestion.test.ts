// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { SUGGESTION_KIND, Suggestion } from "./suggestion.js";

/**
 * suggestion.test.ts -- a suggestion is one control in the line, heard as a
 * suggestion by its label, whose press opens what it suggests, once, and
 * runs nothing itself. Synthetic words.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BRIEF = "Send the invite email through the mail provider, and retry a bounce once.";

const roots: Root[] = [];

/** jsdom has no ResizeObserver; the layer's measures are not what this test reads. */
class StandInResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Draws a new agent's suggestion and answers the presses it made. */
function drawn(): { readonly pressed: string[] } {
  const pressed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(Suggestion, {
        label: "Wire up the invite email",
        kind: SUGGESTION_KIND.START,
        brief: BRIEF,
        onPress: () => pressed.push("opened"),
      }),
    ),
  );
  return { pressed };
}

test("a suggestion is heard by its label as a suggestion, and a press opens it once", () => {
  const { pressed } = drawn();
  const button = document.querySelector("button");
  assert.ok(button !== null);
  assert.match(button.textContent ?? "", /Wire up the invite email/u);
  assert.match(button.textContent ?? "", /suggestion/u);
  act(() => button.click());
  assert.deepEqual(pressed, ["opened"]);
});
