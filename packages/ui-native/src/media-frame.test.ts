// media-frame.test.ts -- a picture or a recording stands at its own shape, never past its own size, held to the bound.

import { describe, expect, it } from "vitest";
import { mediaFrame } from "./media-frame.js";

describe("mediaFrame", () => {
  it.each([
    // A wide screenshot narrows to 280 pt wide at its own shape.
    { natural: { width: 1600, height: 900 }, width: 280, height: 157.5 },
    // A tall screenshot is held to 360 pt tall, its width following.
    { natural: { width: 1206, height: 2622 }, width: 165.6, height: 360 },
    // A small icon stands at its own size, never blown up.
    { natural: { width: 64, height: 48 }, width: 64, height: 48 },
    // Media of no known size stands as a film's well at the widest.
    { natural: undefined, width: 280, height: 157.5 },
  ])("stands $natural at $width × $height", ({ natural, width, height }) => {
    const frame = mediaFrame(natural);

    expect(frame.width).toBeCloseTo(width, 1);
    expect(frame.width / frame.aspectRatio).toBeCloseTo(height, 1);
  });
});
