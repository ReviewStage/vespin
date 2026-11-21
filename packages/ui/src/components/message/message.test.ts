// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { holdFrames, settleFrames } from "../../testing/frames.js";
import { IconButton } from "../button/button.js";
import { HeldMessageAction, MessageActions, MessageFrame } from "./message.js";

/**
 * message.test.ts -- a turn's actions are drawn once the frame it was first
 * drawn in has painted, or at once where the focus comes onto the turn, and
 * until then stand as boxes that say nothing.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** A turn with a link in its words and a Copy action, drawn into the page. */
function drawTurn(): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);

  const copy = createElement(IconButton, {
    icon: createElement("svg"),
    label: "Copy",
    onClick: () => undefined,
  });

  act(() =>
    root.render(
      createElement(
        MessageFrame,
        null,
        createElement("a", { href: "#words" }, "Words"),
        createElement(MessageActions, null, createElement(HeldMessageAction, null, copy)),
      ),
    ),
  );

  return container;
}

const copyButton = (container: HTMLElement) =>
  [...container.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === "Copy" || button.textContent === "Copy",
  );

test("a turn's actions are drawn once the frame it was first drawn in has painted, a box that says nothing standing in for each until then", async () => {
  holdFrames();
  const container = drawTurn();
  const held = container.querySelector(".ui-message-actions")?.children;

  const first = [
    copyButton(container) !== undefined,
    held?.length,
    held?.[0]?.getAttribute("aria-hidden"),
  ];

  await settleFrames();

  assert.deepEqual(first, [false, 1, "true"], "the first frame holds a box in the action's place");
  assert.ok(copyButton(container), "the action is drawn once the frame has painted");
});

test("the focus coming onto a turn draws its actions at once, so a turn the keyboard is on never lacks them", () => {
  holdFrames();
  const container = drawTurn();

  act(() => container.querySelector("a")?.focus());

  assert.ok(copyButton(container), "the action is drawn with no frame passed");
});
