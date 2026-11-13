import assert from "node:assert/strict";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { test } from "vitest";
import { appsInUse } from "./computer-dock.js";

/**
 * computer-dock.test.ts -- the stack over an agent's box holds every app
 * it used this turn, the one it used last first, each with the newest window
 * it read of that app, and stands only while the agent works. Synthetic words.
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

function asked(id: string): AgentTranscriptMessage {
  return { id, role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Try the invite flow" }] };
}

test("every app used this turn stands once, the one used last first, each with its newest window, an earlier turn's left out", () => {
  const messages = [
    asked("ask-1"),
    turn("turn-1", [read("r0", "Notes", OTHER_WINDOW)]),
    asked("ask-2"),
    turn("turn-2", [read("r1", "Simulator", WINDOW), read("r2", "Xcode", OTHER_WINDOW)]),
    turn("turn-3", [click("c1", "Simulator")]),
  ];

  assert.deepEqual(appsInUse(messages, true), {
    apps: [
      { app: "Simulator", icon: ICON.id, window: WINDOW },
      { app: "Xcode", icon: ICON.id, window: OTHER_WINDOW },
    ],
    using: true,
  });
});

test("the app used last is no longer in use once another tool is called, and nothing stands once the agent stops working", () => {
  const using = [asked("ask-1"), turn("turn-1", [read("r1", "Simulator", WINDOW)])];

  const movedOn = [
    ...using,
    turn("turn-2", [call("b1", "bash", { command: "ls" }, { stdout: "", exitCode: 0 })]),
  ];

  assert.equal(appsInUse(movedOn, true)?.using, false);
  assert.equal(appsInUse(using, false), undefined);
});
