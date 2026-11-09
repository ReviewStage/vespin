import { expect, test } from "vitest";
import { splitBarFit } from "./split-bar-model.js";

/**
 * split-bar-model.test.ts -- a split bar shows every segment where they all fit at their floor,
 * and otherwise keeps room for the segment naming the rest, never fewer than one beside it.
 * Widths worked by hand.
 */

const ROOM = { floor: 150, gap: 6, more: 90 };

test.each([
  // Three at 150 with two gaps need 462: all stand in 640, each (640 - 12) / 3 wide.
  { width: 640, count: 3, shown: 3, segment: 628 / 3 },
  // Six need 930: 640 keeps 90 + 6 for the rest, and (640 - 90) / 156 fits 3, each (640 - 96 - 12) / 3.
  { width: 640, count: 6, shown: 3, segment: 532 / 3 },
  // A phone's 340 fits (340 - 90) / 156, 1 segment, 340 - 96 wide.
  { width: 340, count: 6, shown: 1, segment: 244 },
  // Narrower than a segment and the rest together still shows one segment beside the count.
  { width: 200, count: 4, shown: 1, segment: 104 },
])("$count segments in $width show $shown", ({ width, count, shown, segment }) => {
  expect(splitBarFit({ ...ROOM, width, count })).toEqual({ shown, segment });
});
