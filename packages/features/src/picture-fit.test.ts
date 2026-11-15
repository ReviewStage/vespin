import { describe, expect, it } from "vitest";
import { encodeWithin, fitWithin } from "./picture-fit.js";

/** A JPEG's base64 as long as a picture of `bytes` bytes, a multiple of 3 so it carries no padding. */
function base64Of(bytes: number): string {
  return "A".repeat((bytes / 3) * 4);
}

/** An encoder whose picture weighs 900 bytes at full quality, less in step with the quality asked. */
const encode = (quality: number) => Promise.resolve(base64Of(Math.round(quality * 900)));

describe("fitWithin", () => {
  it("brings a camera photo's longest edge down to 2048, keeping its shape", () => {
    expect(fitWithin({ width: 4032, height: 3024 })).toEqual({ width: 2048, height: 1536 });
  });

  it("leaves a picture already within the edge as it is", () => {
    expect(fitWithin({ width: 1600, height: 1200 })).toBeUndefined();
  });
});

describe("encodeWithin", () => {
  it("steps the quality down until the picture stands within the bound", async () => {
    // 0.8 weighs 720 bytes, over 600; 0.65 weighs 585, within it.
    await expect(encodeWithin(encode, 600, 0.8)).resolves.toBe(base64Of(585));
  });

  it("answers the last try where no quality fits, so the bound still says it is too large", async () => {
    // The least quality tried from 0.8 is 0.35, which weighs 315 bytes.
    await expect(encodeWithin(encode, 100, 0.8)).resolves.toBe(base64Of(315));
  });
});
