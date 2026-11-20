import assert from "node:assert/strict";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { test } from "vitest";
import { AGENT_PART, agentParts } from "./agent-parts.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { managerChatLines, managerChatRuns } from "./manager-chat.js";

/**
 * manager-chat.test.ts -- a Manager's transcript as its chat: people's lines
 * stand, the lines its agents and wakes sent it go, each `send_to_user` call
 * stands as a message of its own, and the messages stand in runs by sender.
 * Synthetic words.
 */

function line(id: string, fields: Partial<AgentTranscriptMessage>): AgentTranscriptMessage {
  return { id, role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: id }], ...fields };
}

function turn(
  id: string,
  parts: readonly WireRecord[],
  fields: Partial<AgentTranscriptMessage> = {},
): AgentTranscriptMessage {
  return { id, role: MESSAGE_ROLE.ASSISTANT, parts, ...fields };
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

test("a Manager's chat keeps people's lines, each sent message as one of its own, and the voice's lines on a call, and leaves out its other words and calls, its agents' and wakes' lines, and a turn that sent nothing", () => {
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
    line("asked", {
      metadata: { author: "developer", channel: "voice", voice_session_id: "call" },
    }),
    turn("said", [{ type: "text", text: "Two agents are on it." }], {
      metadata: { author: "voice_model", channel: "voice", voice_session_id: "call" },
      sentAt: 5_000,
    }),
  ];

  assert.deepEqual(drawn(messages), [
    ["ada", ["ada"]],
    ["turn-1", ["On it: I made the task."]],
    ["second", ["An agent is working on it."]],
    ["grace", ["grace"]],
    ["asked", ["asked"]],
    ["said", ["Two agents are on it."]],
  ]);
  assert.equal(managerChatLines(messages).at(-1)?.finishedAt, 5_000);
});

test("a line that reached a turn while it ran stands between the messages it arrived between, and only the turn's last message keeps its end", () => {
  const messages = [
    turn(
      "turn",
      [
        { type: "step-start" },
        sent("before", "Starting the agent.", "accepted"),
        { type: "step-start" },
        sent("after", "Started.", "accepted"),
      ],
      { startedAt: 1_000, finishedAt: 9_000 },
    ),
    line("steer", { arrivedIn: { journalId: "turn", afterStep: 1 } }),
  ];

  const chat = managerChatLines(messages);

  assert.deepEqual(drawn(messages), [
    ["turn", ["Starting the agent."]],
    ["steer", ["steer"]],
    ["after", ["Started."]],
  ]);
  assert.deepEqual(
    chat.map((message) => message.finishedAt),
    [undefined, undefined, 9_000],
  );
  assert.equal(chat[1]?.arrivedIn, undefined);
});

test("a Manager's chat runs one sender's messages together until another sender writes or ten minutes pass, and counts the people who wrote", () => {
  const minute = 60_000;

  const chat = [
    line("mine", { sentAt: 0 }),
    line("mine-landed", { sentAt: minute, sentBy: { name: "Ada", userId: "u-ada" } }),
    line("grace", { sentAt: 2 * minute, sentBy: { name: "Grace", userId: "u-grace" } }),
    turn("one", [], { startedAt: 3 * minute }),
    turn("two", [], { startedAt: 3 * minute }),
    turn("later", [], { startedAt: 30 * minute }),
  ];

  const runs = managerChatRuns(chat, "u-ada");

  assert.deepEqual(
    chat.map((message) => {
      const place = runs.places.get(message.id);

      return [message.id, place?.opens, place?.closes];
    }),
    [
      ["mine", true, false],
      ["mine-landed", false, true],
      ["grace", true, true],
      ["one", true, false],
      ["two", false, true],
      ["later", true, true],
    ],
  );
  assert.equal(runs.people, 2);
});
