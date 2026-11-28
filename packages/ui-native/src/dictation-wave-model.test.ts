import { describe, expect, it } from "vitest";
import { levelOfPower } from "./dictation-wave-model.js";

describe("levelOfPower", () => {
  // Note that each level is worked by hand: the power's amplitude, 10^(dB / 20), times the desktop's gain of 4.5, capped at 1.
  it.each<[string, number | undefined, number]>([
    ["full scale fills the bar", 0, 1],
    ["a voice 20 dB down stands near half", -20, 0.45],
    ["a voice 40 dB down stands low", -40, 0.045],
    ["the recorder's silence rests", -160, 0],
    ["nothing metered rests", undefined, 0],
  ])("%s", (_, decibels, level) => {
    expect(levelOfPower(decibels)).toBeCloseTo(level, 3);
  });
});
