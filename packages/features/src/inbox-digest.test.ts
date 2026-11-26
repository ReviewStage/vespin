/**
 * inbox-digest.test.ts -- a write drawn over a thread's row, which carries a digest of its thread rather than the thread: what the row then says it still asks, and its latest words.
 */

import { describe, expect, it } from "vitest";
import { inboxRowDrawn, inboxRowOf } from "./inbox-digest.js";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
  type InboxMessage,
} from "./inbox-wire.js";
import { answeredNow } from "./inbox-writes.js";

const OLDER_ASK = "0b6e2f1a-3c4d-4e5f-8a9b-1c2d3e4f5a60";
const LATEST_ASK = "1c7f3a2b-4d5e-4f60-9b0c-2d3e4f5a6b71";

/** An agent's message at `at`, asking which way to go where `asks` names its id. */
function message(id: string, at: number, asks = false): InboxMessage {
  return {
    id,
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: `Said at ${at}`,
    ...(asks
      ? {
          ask: {
            type: INBOX_ASK.DECIDE,
            status: INBOX_ASK_STATUS.OPEN,
            options: [{ label: "Left" }, { label: "Right" }],
          },
        }
      : undefined),
    createdAt: at,
  };
}

describe("inboxRowDrawn", () => {
  it("keeps an older ask still open, from beyond the row's tail, once the reader answers the latest", () => {
    // Note that the older ask stands seven messages back, past the six the row's tail keeps.
    const thread = [
      message(OLDER_ASK, 1, true),
      ...[2, 3, 4, 5, 6, 7].map((at) => message(`said-${at}`, at)),
      message(LATEST_ASK, 8, true),
    ];

    const item: InboxItem = {
      id: "item-1",
      agentId: "agent-1",
      key: "route",
      revision: 1,
      version: INBOX_WIRE_VERSION,
      title: "Which way?",
      needsReply: true,
      status: INBOX_STATUS.OPEN,
      thread,
      postedAt: 1,
      updatedAt: 8,
    };

    const drawn = inboxRowDrawn(inboxRowOf(item), (whole) =>
      answeredNow(
        whole,
        {
          key: "reply-1",
          text: "Right",
          answers: { ask: LATEST_ASK, reply: INBOX_REPLY.ANSWERED, choices: ["Right"] },
        },
        { userId: "user-dana", name: "Dana" },
        9,
      ),
    );

    expect({
      openAsks: drawn?.digest.openAsks.map((each) => each.id),
      latest: drawn?.digest.tail.at(-1)?.id,
      allMember: drawn?.digest.allMember,
    }).toEqual({ openAsks: [OLDER_ASK], latest: "reply-1", allMember: false });
  });
});
