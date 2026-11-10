import assert from "node:assert/strict";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { test } from "vitest";
import { appInUse } from "./computer-dock.js";

/**
 * computer-dock.test.ts -- the dock over an agent's box names the app its
 * newest call is on, with the newest window it read of that app, and stands
 * only while that call is the newest and the agent works. Synthetic words.
 */

const WINDOW = {
  id: "0c8d6b3e-5a2f-4e71-9b44-2f6a1d9e7c30",
  mediaType: "image/png",
  width: 1180,
  height: 2556,
  byteCount: 412_000,
};

const ICON = { ...WINDOW, id: "e4a7c1f2-93b6-4d08-8a5e-6b1f0c2d9e47", width: 64, height: 64 };

const OTHER_WINDOW = { ...WINDOW, id: "7b2e9f14-0d63-4a8c-b5f1-3c9e7a2d6b85" };

/** One answered call. */
function call(callId: string, tool: string, input: WireRecord, output: WireRecord): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

/** A computer call that read an app's window, keeping its icon and the window. */
function read(callId: string, app: string, window: WireRecord): WireRecord {
  return call(
    callId,
    "computer",
    { action: "get_app_state", app },
    {
      status: "ran",
      app: { name: app, refused: false, icon: { picture: ICON } },
      elements: "[0] AXWindow",
      kept: { picture: window },
    },
  );
}

/** A computer call that clicked in an app, which reads no window. */
function click(callId: string, app: string): WireRecord {
  return call(
    callId,
    "computer",
    { action: "click", app, element_index: 4 },
    { status: "ran", done: "clicked", app: { name: app, refused: false } },
  );
}

function turn(id: string, parts: readonly WireRecord[]): AgentTranscriptMessage {
  return { id, role: MESSAGE_ROLE.ASSISTANT, parts };
}

test("the newest call's app is named with its icon and the newest window read of it, another app's window passed over", () => {
  const messages = [
    turn("turn-1", [read("r1", "Simulator", WINDOW), read("r2", "Xcode", OTHER_WINDOW)]),
    turn("turn-2", [click("c1", "Simulator")]),
  ];

  assert.deepEqual(appInUse(messages, true), {
    app: "Simulator",
    icon: ICON.id,
    window: WINDOW,
  });
});

test("nothing is named once the agent calls another tool or stops working", () => {
  const using = [turn("turn-1", [read("r1", "Simulator", WINDOW)])];
  const movedOn = [
    ...using,
    turn("turn-2", [call("b1", "bash", { command: "ls" }, { stdout: "", exitCode: 0 })]),
  ];

  assert.equal(appInUse(movedOn, true), undefined);
  assert.equal(appInUse(using, false), undefined);
});
