import assert from "node:assert/strict";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { test } from "vitest";
import { AGENT_PART, agentParts } from "./agent-parts.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { managerChatLines } from "./manager-chat.js";

/**
 * manager-chat.test.ts -- a Manager's transcript as its chat: people's lines
 * stand, the lines its agents and wakes sent it go, and each turn stands as
 * its `send_to_user` words alone. Synthetic words.
 */

function line(id: string, fields: Partial<AgentTranscriptMessage>): AgentTranscriptMessage {
  return { id, role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: id }], ...fields };
}

function turn(id: string, parts: readonly WireRecord[]): AgentTranscriptMessage {
  return { id, role: MESSAGE_ROLE.ASSISTANT, parts };
}

function sent(callId: string, text: string, status: string): WireRecord {
  return {
    type: "tool-send_to_user",
    toolCallId: callId,
    state: "output-available",
    input: { text },
    output: { status },
  };
}

/** Each chat line as its id and the words it draws. */
function drawn(messages: readonly AgentTranscriptMessage[]): [string, string[]][] {
  return managerChatLines(messages).map((message) => [
    message.id,
    agentParts(message).flatMap((part) => (part.kind === AGENT_PART.TEXT ? [part.text] : [])),
  ]);
}

test("a Manager's chat keeps people's lines and each turn's sent words, and leaves out its other words and calls, its agents' and wakes' lines, and a turn that sent nothing", () => {
  const messages = [
    line("ada", { metadata: { channel: "typed" }, sentBy: { name: "Ada", userId: "u-ada" } }),
    turn("turn-1", [
      { type: "step-start" },
      { type: "text", text: "Let me look." },
      {
        type: "tool-list_tasks",
        toolCallId: "list",
        state: "output-available",
        input: {},
        output: {},
      },
      sent("refused", "Too soon.", "rejected"),
      { type: "step-start" },
      sent("first", "On it: I made the task.", "accepted"),
      sent("second", "An agent is working on it.", "accepted"),
    ]),
    line("worker", { sentBy: { name: "Billing fix", agent: true } }),
    line("wakeup", { metadata: { channel: "app" } }),
    turn("turn-2", [{ type: "text", text: "Nothing to say yet." }]),
    line("grace", { sentBy: { name: "Grace", userId: "u-grace" } }),
  ];

  assert.deepEqual(drawn(messages), [
    ["ada", ["ada"]],
    ["turn-1", ["On it: I made the task.", "An agent is working on it."]],
    ["grace", ["grace"]],
  ]);
});
