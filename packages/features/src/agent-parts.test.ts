import assert from "node:assert/strict";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { test } from "vitest";
import { computerAppNamed, computerAppsOf } from "./agent-parts.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";

/**
 * agent-parts.test.ts -- the apps a conversation's computer calls used, each
 * named once: a call's row wears its app's real icon even where its own
 * answer kept none, and every spelling of an app finds the same one.
 * Synthetic words.
 */

const ICON = {
  id: "e4a7c1f2-93b6-4d08-8a5e-6b1f0c2d9e47",
  mediaType: "image/png",
  width: 64,
  height: 64,
  byteCount: 4_100,
};

function computer(callId: string, input: WireRecord, output: WireRecord): WireRecord {
  return { type: "tool-computer", toolCallId: callId, state: "output-available", input, output };
}

/** Each call's app's icon, by its call, as its row wears it. */
function iconsByCall(messages: readonly AgentTranscriptMessage[]): [string, string | undefined][] {
  return [...computerAppsOf(messages).byCall].map(([callId, app]) => [callId, app.icon]);
}

function turn(id: string, parts: readonly WireRecord[]): AgentTranscriptMessage {
  return { id, role: MESSAGE_ROLE.ASSISTANT, parts };
}

test("a computer call that kept no icon wears the one an earlier call on its app kept, and one on an app no call kept an icon for wears none", () => {
  const messages = [
    turn("turn-1", [
      computer(
        "read-1",
        { action: "get_app_state", app: "Calculator" },
        { status: "ran", app: { name: "Calculator", refused: false, icon: { picture: ICON } } },
      ),
    ]),
    turn("turn-2", [
      computer(
        "click-1",
        { action: "click", app: "Calculator", element_index: 7 },
        { status: "ran", done: "pressed", app: { name: "Calculator", refused: false } },
      ),
      computer(
        "click-2",
        { action: "click", app: "Notes", element_index: 3 },
        { status: "ran", done: "pressed", app: { name: "Notes", refused: false } },
      ),
    ]),
  ];

  assert.deepEqual(iconsByCall(messages), [
    ["read-1", ICON.id],
    ["click-1", ICON.id],
    ["click-2", undefined],
  ]);
});

test("an app is one however a call spells it, the Mac's name in any case or its bundle id, so a call still running wears its icon at once and a mention by its bundle id finds the Mac's name", () => {
  const running = (callId: string, app: string): WireRecord => ({
    type: "tool-computer",
    toolCallId: callId,
    state: "input-available",
    input: { action: "click", app, element_index: 7 },
  });

  const messages = [
    turn("turn-1", [
      computer(
        "read-1",
        { action: "get_app_state", app: "Calculator" },
        {
          status: "ran",
          app: {
            name: "Calculator",
            bundleId: "com.apple.calculator",
            refused: false,
            icon: { picture: ICON },
          },
        },
      ),
    ]),
    turn("turn-2", [running("click-1", "calculator"), running("click-2", "com.apple.calculator")]),
  ];

  const apps = computerAppsOf(messages);

  assert.deepEqual(iconsByCall(messages), [
    ["read-1", ICON.id],
    ["click-1", ICON.id],
    ["click-2", ICON.id],
  ]);
  assert.equal(new Set(apps.byCall.values()).size, 1);
  assert.equal(computerAppNamed(apps, "COM.APPLE.CALCULATOR")?.name, "Calculator");
});
