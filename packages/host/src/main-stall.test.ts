/**
 * main-stall.test.ts -- a stall's stack as Sentry reads it: oldest first, lines from 1, each frame named by its file, only the app's own frames the app's.
 */

import assert from "node:assert/strict";
import { test } from "vitest";
import { stallFrames } from "./main-stall.js";

test("the frames main paused in read oldest first, from 1, named by the files they ran from", () => {
  const scripts = new Map([
    ["1", "file:///Applications/Vespin.app/Contents/Resources/app.asar/dist/main.js"],
    ["2", "node:internal/timers"],
    ["3", "file:///Applications/Vespin.app/Contents/Resources/app.asar/node_modules/x/index.js"],
  ]);

  const frames = stallFrames(
    [
      { functionName: "", location: { scriptId: "3", lineNumber: 4, columnNumber: 0 } },
      {
        functionName: "drawTaskList",
        location: { scriptId: "1", lineNumber: 99, columnNumber: 9 },
      },
      { functionName: "listOnTimeout", location: { scriptId: "2", lineNumber: 584 } },
    ],
    scripts,
  );

  assert.deepEqual(frames, [
    {
      filename: "node:internal/timers",
      function: "listOnTimeout",
      lineno: 585,
      colno: 1,
      in_app: false,
    },
    {
      filename: "/Applications/Vespin.app/Contents/Resources/app.asar/dist/main.js",
      function: "drawTaskList",
      lineno: 100,
      colno: 10,
      in_app: true,
    },
    {
      filename: "/Applications/Vespin.app/Contents/Resources/app.asar/node_modules/x/index.js",
      function: "<anonymous>",
      lineno: 5,
      colno: 1,
      in_app: false,
    },
  ]);
});
