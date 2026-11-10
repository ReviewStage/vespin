// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { REPLY_BUTTON_KIND, ReplyButton } from "./reply-button.js";

/**
 * reply-button.test.ts -- a press runs the button at once under a pointer,
 * and where it confirms first, opens the brief whole with the act's own
 * button under it, which alone runs it. Synthetic words.
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

/** Draws the button, confirming first or not, and answers the presses it ran. */
function drawn(confirmFirst: boolean): { readonly pressed: string[] } {
  const pressed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(ReplyButton, {
        label: "Wire up the invite email",
        kind: REPLY_BUTTON_KIND.START,
        glyph: null,
        where: "acme/relay · main",
        brief: BRIEF,
        confirmFirst,
        onPress: () => pressed.push("pressed"),
      }),
    ),
  );
  return { pressed };
}

/** Presses the button named by its words. */
function press(words: string): void {
  const button = [...document.querySelectorAll("button")].find((each) =>
    each.textContent?.includes(words),
  );
  assert.ok(button !== undefined, words);
  act(() => button.click());
}

test("under a pointer a press runs at once; confirming first, it opens the brief and only Start agent runs it", () => {
  const atOnce = drawn(false);
  press("Wire up the invite email");
  assert.deepEqual(atOnce.pressed, ["pressed"]);
  for (const root of roots.splice(0)) act(() => root.unmount());

  const confirming = drawn(true);
  press("Wire up the invite email");
  assert.deepEqual(confirming.pressed, []);
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog?.textContent?.includes(BRIEF));
  press("Start agent");
  assert.deepEqual(confirming.pressed, ["pressed"]);
});
