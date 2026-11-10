import { describe, expect, it } from "vitest";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "./inbox-wire.js";
import { INBOX_SENDING, inboxSendingDrawn } from "./inbox-writes.js";

const ASK = "b1b2c3d4-0000-4000-8000-000000000001";
const READER = { userId: "user-ada", name: "Ada Lovelace" };

/** A thread whose agent asks to pick a day. */
const ITEM: InboxItem = {
  id: "item-digest",
  agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  key: "digest-day",
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title: "Which day the digest goes out",
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  postedAt: 1_000,
  updatedAt: 1_000,
  unread: true,
  thread: [
    {
      id: ASK,
      author: INBOX_MESSAGE_AUTHOR.AGENT,
      text: "Which day?",
      createdAt: 1_000,
      ask: {
        type: INBOX_ASK.DECIDE,
        options: [{ label: "Monday" }, { label: "Friday" }],
        status: INBOX_ASK_STATUS.OPEN,
      },
    },
  ],
};

describe("inboxSendingDrawn", () => {
  it("draws a plain reply at the thread's foot until a read carries it under its key, then draws it once, as the read has it", () => {
    const sending = [{ kind: INBOX_SENDING.REPLY, key: "key-1", text: "Hold on", at: 2_000 }];
    const drawn = inboxSendingDrawn(ITEM, sending, READER);
    expect(drawn.thread?.map(({ text }) => text)).toEqual(["Which day?", "Hold on"]);
    expect(drawn.unread).toBe(false);
    const carried: InboxItem = {
      ...ITEM,
      thread: [
        ...(ITEM.thread ?? []),
        {
          id: "c1b2c3d4-0000-4000-8000-000000000009",
          author: INBOX_MESSAGE_AUTHOR.MEMBER,
          text: "Hold on",
          clientKey: "key-1",
          createdAt: 2_100,
        },
      ],
    };
    expect(inboxSendingDrawn(carried, sending, READER)).toBe(carried);
  });

  it("settles the open ask with an answer and a close while each still stands open, and leaves an item settled since as it is", () => {
    const answered = inboxSendingDrawn(
      ITEM,
      [
        {
          kind: INBOX_SENDING.REPLY,
          key: "key-2",
          text: "",
          answers: { ask: ASK, reply: INBOX_REPLY.CHOSE, choices: ["Friday"] },
          at: 2_000,
        },
      ],
      READER,
    );
    expect(answered.status).toBe(INBOX_STATUS.ANSWERED);
    expect(answered.thread?.[0]?.ask?.status).toBe(INBOX_ASK_STATUS.ANSWERED);
    const closed = inboxSendingDrawn(ITEM, [{ kind: INBOX_SENDING.CLOSE, at: 2_000 }], READER);
    expect(closed.status).toBe(INBOX_STATUS.CLOSED);
    expect(inboxSendingDrawn(answered, [{ kind: INBOX_SENDING.CLOSE, at: 3_000 }], READER)).toBe(
      answered,
    );
  });
});
