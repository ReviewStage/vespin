import { describe, expect, it } from "vitest";
import { EMPTY_INBOX_DRAFT } from "./inbox-draft.js";
import {
  type UndeliveredReply,
  undeliveredSettled,
  undeliveredTakenBack,
} from "./inbox-undelivered.js";
import {
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "./inbox-wire.js";

/** A thread holding the reader's message sent under `clientKey`, where one is given. */
function itemHolding(id: string, clientKey?: string): InboxItem {
  return {
    id,
    agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    key: id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: "Which day the digest goes out",
    needsReply: false,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
    unread: false,
    thread:
      clientKey === undefined
        ? []
        : [
            {
              id: `message-${id}`,
              author: INBOX_MESSAGE_AUTHOR.MEMBER,
              text: "Friday",
              clientKey,
              createdAt: 2_000,
            },
          ],
  };
}

/** A reply that did not go on `itemId` under `key`. */
function line(key: string, itemId: string, startsThread?: true): UndeliveredReply {
  return {
    key,
    taskId: null,
    itemId,
    text: "Friday",
    attachments: [],
    files: 0,
    at: 2_000,
    why: "No answer came back.",
    ...(startsThread === undefined ? undefined : { startsThread }),
  };
}

describe("undeliveredSettled", () => {
  it("settles a reply its own thread holds and a start any thread holds, and keeps one whose thread is unread or holds another's key", () => {
    const lines = [
      line("reply-went", "item-a"),
      line("reply-elsewhere", "item-a"),
      line("start-went", "item-a", true),
      line("reply-unread", "item-gone"),
    ];

    const items = [
      itemHolding("item-a", "reply-went"),
      itemHolding("item-b", "reply-elsewhere"),
      itemHolding("item-started", "start-went"),
    ];

    expect([...undeliveredSettled(lines, items)]).toEqual(["reply-went", "start-went"]);
  });
});

describe("undeliveredTakenBack", () => {
  it("puts a reply taken back ahead of what was typed since, keeping the picks made since", () => {
    const went = { ...EMPTY_INBOX_DRAFT, note: "Friday", choices: ["Friday"] };
    const typed = { ...EMPTY_INBOX_DRAFT, note: "and Monday", choices: ["Monday"] };

    expect(undeliveredTakenBack(EMPTY_INBOX_DRAFT, went)).toEqual(went);
    expect(undeliveredTakenBack(typed, went)).toEqual({
      ...typed,
      note: "Friday\nand Monday",
    });
  });
});
