import assert from "node:assert/strict";
import { Schema } from "effect";
import { test } from "vitest";
import { MANAGER_CHAT_READ, managerChatPageOf, withReaction } from "./manager-chat-live.js";

/**
 * manager-chat-live.test.ts -- a Manager's chat page as a reader reads it
 * from its rows: a reaction of any kind, by its Slack name and emoji, and
 * a press of one drawn in its place. Synthetic words.
 */

/** A message's row as the statement answers it, its reactions in their lists. */
function rowWith(reactions: {
  readonly kinds: readonly string[];
  readonly counts: readonly number[];
  readonly reacted: readonly boolean[];
  readonly emoji: readonly string[];
}) {
  return {
    id: "message-1",
    seq: 1,
    clientKey: "key-1",
    authorKind: "agent",
    authorUserId: null,
    authorName: "Manager",
    text: "Shipped the table.",
    attachments: [],
    threadRoot: null,
    broadcast: false,
    turnId: null,
    lineId: null,
    createdAt: 1_000,
    editedAt: null,
    reactionKinds: reactions.kinds,
    reactionCounts: reactions.counts,
    reactionsReacted: reactions.reacted,
    reactionEmoji: reactions.emoji,
  };
}

test("reads a message given a reaction beyond 👍 and 👎, with the emoji its row carries", () => {
  const rows = Schema.decodeUnknownSync(MANAGER_CHAT_READ.rows)({
    messages: [
      rowWith({
        kinds: ["thumbsup", "tada"],
        counts: [1, 2],
        reacted: [false, true],
        emoji: ["👍", "🎉"],
      }),
    ],
  });

  assert.deepEqual(
    managerChatPageOf(rows).messages.map((message) => message.reactions),
    [
      [
        { kind: "thumbsup", count: 1, reacted: false, emoji: "👍" },
        { kind: "tada", count: 2, reacted: true, emoji: "🎉" },
      ],
    ],
  );
});

test("draws a press of a kind new to the message after 👍 and 👎 and the kinds before it, and one already given in its place", () => {
  const given = [
    { kind: "eyes", count: 1, reacted: false, emoji: "👀" },
    { kind: "tada", count: 1, reacted: false, emoji: "🎉" },
  ];

  const pressed = withReaction(
    withReaction(withReaction(given, "heart", true, "❤️"), "thumbsdown", true),
    "eyes",
    true,
  );

  assert.deepEqual(pressed, [
    { kind: "thumbsdown", count: 1, reacted: true },
    { kind: "eyes", count: 2, reacted: true, emoji: "👀" },
    { kind: "tada", count: 1, reacted: false, emoji: "🎉" },
    { kind: "heart", count: 1, reacted: true, emoji: "❤️" },
  ]);
});
