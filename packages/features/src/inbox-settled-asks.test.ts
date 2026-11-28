import { describe, expect, it } from "vitest";
import { inboxAnsweredAsks, inboxAnsweredMarks, inboxHeldAsks } from "./inbox-settled-asks.js";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  type InboxMessage,
} from "./inbox-wire.js";

/**
 * inbox-settled-asks.test.ts -- an answered ask keeps its card at the head
 * of the reply that answered it, the pick checked, and an ask of words alone
 * is marked answered on its own message instead; a withdrawn ask stays
 * on its own message, nothing picked.
 */

const ASKING = "0c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5";
const REPLY = "1d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5f6";

/** The agent's message asking `ask`, answered, and the member's reply that answered it with `answers`. */
function answeredThread(
  ask: NonNullable<InboxMessage["ask"]>,
  answers: NonNullable<InboxMessage["answers"]>,
): readonly InboxMessage[] {
  return [
    {
      id: ASKING,
      author: INBOX_MESSAGE_AUTHOR.AGENT,
      text: "Which way?",
      ask,
      createdAt: 1_000,
    },
    { id: REPLY, author: INBOX_MESSAGE_AUTHOR.MEMBER, text: "", answers, createdAt: 2_000 },
  ];
}

describe("inboxAnsweredAsks", () => {
  it("keeps a decide's options on the reply that answered it, the pick checked and no stamp over them", () => {
    const ask = {
      type: INBOX_ASK.DECIDE,
      options: [{ label: "Ship it" }, { label: "Wait" }],
      status: INBOX_ASK_STATUS.ANSWERED,
    } as const;

    const thread = answeredThread(ask, {
      ask: ASKING,
      reply: INBOX_REPLY.CHOSE,
      choices: ["Wait"],
    });

    const answered = inboxAnsweredAsks(thread).get(REPLY);

    expect(answered?.ask.type).toBe(INBOX_ASK.DECIDE);
    expect(answered?.draft.choices).toEqual(["Wait"]);
    expect(answered?.stamped).toBe(false);
    expect(inboxAnsweredMarks(thread).size).toBe(0);
  });
});

describe("inboxAnsweredMarks", () => {
  it("marks an answered ask of words alone on its own message, with no card on the reply", () => {
    const thread = answeredThread(
      { type: INBOX_ASK.ANSWER, status: INBOX_ASK_STATUS.ANSWERED },
      { ask: ASKING, reply: INBOX_REPLY.ANSWERED },
    );

    expect(inboxAnsweredAsks(thread).size).toBe(0);
    expect([...inboxAnsweredMarks(thread)]).toEqual([ASKING]);
  });
});

describe("inboxHeldAsks", () => {
  it("keeps a withdrawn ask on its own message, and none answered", () => {
    const ask = {
      type: INBOX_ASK.DECIDE,
      options: [{ label: "Ship it" }, { label: "Wait" }],
      status: INBOX_ASK_STATUS.WITHDRAWN,
    } as const;

    const thread: readonly InboxMessage[] = [
      { id: ASKING, author: INBOX_MESSAGE_AUTHOR.AGENT, text: "Which way?", ask, createdAt: 1_000 },
    ];

    expect(inboxHeldAsks(thread).get(ASKING)?.type).toBe(INBOX_ASK.DECIDE);
    expect(inboxAnsweredAsks(thread).size).toBe(0);
  });
});
