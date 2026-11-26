// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { onTestFinished, test } from "vitest";
import { WorkingMark } from "./working-mark.js";

/**
 * working-mark.test.ts -- the loading marks are decorative, hidden from a
 * reader, and the working mark lights several cells.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(element: React.ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() => root.render(element));
  // Note that the root leaves with its test.
  onTestFinished(() => act(() => root.unmount()));

  return container;
}

test("the working mark is hidden from a reader", () => {
  const mark = render(createElement(WorkingMark)).querySelector(".ui-working-mark");
  assert.equal(mark?.getAttribute("aria-hidden"), "true");
});

test("the working mark lights at least three cells, not one stacked dot", () => {
  const dots = render(createElement(WorkingMark)).querySelectorAll<HTMLElement>(
    ".ui-working-mark-dot",
  );

  const cells = new Set([...dots].map((dot) => dot.style.transform));
  assert.ok(cells.size >= 3, `the still mark lights ${cells.size} cells`);
});
