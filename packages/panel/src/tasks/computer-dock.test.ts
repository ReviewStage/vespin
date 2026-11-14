import assert from "node:assert/strict";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { test } from "vitest";
import { appsInUse } from "./computer-dock.js";

/**
 * computer-dock.test.ts -- the stack over an agent's box holds every app
 * it used this turn, the one it used last first, each with the newest window
 * it read of that app, none in use once the agent is done. Synthetic words.
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
      app: {
        name: app,
        bundleId: `com.example.${app.toLowerCase()}`,
        refused: false,
        icon: { picture: ICON },
      },
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

test("every app used this turn stands once, the one used last first, each with its bundle id and newest window, an earlier turn's left out", () => {
  const messages = [
    asked("ask-1"),
    turn("turn-1", [read("r0", "Notes", OTHER_WINDOW)]),
    asked("ask-2"),
    turn("turn-2", [read("r1", "Simulator", WINDOW), read("r2", "Xcode", OTHER_WINDOW)]),
    turn("turn-3", [click("c1", "Simulator")]),
  ];

  assert.deepEqual(appsInUse(messages, true), {
    apps: [
      {
        id: "r1",
        name: "Simulator",
        bundleId: "com.example.simulator",
        icon: ICON.id,
        window: WINDOW,
        machine: undefined,
      },
      {
        id: "r2",
        name: "Xcode",
        bundleId: "com.example.xcode",
        icon: ICON.id,
        window: OTHER_WINDOW,
        machine: undefined,
      },
    ],
    using: true,
  });
});

test("the app used last is no longer in use once another tool is called, or once the agent is done, its apps still standing", () => {
  const using = [asked("ask-1"), turn("turn-1", [read("r1", "Simulator", WINDOW)])];

  const movedOn = [
    ...using,
    turn("turn-2", [call("b1", "bash", { command: "ls" }, { stdout: "", exitCode: 0 })]),
  ];

  assert.equal(appsInUse(movedOn, true)?.using, false);
  assert.deepEqual(
    appsInUse(using, false)?.apps.map((each) => each.name),
    ["Simulator"],
  );
  assert.equal(appsInUse(using, false)?.using, false);
});

test("a call the Mac refused, as for a grant it lacks, adds no app, so no blank window floats as in use", () => {
  const refused = call(
    "r1",
    "computer",
    { action: "get_app_state", app: "Notes" },
    {
      status: "not-run",
      reason: "Not run: Vespin on the developer's Mac doesn't have Screen Recording.",
      missingPermissions: ["screen_recording"],
    },
  );

  assert.equal(appsInUse([asked("ask-1"), turn("turn-1", [refused])], true), undefined);
});

test("a line sent while the turn runs steers it and keeps the apps used before it, while one sent after the turn closed opens the next", () => {
  const running = turn("turn-1", [read("r1", "Simulator", WINDOW)]);
  const steered = [asked("ask-1"), running, asked("steer-1")];
  const closed = [asked("ask-1"), { ...running, finishedAt: 1_000 }, asked("ask-2")];

  assert.deepEqual(
    appsInUse(steered, true)?.apps.map((each) => each.name),
    ["Simulator"],
  );
  assert.equal(appsInUse(closed, true), undefined);
});

test("the agent's pointer stands where the turn's newest call left its cursor, over that call's app, an earlier turn's left out", () => {
  const clickAt = (callId: string, app: string, xFraction: number, yFraction: number) =>
    call(
      callId,
      "computer",
      { action: "click", app, element_index: 4 },
      {
        status: "ran",
        done: "clicked",
        app: { name: app, refused: false },
        cursor: { xFraction, yFraction },
      },
    );

  const typed = call(
    "t1",
    "computer",
    { action: "type_text", app: "Simulator", text: "hello" },
    { status: "ran", done: "typed", app: { name: "Simulator", refused: false } },
  );

  const messages = [
    asked("ask-1"),
    turn("turn-1", [read("r0", "Notes", OTHER_WINDOW), clickAt("c0", "Notes", 0.9, 0.9)]),
    asked("ask-2"),
    turn("turn-2", [
      read("r1", "Simulator", WINDOW),
      clickAt("c1", "Simulator", 0.25, 0.5),
      clickAt("c2", "Simulator", 0.5, 0.75),
      typed,
    ]),
  ];

  assert.deepEqual(appsInUse(messages, true)?.cursor, {
    app: "r1",
    x: 0.5,
    y: 0.75,
    pressed: true,
    callId: "c2",
  });

  // Note that a read of another app that says no point leaves the pointer where it stood, over the app before it.
  const movedOn = [...messages, turn("turn-3", [read("r2", "Xcode", OTHER_WINDOW)])];
  assert.equal(appsInUse(movedOn, true)?.cursor?.app, "r1");

  assert.equal(appsInUse(messages.slice(0, 2), true)?.cursor?.callId, "c0");
  assert.equal(appsInUse([asked("ask-3"), turn("turn-4", [typed])], true)?.cursor, undefined);
});
