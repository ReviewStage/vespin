import assert from "node:assert/strict";
import { test } from "vitest";
import { PAGE_ZOOM_KEY, pageZoomAfter, pageZoomPinched } from "./page-zoom.js";

/**
 * page-zoom.test.ts -- a press steps a page's size to the next step that way
 * even from a size a pinch left between steps, and neither a press nor a
 * pinch takes it past the smallest or largest size.
 */

test("a press steps to the next size that way from wherever a pinch left it, held at the ends", () => {
  // A pinch to 1.2 sits between 110% and 125%.
  assert.equal(pageZoomAfter(1.2, PAGE_ZOOM_KEY.IN), 1.25);
  assert.equal(pageZoomAfter(1.2, PAGE_ZOOM_KEY.OUT), 1.1);
  // A size a hair off a step still moves a whole step.
  assert.equal(pageZoomAfter(1.0000001, PAGE_ZOOM_KEY.IN), 1.1);
  assert.equal(pageZoomAfter(3, PAGE_ZOOM_KEY.IN), 3);
  assert.equal(pageZoomAfter(0.5, PAGE_ZOOM_KEY.OUT), 0.5);
  assert.equal(pageZoomAfter(2.2, PAGE_ZOOM_KEY.ACTUAL), 1);
  assert.equal(pageZoomPinched(2.9, -10), 3);
  assert.equal(pageZoomPinched(0.51, 10), 0.5);
});
