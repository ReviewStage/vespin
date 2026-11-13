import assert from "node:assert/strict";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { test } from "vitest";
import { computerIconsByCall } from "./agent-parts.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";

/**
 * agent-parts.test.ts -- a computer call's row wears its app's real icon
 * even where its own answer kept none, borrowed from an earlier call on the
 * same app. Synthetic words.
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

  assert.deepEqual(
    [...computerIconsByCall(messages)],
    [
      ["read-1", ICON.id],
      ["click-1", ICON.id],
    ],
  );
});
