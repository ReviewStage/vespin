// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { CALL_DEVICE, CallMute, TalkButton } from "./call-controls.js";

/**
 * call-controls.test.ts -- Talk with no OpenAI API key reads as unavailable
 * and says what a call needs, yet still hands its press to the owner, who
 * opens the settings the key is saved in; and a mute is named for what its
 * press will do, announced as on while muted.
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

/** Draws `element` and hands back its one button. */
function drawButton(element: ReactElement): HTMLButtonElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  const found = container.querySelector("button");

  if (found === null) throw new Error("no button drawn");

  return found;
}

test("Talk with no OpenAI API key reads as unavailable and still hands its press to the owner", () => {
  let pressed = 0;

  const talk = drawButton(
    createElement(TalkButton, { keyMissing: true, onPress: () => (pressed += 1) }),
  );

  act(() => talk.click());

  expect(talk.getAttribute("aria-label")).toBe("Add an OpenAI API key");
  expect(talk.getAttribute("aria-disabled")).toBe("true");
  expect(pressed).toBe(1);
});

test("a muted microphone is named for unmuting and announced as on", () => {
  const mute = drawButton(
    createElement(CallMute, { device: CALL_DEVICE.MICROPHONE, muted: true, onPress: () => {} }),
  );

  expect(mute.getAttribute("aria-label")).toBe("Unmute microphone");
  expect(mute.getAttribute("aria-pressed")).toBe("true");
});
