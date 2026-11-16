import { describe, expect, it } from "vitest";
import { standsThreeColumns, WINDOW_SIZE_CLASS, windowSizeClass } from "./window-size-class.js";

describe("windowSizeClass", () => {
  // A phone's window either way up and a third of an iPad stay compact; an
  // iPad's window and half of one are regular.
  it.each([
    {
      window: "an iPhone in portrait",
      width: 402,
      height: 874,
      sizeClass: WINDOW_SIZE_CLASS.COMPACT,
    },
    {
      window: "an iPhone on its side",
      width: 874,
      height: 402,
      sizeClass: WINDOW_SIZE_CLASS.COMPACT,
    },
    {
      window: "a third of an iPad in Split View",
      width: 375,
      height: 1024,
      sizeClass: WINDOW_SIZE_CLASS.COMPACT,
    },
    {
      window: "half of an iPad in Split View",
      width: 678,
      height: 1024,
      sizeClass: WINDOW_SIZE_CLASS.REGULAR,
    },
    {
      window: "an iPad in portrait",
      width: 834,
      height: 1194,
      sizeClass: WINDOW_SIZE_CLASS.REGULAR,
    },
  ])("reads $window as $sizeClass", ({ width, height, sizeClass }) => {
    expect(windowSizeClass(width, height)).toBe(sizeClass);
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
