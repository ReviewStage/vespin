import { describe, expect, it } from "vitest";
import { inboxRowOf } from "./inbox-digest.js";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "./inbox-wire.js";
import {
  INBOX_SENDING,
  inboxRowSendingDrawn,
  inboxSendingDrawn,
  inboxSendingFile,
  inboxSendingFiles,
} from "./inbox-writes.js";

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

  it("draws a reply's pictures at once, alone or with an answer, their bytes read back from the send", () => {
    const picture = {
      attachmentId: "d1b2c3d4-0000-4000-8000-000000000001",
      name: "Picture 1",
      mediaType: "image/jpeg",
      base64: "/9j/",
    };

    const sending = [
      { kind: INBOX_SENDING.REPLY, key: "key-2", text: "", files: [picture], at: 2_000 },
    ];

    const drawn = inboxSendingDrawn(ITEM, sending, READER);

    expect(drawn.thread?.at(-1)?.files).toEqual([
      { attachmentId: picture.attachmentId, name: "Picture 1", mediaType: "image/jpeg" },
    ]);

    expect(inboxSendingFile(sending, picture.attachmentId)).toEqual({
      contentType: "image/jpeg",
      base64: "/9j/",
    });

    // The read that carries the reply names its picture under the service's own attachment, which is still drawn from the send's bytes.
    const read = [
      ...(ITEM.thread ?? []),
      {
        id: "message-2",
        author: INBOX_MESSAGE_AUTHOR.MEMBER,
        text: "",
        files: [{ attachmentId: "service-file-1", name: "Picture 1", mediaType: "image/jpeg" }],
        clientKey: "key-2",
        createdAt: 2_100,
      },
    ];

    expect(inboxSendingFile(sending, "service-file-1", read)).toEqual({
      contentType: "image/jpeg",
      base64: "/9j/",
    });

    // A reply that answers the ask carries its picture at once too.
    const answered = inboxSendingDrawn(
      ITEM,
      [
        {
          kind: INBOX_SENDING.REPLY,
          key: "key-3",
          text: "",
          answers: { ask: ASK, reply: INBOX_REPLY.CHOSE, choices: ["Friday"] },
          files: [picture],
          at: 2_000,
        },
      ],
      READER,
    );

    expect(answered.thread?.at(-1)?.files).toEqual([
      { attachmentId: picture.attachmentId, name: "Picture 1", mediaType: "image/jpeg" },
    ]);
  });

  it("hands a sent picture back with the size its header states, read as it was sent", () => {
    // A PNG's signature, then its IHDR chunk stating 640 by 480 pixels, written out by hand.
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x02, 0x80, 0x00, 0x00, 0x01, 0xe0, 0x08, 0x06, 0x00, 0x00, 0x00,
    ]);

    const base64 = Buffer.from(png).toString("base64");

    const files = inboxSendingFiles("key-4", [
      { name: "Picture 1", mediaType: "image/png", data: base64 },
    ]);

    const sending = [{ kind: INBOX_SENDING.REPLY, key: "key-4", text: "", files, at: 2_000 }];
    const [file] = files;

    expect(file === undefined ? undefined : inboxSendingFile(sending, file.attachmentId)).toEqual({
      contentType: "image/png",
      base64,
      pictureSize: { width: 640, height: 480 },
    });
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

    const closed = inboxSendingDrawn(
      ITEM,
      [{ kind: INBOX_SENDING.CLOSE, revision: ITEM.revision, at: 2_000 }],
      READER,
    );

    expect(closed.status).toBe(INBOX_STATUS.CLOSED);
    expect(
      inboxSendingDrawn(
        answered,
        [{ kind: INBOX_SENDING.CLOSE, revision: ITEM.revision, at: 3_000 }],
        READER,
      ),
    ).toBe(answered);
  });

  it("leaves open a thread the agent reopened after a close, at a newer revision than the close was sent at", () => {
    const reopened = { ...ITEM, revision: ITEM.revision + 1 };
    expect(
      inboxSendingDrawn(
        reopened,
        [{ kind: INBOX_SENDING.CLOSE, revision: ITEM.revision, at: 2_000 }],
        READER,
      ),
    ).toBe(reopened);
  });
});

describe("inboxRowSendingDrawn", () => {
  it("never draws a reply the service took again once newer messages pushed it past the row's tail, and draws one still out at the foot", () => {
    const reply = { kind: INBOX_SENDING.REPLY, key: "key-sent", text: "On it", at: 2_000 };

    // Note that the row carries only its six newest messages, every one the agent's and newer than the reply.
    const row = inboxRowOf({
      ...ITEM,
      unread: true,
      thread: [1, 2, 3, 4, 5, 6].map((place) => ({
        id: `agent-${place}`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: `Step ${place}`,
        createdAt: 2_000 + place * 100,
      })),
    });

    expect(inboxRowSendingDrawn(row, [reply], new Set(["key-sent"]), READER)).toBe(row);

    const drawn = inboxRowSendingDrawn(row, [reply], new Set(), READER);
    expect(drawn.digest.tail.at(-1)?.text).toBe("On it");
  });
});
