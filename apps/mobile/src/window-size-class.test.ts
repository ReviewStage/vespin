import { describe, expect, it } from "vitest";
import { standsThreeColumns, WINDOW_SIZE_CLASS, windowSizeClass } from "./window-size-class.js";

describe("windowSizeClass", () => {
  // A phone's portrait window and a third of an iPad stay compact; an iPad's
  // window, half of one, and the unfolded iPhone Duo's are regular.
  it.each([
    { window: "an iPhone in portrait", width: 402, sizeClass: WINDOW_SIZE_CLASS.COMPACT },
    {
      window: "a third of an iPad in Split View",
      width: 375,
      sizeClass: WINDOW_SIZE_CLASS.COMPACT,
    },
    { window: "half of an iPad in Split View", width: 678, sizeClass: WINDOW_SIZE_CLASS.REGULAR },
    { window: "an iPad in portrait", width: 834, sizeClass: WINDOW_SIZE_CLASS.REGULAR },
  ])("reads $window as $sizeClass", ({ width, sizeClass }) => {
    expect(windowSizeClass(width)).toBe(sizeClass);
  });
});

describe("standsThreeColumns", () => {
  // Only an iPad's landscape window is wide enough for groups, rows, and a page side by side.
  it.each([
    { window: "an iPad in portrait", width: 834, three: false },
    { window: "an iPad in landscape", width: 1194, three: true },
  ])("reads $window as three columns: $three", ({ width, three }) => {
    expect(standsThreeColumns(width)).toBe(three);
  });
});
