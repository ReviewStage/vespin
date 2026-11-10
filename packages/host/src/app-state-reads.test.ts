import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
  type InboxMessage,
} from "@repo/features/inbox-wire";
import { describe, expect, it } from "vitest";
import { INBOX_ROW_LINE, inboxRowsOf } from "./app-state-reads.js";

/**
 * app-state-reads.test.ts -- a thread waiting on the developer reads as its
 * latest message asks: a decide ask's options and recommendation, a notice's
 * words, and a thread the feed does not hold yet by its title alone.
 */

const TASK = "task-1";
const AGENT = "agent-1";
const ADA = { userId: "user-ada", name: "Ada Lovelace" };

function item(id: string, title: string, text: string, ask?: InboxMessage["ask"]): InboxItem {
  return {
    id,
    agentId: AGENT,
    key: id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: ask !== undefined,
    status: INBOX_STATUS.OPEN,
    startedBy: ADA,
    waitsOn: ADA,
    thread: [
      {
        id: `${id}-1`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text,
        ...(ask === undefined ? {} : { ask }),
        createdAt: 1_000,
      },
    ],
    postedAt: 1_000,
    updatedAt: 2_000,
    unread: true,
  };
}

describe("inboxRowsOf", () => {
  it("reads a decide ask's options and recommendation, a notice's words, and a thread the feed lacks by its title", () => {
    const decide = item("decide", "Who can withdraw an invite?", "Who may?\nMore words.", {
      type: INBOX_ASK.DECIDE,
      options: [{ label: "Any admin", detail: "Senders wait." }, { label: "Both" }],
      recommended: "Both",
      status: INBOX_ASK_STATUS.OPEN,
    });
    const notice = item(
      "notice",
      "acceptInvite can add a member twice",
      "The member is added twice.",
    );
    const rows = inboxRowsOf(
      {
        waiting: [
          {
            taskId: TASK,
            items: [
              { id: "decide", agentId: AGENT, title: decide.title, postedAt: 1_000, asking: true },
              { id: "notice", agentId: AGENT, title: notice.title, postedAt: 1_000, asking: false },
              { id: "unheld", agentId: AGENT, title: "Not fed yet", postedAt: 3_000 },
            ],
          },
        ],
        tasks: [],
        failedRuns: [],
      },
      {
        rows: { [INBOX_SCOPE_KIND.PLAN]: { [TASK]: [decide, notice] } },
      },
    );
    expect(rows).toEqual([
      {
        id: "decide",
        title: "Who can withdraw an invite?",
        summary: "Who may?",
        at: 2_000,
        unread: true,
        line: INBOX_ROW_LINE.DECIDE,
        ask: {
          question: "Who may?",
          choices: [{ label: "Any admin", detail: "Senders wait." }, { label: "Both" }],
          recommended: ["Both"],
        },
      },
      {
        id: "notice",
        title: "acceptInvite can add a member twice",
        summary: "The member is added twice.",
        at: 2_000,
        unread: true,
        line: INBOX_ROW_LINE.SAID,
      },
      {
        id: "unheld",
        title: "Not fed yet",
        summary: "An agent is waiting on your answer.",
        at: 3_000,
        line: INBOX_ROW_LINE.SAID,
      },
    ]);
  });
});
