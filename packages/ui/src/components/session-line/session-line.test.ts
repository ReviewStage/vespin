/**
 * session-line.test.ts -- a carry-on's line says what cut the turn off and
 * keeps the words the agent was sent folded until its line is pressed.
 */

// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import { CarryOnLine } from "../../index.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const LINE = "Interrupted when the agent stopped answering · carried on by itself";
const SENT = "From Vespin: your previous turn was interrupted before it ended.";

const roots: Root[] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Draws `element` into the page and answers the container it was drawn in. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));

  return container;
}

test("a carry-on says its line alone until pressed, then the words the agent was sent", () => {
  const container = mount(createElement(CarryOnLine, { line: LINE, sent: SENT }));
  const summary = container.querySelector("summary");

  expect(summary?.textContent).toBe(LINE);
  expect(summary?.getAttribute("aria-expanded")).toBe("false");
  expect(container.textContent).not.toContain(SENT);

  act(() => summary?.click());

  expect(summary?.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain(SENT);
});
