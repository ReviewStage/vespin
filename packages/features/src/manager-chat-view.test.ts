import assert from "node:assert/strict";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { test } from "vitest";
import { AGENT_PART, type AgentPart } from "./agent-parts.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "./manager-chat-live.js";
import { managerChatView } from "./manager-chat-view.js";

/**
 * manager-chat-view.test.ts -- a Manager's chat drawn from its rows: oldest
 * first in runs by sender, and each ended turn's work, less what the chat
 * draws, opened by the Manager's last message of the turn, the turn under
 * way's apart. Synthetic words.
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

test("a Manager's chat stands oldest first in runs by sender, a pause past ten minutes opening a new one, and the Manager's last message of each ended turn opens that turn's work, less its steps and what it sent, the turn under way's apart", () => {
  const rows = [
    row("m5", 9, 40, { turn: "t3" }),
    row("ben", 8, 39, { person: "user-ben" }),
    row("m4", 7, 30, { turn: "t2" }),
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
      ["m2", true, false, undefined],
      ["m3", false, true, "t1"],
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
