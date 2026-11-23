import assert from "node:assert/strict";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { test } from "vitest";
import { AGENT_PART, agentParts } from "./agent-parts.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import {
  chatReplyText,
  managerChatLines,
  managerChatRuns,
  managerChatWork,
} from "./manager-chat.js";

/**
 * manager-chat.test.ts -- a Manager's transcript as its chat: people's lines
 * stand, the lines its agents and wakes sent it go, each `send_to_user` call
 * and each set `show_media` showed stands as a message of its own, and the messages stand in runs by sender.
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

function shown(callId: string, status: string): WireRecord {
  return {
    type: "tool-show_media",
    toolCallId: callId,
    state: "output-available",
    input: { images: [{ path: "/tmp/shared/home.png", caption: "Home" }] },
    output: status === "accepted" ? { status, pictures: [{ id: "picture" }] } : { status },
  };
}

/** Each chat line as its id and what it draws: its words, and each call it draws as the call shown. */
function drawn(messages: readonly AgentTranscriptMessage[]): [string, string[]][] {
  return managerChatLines(messages).map((message) => [
    message.id,
    agentParts(message).flatMap((part) => {
      if (part.kind === AGENT_PART.TOOL) return [`${part.tool} ${part.callId}`];

      return part.kind === AGENT_PART.TEXT ? [part.text] : [];
    }),
  ]);
}

test("a Manager's chat keeps people's lines, each sent message and each set shown as one of its own, and the voice's lines on a call, and leaves out its other words and calls, a set refused, its agents' and wakes' lines, and a turn that sent nothing", () => {
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
      shown("unshown", "rejected"),
      shown("screenshot", "accepted"),
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
    ["screenshot", ["show_media screenshot"]],
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

test("a Manager's message keeps the work that led to it, a turn's last the work after it too, and the turn under way its work since its last message, while a finished turn that sent nothing keeps none", () => {
  const call = (id: string): WireRecord => ({
    type: "tool-list_tasks",
    toolCallId: id,
    state: "output-available",
    input: {},
    output: {},
  });

  const messages = [
    turn("turn-1", [
      { type: "step-start" },
      { type: "reasoning", text: "Ada wants the billing bug fixed." },
      call("list"),
      sent("first", "On it.", "accepted"),
      { type: "text", text: "Starting an agent." },
      sent("second", "An agent is working on it.", "accepted"),
      { type: "reasoning", text: "I'll wait for it." },
    ]),
    line("ada", { sentBy: { name: "Ada", userId: "u-ada" } }),
    turn("turn-2", [{ type: "step-start" }, call("check")]),
  ];

  /** Each piece of work as its kind and its words or call. */
  const named = (parts: readonly ReturnType<typeof agentParts>[number][] | undefined) =>
    (parts ?? []).map((part) =>
      part.kind === AGENT_PART.TOOL
        ? `call ${part.callId}`
        : `${part.kind} ${"text" in part ? part.text : ""}`,
    );

  const running = managerChatWork(messages, true);

  assert.deepEqual(named(running.work.get("turn-1")), [
    "reasoning Ada wants the billing bug fixed.",
    "call list",
  ]);
  assert.deepEqual(named(running.work.get("second")), [
    "text Starting an agent.",
    "reasoning I'll wait for it.",
  ]);
  assert.deepEqual(named(running.live), ["call check"]);

  const ended = managerChatWork(messages, false);

  assert.deepEqual(named(ended.live), []);
  assert.equal(ended.work.has("turn-2"), false);
});

test("a Manager's chat runs one sender's messages together until another sender writes or ten minutes pass", () => {
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
});

test("a reply sends the Manager's message as one quoted line over the person's words, and reads back as a reply to the nearest message it quotes, whole or cut short", () => {
  const long = `${"word ".repeat(80)}end`;

  assert.equal(
    chatReplyText("**Done**: opened [the PR](https://example.com/pr)\n\nAnything else?", "Ship it"),
    "> Done: opened the PR Anything else?\n\nShip it",
  );

  const said = (text: string) => [{ type: "text", text }];

  const chat = [
    turn("early", said("Ship it?")),
    line("first", { parts: said("Yes") }),
    turn("asked", said("Ship it?")),
    turn("long", said(long)),
    line("answer", { parts: said("> Ship it?\n\nYes, now") }),
    line("cut", { parts: said(`> ${"word ".repeat(55)}word…\n\nok`) }),
    line("unknown", { parts: said("> Something no one said\n\nHm") }),
  ];

  const { replies } = managerChatRuns(chat, undefined);

  assert.deepEqual(replies.get("answer"), { to: "asked", quote: "Ship it?", words: "Yes, now" });
  assert.equal(replies.get("cut")?.to, "long");
  assert.equal(chatReplyText(long, "ok"), `> ${"word ".repeat(55)}word…\n\nok`);
  assert.deepEqual([...replies.keys()], ["answer", "cut"]);
});
