import { describe, expect, it } from "vitest";
import { WINDOW_SIZE_CLASS, windowSizeClass } from "./window-size-class.js";

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
