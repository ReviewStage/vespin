import assert from "node:assert/strict";
import { computerAppsOf } from "@repo/features/agent-parts";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { test } from "vitest";
import { sameComputerApps } from "./kept-draws.js";

/**
 * kept-draws.test.ts -- the apps a conversation's computer calls used are
 * kept from one write to the next only while they say the same of every app,
 * so a call's row is handed its app's icon the moment a call keeps one.
 * Synthetic words.
 */

const ICON = {
  id: "e4a7c1f2-93b6-4d08-8a5e-6b1f0c2d9e47",
  mediaType: "image/png",
  width: 64,
  height: 64,
  byteCount: 4_100,
};

function computer(callId: string, app: WireRecord): WireRecord {
  return {
    type: "tool-computer",
    toolCallId: callId,
    state: "output-available",
    input: { action: "get_app_state", app: "Calculator" },
    output: { status: "ran", app },
  };
}

function turn(parts: readonly WireRecord[]): AgentTranscriptMessage {
  return { id: "turn-1", role: MESSAGE_ROLE.ASSISTANT, parts };
}

test("a conversation's apps read again from a write that moved none of them are the same, and a call keeping its app's icon makes them differ", () => {
  const calculator = { name: "Calculator", refused: false };
  const before = [turn([computer("read-1", calculator)])];
  const same = [turn([computer("read-1", calculator), { type: "text", text: "Done." }])];

  const iconed = [turn([computer("read-1", { ...calculator, icon: { picture: ICON } })])];

  assert.equal(sameComputerApps(computerAppsOf(before), computerAppsOf(same)), true);
  assert.equal(
    sameComputerApps(computerAppsOf(before), computerAppsOf(iconed)),
    false,
    "the app's icon arrived, so its rows must be drawn again",
  );
});
