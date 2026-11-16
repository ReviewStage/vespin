import { assert, test } from "vitest";
import { WAVEFORM_FLOOR, waveformPeaks } from "./waveform.js";

test("each bar is its stretch's loudest sample across the channels, the loudest standing full and a silence at the floor", () => {
  // Eight samples in four bars of two: a quiet stretch, a loud one on the right channel, a silence, and a half.
  const left = Float32Array.from([0.1, -0.2, 0.1, 0.1, 0, 0, 0.3, -0.1]);
  const right = Float32Array.from([0, 0, -0.8, 0.2, 0, 0, 0, 0.4]);

  assert.deepEqual(waveformPeaks([left, right], 4), [0.25, 1, WAVEFORM_FLOOR, 0.5]);
});

test("a clip with no sound stands at the floor throughout", () => {
  assert.deepEqual(waveformPeaks([new Float32Array(6)], 3), [
    WAVEFORM_FLOOR,
    WAVEFORM_FLOOR,
    WAVEFORM_FLOOR,
  ]);
});
