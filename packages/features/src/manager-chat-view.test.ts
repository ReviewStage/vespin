import assert from "node:assert/strict";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { test } from "vitest";
import { AGENT_PART, type AgentPart } from "./agent-parts.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "./manager-chat-live.js";
import {
  CHAT_LANDING,
  chatMessageLanding,
  managerChatView,
  managerWorkingLine,
} from "./manager-chat-view.js";

/**
 * manager-chat-view.test.ts -- a Manager's chat drawn from its rows: oldest
 * first in runs by sender, and each ended turn's work, less what the chat
 * draws, folded over the Manager's first message of the turn, the turn
 * under way's apart. Synthetic words.
 */

const MINUTE = 60 * 1000;

/** A row of the chat, newest first as the slice holds them, by its id and `seq`, sent `minutes` in. */
function row(
  id: string,
  seq: number,
  minutes: number,
  author: { readonly person: string } | { readonly turn: string },
): ManagerChatLiveMessage {
  const person = "person" in author;

  return {
    id,
    seq,
    clientKey: `key-${id}`,
    authorKind: person ? MANAGER_CHAT_AUTHOR.PERSON : MANAGER_CHAT_AUTHOR.AGENT,
    authorUserId: person ? author.person : null,
    authorName: person ? author.person : "Manager",
    text: id,
    attachments: [],
    threadRoot: null,
    broadcast: false,
    turnId: person ? null : author.turn,
    lineId: null,
    createdAt: minutes * MINUTE,
    editedAt: null,
  };
}

function turn(id: string, parts: readonly WireRecord[]): AgentTranscriptMessage {
  return { id, role: MESSAGE_ROLE.ASSISTANT, parts };
}

function call(tool: string, callId: string): WireRecord {
  return {
    type: `tool-${tool}`,
    toolCallId: callId,
    state: "output-available",
    input: {},
    output: { status: "accepted", pictures: [{ id: "picture" }] },
  };
}

/** What a stretch of work holds: each call by its tool and id, each thought or word by its text. */
function heldWork(parts: readonly AgentPart[] | undefined): readonly string[] | undefined {
  return parts?.map((part) => {
    if (part.kind === AGENT_PART.TOOL) return `${part.tool} ${part.callId}`;

    return part.kind === AGENT_PART.TEXT || part.kind === AGENT_PART.REASONING
      ? part.text
      : part.kind;
  });
}

test("a Manager's chat stands oldest first in runs by sender, a pause past ten minutes opening a new one, and each ended turn's work stands over the Manager's first message of the turn, less its steps and what it sent, the turn under way's apart", () => {
  const rows = [
    row("m5", 10, 40, { turn: "t3" }),
    row("ben", 9, 39, { person: "user-ben" }),
    row("m4", 8, 30, { turn: "t2" }),
    { ...row("set", 7, 6, { turn: "t1" }), text: "" },
    row("m3", 6, 5, { turn: "t1" }),
    row("m2", 5, 3, { turn: "t1" }),
    row("ada-2", 4, 2, { person: "user-ada" }),
    row("ada-1", 3, 1, { person: "user-ada" }),
  ];

  const transcript = [
    turn("t1", [
      { type: "step-start" },
      { type: "reasoning", text: "Reading the board." },
      call("send_to_user", "send-1"),
      call("list_tasks", "list-1"),
      call("send_to_user", "send-2"),
      { type: "text", text: "Done for now." },
    ]),
    turn("t2", [call("send_to_user", "send-3"), call("show_media", "show-1")]),
    turn("t3", [call("start_agent", "start-1"), call("send_to_user", "send-4")]),
  ];

  const view = managerChatView(rows, transcript, { running: "t3" });

  assert.deepEqual(
    view.messages.map(({ message, place, work }) => [message.id, place.opens, place.closes, work]),
    [
      ["ada-1", true, false, undefined],
      ["ada-2", false, true, undefined],
      // Note that a turn's work stands over its first message, in the order it was done, however it went on.
      ["m2", true, false, "t1"],
      ["m3", false, false, undefined],
      ["set", false, true, undefined],
      // Note that t2 sent its words and a set, and did nothing else, so it keeps no work to open.
      ["m4", true, true, undefined],
      ["ben", true, true, undefined],
      ["m5", true, true, undefined],
    ],
  );
  assert.deepEqual(heldWork(view.work.get("t1")), [
    "Reading the board.",
    "list_tasks list-1",
    "Done for now.",
  ]);
  assert.equal(view.work.has("t2"), false);
  assert.deepEqual(heldWork(view.live), ["start_agent start-1"]);
});

test("a reply stands in its root's thread, in runs of its own, and one also posted to the chat stands at the chat's top too", () => {
  const view = managerChatView(
    [
      { ...row("sent-too", 4, 4, { turn: "t" }), threadRoot: "ask", broadcast: true },
      { ...row("answer", 3, 3, { turn: "t" }), threadRoot: "ask" },
      { ...row("again", 2, 2, { person: "ada" }), threadRoot: "ask" },
      row("ask", 1, 1, { person: "ada" }),
    ],
    [],
    { running: undefined },
  );

  assert.deepEqual(
    view.top.map((line) => line.message.id),
    ["ask", "sent-too"],
  );
  assert.deepEqual(
    view.messages.map((line) => line.message.id),
    ["ask", "again", "answer", "sent-too"],
  );

  assert.deepEqual(
    view.threads.get("ask")?.map((line) => [line.message.id, line.place.opens]),
    [
      ["again", true],
      ["answer", true],
      ["sent-too", false],
    ],
  );
});

// Note that the regression this catches is a link to a reply landing in the chat, where it does not stand, or a reply posted to the chat too being sent off to its thread.
test("a link to a message lands on its row in the chat, a reply standing in its thread alone in that thread, and one not read nowhere yet", () => {
  const view = managerChatView(
    [
      { ...row("sent-too", 3, 3, { turn: "t" }), threadRoot: "ask", broadcast: true },
      { ...row("answer", 2, 2, { turn: "t" }), threadRoot: "ask" },
      row("ask", 1, 1, { person: "ada" }),
    ],
    [],
    { running: undefined },
  );

  assert.deepEqual(
    ["ask", "sent-too", "answer", "older"].map((id) => chatMessageLanding(view, id)),
    [
      { kind: CHAT_LANDING.CHAT },
      { kind: CHAT_LANDING.CHAT },
      { kind: CHAT_LANDING.THREAD, root: "ask" },
      { kind: CHAT_LANDING.UNREAD },
    ],
  );
});

test("the line a Manager's chat ends on names it while it works, says what waits on the reader over that, takes a client's words for a turn doing something else, offers Show work once the turn did work, and stands nowhere while no turn runs", () => {
  const idle = { live: [] };
  const busy = { live: [{ kind: AGENT_PART.OTHER } as const] };
  const working = { working: true, name: "Release manager", waiting: 0 };

  assert.equal(managerWorkingLine(idle, { ...working, working: false }), undefined);
  assert.deepEqual(managerWorkingLine(idle, working), {
    words: "Release manager is working…",
    waiting: false,
    work: false,
  });
  assert.deepEqual(managerWorkingLine(busy, { ...working, waiting: 2 }), {
    words: "Waiting on you · 2 approvals",
    waiting: true,
    work: true,
  });
  assert.equal(managerWorkingLine(idle, { ...working, phase: "Stopping…" })?.words, "Stopping…");
  assert.equal(managerWorkingLine(idle, { ...working, name: "" })?.words, "Working…");
});
