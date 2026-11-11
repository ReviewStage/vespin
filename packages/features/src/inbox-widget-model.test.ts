import { describe, expect, it } from "vitest";
import { type InboxGroup, taskHolder } from "./inbox-list-model.js";
import { INBOX_WIDGET_ASK, inboxWidgetSnapshot } from "./inbox-widget-model.js";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
  type InboxMessage,
} from "./inbox-wire.js";
import { TASK_STATUS, type TaskSummary } from "./task-wire.js";

/**
 * inbox-widget-model.test.ts -- the iOS Inbox widget's snapshot counts every
 * thread that waits on the reader now, as the Inbox tab's badge does, and
 * lists the newest three, latest changed first, a reminder come due as
 * changed when it came due, each with its task's name and the ask that waits.
 */

const ME = { userId: "user-ada", name: "Ada" };
const TEAMMATE = { userId: "user-grace", name: "Grace" };
const NOW = 10_000;

/** A task of the Acme workspace. */
function task(id: string, name: string): TaskSummary {
  return {
    id,
    workspaceId: "workspace-acme",
    number: 1,
    name,
    createdAt: 0,
    updatedAt: 0,
    repository: null,
    status: TASK_STATUS.IN_PROGRESS,
    ownerId: ME.userId,
  };
}

/** An agent's post, asking `ask` where one is given. */
function post(ask?: InboxMessage["ask"]): InboxMessage {
  return {
    id: "message-1",
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: "Where do we stand?",
    createdAt: 0,
    ...(ask === undefined ? {} : { ask }),
  };
}

/** An open thread waiting on Ada, changed at `updatedAt`, with whatever `rest` overrides. */
function thread(id: string, title: string, updatedAt: number, rest: Partial<InboxItem> = {}) {
  const item: InboxItem = {
    id,
    agentId: "agent-1",
    key: id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: false,
    status: INBOX_STATUS.OPEN,
    thread: [post()],
    waitsOn: ME,
    postedAt: 0,
    updatedAt,
    ...rest,
  };
  return item;
}

const DECIDE = {
  type: INBOX_ASK.DECIDE,
  options: [{ label: "Ship it" }, { label: "Wait" }],
  status: INBOX_ASK_STATUS.OPEN,
} as const;
const DO = { type: INBOX_ASK.DO, steps: ["Add the secret."], status: INBOX_ASK_STATUS.OPEN };
const ANSWER = { type: INBOX_ASK.ANSWER, status: INBOX_ASK_STATUS.OPEN } as const;

describe("inboxWidgetSnapshot", () => {
  it("counts what waits on the reader now and lists the newest three with their task and ask", () => {
    const groups: InboxGroup[] = [
      {
        holder: taskHolder(task("task-refresh", "Fix the token refresh")),
        items: [
          thread("decide", "Ship **the** flag?", 4_500, { thread: [post(DECIDE)] }),
          thread("notice", "Opened the pull request", 5_000),
          thread("teammates", "Which region?", 9_000, {
            thread: [post(DECIDE)],
            waitsOn: TEAMMATE,
          }),
          thread("answered", "Merged", 8_000, { status: INBOX_STATUS.ANSWERED }),
        ],
      },
      {
        holder: taskHolder(task("task-invites", "Resend expired invites")),
        items: [
          thread("do", "Add the Sentry secret", 4_000, { thread: [post(DO)] }),
          thread("later", "Name the bucket", 7_000, {
            thread: [post(ANSWER)],
            remindAt: 20_000,
          }),
          thread("due", "Pick a plan", 1_000, { thread: [post(ANSWER)], remindAt: 6_000 }),
        ],
      },
    ];

    const snapshot = inboxWidgetSnapshot({
      workspace: "Acme",
      workspaces: 1,
      groups,
      readerId: ME.userId,
      now: NOW,
    });

    // Waiting: decide, notice, do, and due, whose reminder came back at 6,000; not the teammate's, the answered, or the one reminding later.
    expect(snapshot).toEqual({
      workspace: "Acme",
      waiting: 4,
      wholeAccount: true,
      rows: [
        {
          id: "due",
          title: "Pick a plan",
          task: "Resend expired invites",
          ask: INBOX_WIDGET_ASK.ANSWER,
        },
        { id: "notice", title: "Opened the pull request", task: "Fix the token refresh" },
        {
          id: "decide",
          title: "Ship the flag?",
          task: "Fix the token refresh",
          ask: INBOX_WIDGET_ASK.DECIDE,
        },
      ],
    });
  });
});
