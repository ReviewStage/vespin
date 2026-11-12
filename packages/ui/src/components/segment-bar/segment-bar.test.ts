// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { STATUS_TONE } from "../../status-tone.js";
import { SegmentBar } from "./segment-bar.js";

/**
 * segment-bar.test.ts -- a line's bar is a picture its rows already say, so
 * a reader hears nothing of it, and it stands one segment for each thing in
 * the line, in order, the one marked told apart.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("the bar is hidden from a reader and stands one segment per thing in order, the marked one alone marked", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(SegmentBar, {
        segments: [{ tone: STATUS_TONE.MERGED }, { tone: STATUS_TONE.WORKING, marked: true }, {}],
      }),
    ),
  );
  const bar = container.firstElementChild ?? assert.fail("the bar stands");

  assert.equal(bar.getAttribute("aria-hidden"), "true");
  assert.deepEqual(
    [...bar.children].map((segment) => [
      segment.getAttribute("data-tone"),
      segment.hasAttribute("data-marked"),
    ]),
    [
      [STATUS_TONE.MERGED, false],
      [STATUS_TONE.WORKING, true],
      [null, false],
    ],
  );
});
