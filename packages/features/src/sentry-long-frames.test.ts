/**
 * sentry-long-frames.test.ts -- the long frames a span is handed: only those that overlap it, summed, naming its longest script and no address it carried.
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import {
  interactionLongFrames,
  type LongFrame,
  type LongFrameScript,
  longFrameHistory,
} from "./sentry-long-frames.js";

function script(overrides: Partial<LongFrameScript>): LongFrameScript {
  return {
    duration: 10,
    forcedStyleAndLayoutDuration: 0,
    invoker: "BUTTON.onclick",
    invokerType: "event-listener",
    sourceURL: "app:///dist/renderer/chunk-A.js",
    sourceFunctionName: "",
    sourceCharPosition: -1,
    ...overrides,
  };
}

function frame(overrides: Partial<LongFrame>): LongFrame {
  return {
    startTime: 0,
    duration: 60,
    blockingDuration: 10,
    renderStart: 0,
    styleAndLayoutStart: 0,
    scripts: [],
    ...overrides,
  };
}

test("a span sums the frames that overlap it, and names the longest frame's split and longest script", () => {
  const history = longFrameHistory();
  history.add([
    // Ends before the span starts, at 1000.
    frame({
      startTime: 900,
      duration: 90,
      blockingDuration: 40,
      scripts: [script({ duration: 85 })],
    }),
    // Runs 980 to 1060: 40 ms of tasks, then renders from 1020, laying out from 1040.
    frame({
      startTime: 980,
      duration: 80,
      blockingDuration: 30,
      renderStart: 1020,
      styleAndLayoutStart: 1040,
      scripts: [script({ duration: 35, sourceFunctionName: "drawRows", sourceCharPosition: 42 })],
    }),
    frame({
      startTime: 1100,
      duration: 55,
      blockingDuration: 5,
      scripts: [
        script({ duration: 20, invoker: "Response.json.then", invokerType: "resolve-promise" }),
      ],
    }),
    // Starts after the span ends, at 1200.
    frame({ startTime: 1250, duration: 70 }),
  ]);

  assert.deepEqual(history.attributesFor(1000, 1200), {
    "long_frames.count": 2,
    "long_frames.blocking_ms": 35,
    "long_frames.longest_ms": 80,
    "long_frames.longest.work_ms": 40,
    "long_frames.longest.render_ms": 40,
    "long_frames.longest.style_layout_ms": 20,
    "long_frames.script.duration_ms": 35,
    "long_frames.script.forced_style_layout_ms": 0,
    "long_frames.script.invoker": "BUTTON.onclick",
    "long_frames.script.invoker_type": "event-listener",
    "long_frames.script.function": "drawRows",
    "long_frames.script.url": "app:///dist/renderer/chunk-A.js",
    "long_frames.script.char_position": 42,
  });
  assert.deepEqual(history.attributesFor(2000, 2100), {});
});

test("a script's invoker and file carry no address's query", () => {
  const history = longFrameHistory();
  history.add([
    frame({
      startTime: 0,
      scripts: [
        script({
          invoker: "IMG[src=https://pictures.example/a.png?X-Amz-Signature=s3cr3t].onload",
          sourceURL: "https://pictures.example/a.js?token=s3cr3t",
        }),
      ],
    }),
  ]);

  const attributes = history.attributesFor(0, 10);

  assert.equal(attributes["long_frames.script.invoker"], "IMG.onload");
  assert.doesNotMatch(String(attributes["long_frames.script.url"]), /s3cr3t/);
});

test("a slow interaction keeps what it overlapped after its frames leave what is kept", () => {
  const history = longFrameHistory();
  const interactions = interactionLongFrames(history);
  history.add([frame({ startTime: 500, duration: 300, blockingDuration: 250 })]);
  interactions.note(510.4, 280);

  // A long session's frames since, far more than a window keeps.
  history.add(
    Array.from({ length: 1000 }, (_, index) => frame({ startTime: 10_000 + index * 100 })),
  );

  assert.equal(history.attributesFor(510, 790)["long_frames.count"], undefined);
  assert.equal(interactions.of(510.9)?.["long_frames.blocking_ms"], 250);
  assert.equal(interactions.of(600), undefined);
});
