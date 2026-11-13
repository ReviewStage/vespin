import assert from "node:assert/strict";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE } from "@repo/wire";
import { test } from "vitest";
import { placedMessages } from "./agent-parts.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { CALL_ITEM, type CallItem, callItemsOf } from "./voice-call-lines.js";

/**
 * Each edge a call leaves in a transcript, as the rows the service stores in
 * the conversation's order (`seq`), against what the tab draws of them in
 * order: a call's start and end, each row, a turn folded where the voice
 * retells it, and the lines a turn took in under way inside it. The rules
 * they hold are `callItemsOf`'s.
 */

/** A row of a script: who wrote it, and its id. */
type Script = readonly AgentTranscriptMessage[];

/** A line the caller said on `call`, handed to the agent where `delegated`. */
function caller(id: string, delegated = false, call = "call-1"): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: id }],
    metadata: {
      author: MESSAGE_AUTHOR.DEVELOPER,
      channel: MESSAGE_CHANNEL.VOICE,
      voice_session_id: call,
      ...(delegated ? { delegation_id: `delegation-${id}` } : undefined),
    },
  };
}

/** A line the voice said on `call`. */
function voice(id: string, call = "call-1"): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "text", text: id }],
    metadata: {
      author: MESSAGE_AUTHOR.VOICE_MODEL,
      channel: MESSAGE_CHANNEL.VOICE,
      voice_session_id: call,
    },
  };
}

/** A turn's journal, finished unless `running`. */
function turn(id: string, running = false): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "step-start" }, { type: "text", text: id }],
    startedAt: 0,
    ...(running ? undefined : { finishedAt: 1 }),
  };
}

/** A line the developer typed, which the turn `into` took in under way where it names one. */
function typed(id: string, into?: string): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: id }],
    ...(into === undefined ? undefined : { arrivedIn: { journalId: into, afterStep: 1 } }),
  };
}

/** What the tab draws of an item, in a word: a call's start or end, a row by its id, a folded turn marked so, and the lines it took in after a colon. */
function drawn(item: CallItem): string {
  if (item.kind === CALL_ITEM.START) return `start ${item.span.callId}`;

  if (item.kind === CALL_ITEM.END) return `end ${item.span.callId}`;

  return item.folded ? `${item.message.id} folded` : item.message.id;
}

/** The rows as the tab draws them: placed (`placedMessages`), then with the calls among them. */
function drawing(script: Script): readonly string[] {
  const placed = placedMessages(script);
  const arrived = new Map(placed.map((row) => [row.message.id, row.arrived]));

  return callItemsOf(placed).map((item) => {
    const lines = item.kind === CALL_ITEM.ROW ? (arrived.get(item.message.id) ?? []) : [];

    return lines.length === 0
      ? drawn(item)
      : `${drawn(item)}: ${lines.map((line) => line.id).join(" ")}`;
  });
}

test.each<{ readonly case: string; readonly script: Script; readonly drawn: readonly string[] }>([
  {
    case: "a plain exchange: the ask handed on, the turn, and the voice retelling it, the turn folded",
    script: [caller("ask", true), voice("ack"), turn("work"), voice("retell")],
    drawn: ["start call-1", "ask", "ack", "work folded", "retell", "end call-1"],
  },
  {
    case: "small talk the voice answers itself, no turn",
    script: [caller("hello"), voice("hi")],
    drawn: ["start call-1", "hello", "hi", "end call-1"],
  },
  {
    case: "an ask handed on while the agent works: the turn runs open, the ask after it, and a line typed after the voice still reaches the turn",
    script: [
      caller("ask", true),
      voice("ack"),
      turn("work", true),
      caller("more", true),
      voice("ok"),
      typed("typed"),
    ],
    drawn: ["start call-1", "ask", "ack", "work: typed", "more", "ok", "end call-1"],
  },
  {
    case: "the caller cutting the voice off mid-sentence",
    script: [voice("cut"), caller("wait")],
    drawn: ["start call-1", "cut", "wait", "end call-1"],
  },
  {
    case: "a long ask said over pauses, handed on together",
    script: [
      caller("one", true),
      caller("two", true),
      caller("three", true),
      voice("ack"),
      turn("work"),
      voice("retell"),
    ],
    drawn: ["start call-1", "one", "two", "three", "ack", "work folded", "retell", "end call-1"],
  },
  {
    case: "a line typed into the turn a call opened, inside the turn that took it",
    script: [
      caller("ask", true),
      voice("ack"),
      turn("work"),
      typed("typed", "work"),
      voice("retell"),
    ],
    drawn: ["start call-1", "ask", "ack", "work folded: typed", "retell", "end call-1"],
  },
  {
    case: "a hand-over that failed: the line stands as said, and no turn",
    script: [caller("lost"), voice("sorry")],
    drawn: ["start call-1", "lost", "sorry", "end call-1"],
  },
  {
    case: "a line edited in the queue: the line as said, then its edit, which opens the turn",
    script: [caller("said"), caller("edited", true), turn("work"), voice("retell")],
    drawn: ["start call-1", "said", "edited", "work folded", "retell", "end call-1"],
  },
  {
    case: "a line spoken mid-turn stands after the turn, which folds all the same",
    script: [
      caller("ask", true),
      voice("ack"),
      turn("work"),
      caller("chat"),
      voice("reply"),
      voice("retell"),
    ],
    drawn: ["start call-1", "ask", "ack", "work folded", "chat", "reply", "retell", "end call-1"],
  },
  {
    case: "two delegations in a row before the agent answers",
    script: [
      caller("first", true),
      voice("ack"),
      caller("second", true),
      voice("ack-2"),
      turn("work"),
      voice("retell"),
    ],
    drawn: [
      "start call-1",
      "first",
      "ack",
      "second",
      "ack-2",
      "work folded",
      "retell",
      "end call-1",
    ],
  },
  {
    case: "the caller talking over the voice's retelling",
    script: [caller("ask", true), turn("work"), voice("retell"), caller("over")],
    drawn: ["start call-1", "ask", "work folded", "retell", "over", "end call-1"],
  },
  {
    case: "a typed turn never folds, though a call follows it",
    script: [typed("typed"), turn("work"), caller("hello"), voice("hi")],
    drawn: ["typed", "work", "start call-1", "hello", "hi", "end call-1"],
  },
  {
    case: "two calls, each between its own start and end",
    script: [
      caller("a"),
      voice("b"),
      typed("typed"),
      turn("work"),
      caller("c", false, "call-2"),
      voice("d", "call-2"),
    ],
    drawn: [
      "start call-1",
      "a",
      "b",
      "end call-1",
      "typed",
      "work",
      "start call-2",
      "c",
      "d",
      "end call-2",
    ],
  },
])("$case", ({ script, drawn: expected }) => {
  assert.deepEqual(drawing(script), expected);
});
