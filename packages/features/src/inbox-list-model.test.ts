import { describe, expect, it } from "vitest";
import { inboxAttachmentAddress } from "./inbox-attachment-link.js";
import { type InboxRow, inboxRowOf } from "./inbox-digest.js";
import {
  agentHolder,
  agentInboxGroups,
  agentThreadsLine,
  INBOX_MEDIA,
  inboxThreadEventsShown,
  inboxThreadMessages,
  inboxWaitingAt,
  inboxWaitingKept,
} from "./inbox-list-model.js";
import {
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "./inbox-wire.js";
import { LINK_DESTINATION } from "./link-grammar.js";

/**
 * inbox-list-model.test.ts -- a thread as a client draws it: what a
 * message's words name in place is drawn there as what it is, a recording as
 * a video, and only what they do not name stands after them, a PDF among it;
 * and the lines of what happened to it, who closed it and where.
 */

const ITEM = "0b6e2f1a-3c4d-4e5f-8a9b-1c2d3e4f5a60";
const PLAN = "1c7f3a2b-4d5e-4f60-9b0c-2d3e4f5a6b71";
const STILL = "2d804b3c-5e6f-4071-8c1d-3e4f5a6b7c82";
const CLIP = "3e915c4d-6f70-4182-9d2e-4f5a6b7c8d93";
const SHOT = "4fa26d5e-7081-4293-8e3f-5a6b7c8d9ea4";
const MOVIE = "50b37e6f-8192-43a4-9f40-6b7c8d9eafb5";
const PLAN_PDF = "61c48f70-92a3-44b5-8a51-7c8d9eafb0c6";
const CHIME = "72d590a1-a3b4-45c6-9b62-8d9eafb0c1d7";
const ALARM = "83e6a1b2-b4c5-46d7-8c73-9eafb0c1d2e8";

/** One of the item's files' addresses, as an agent's post names it in its words. */
function address(attachmentId: string): string {
  return inboxAttachmentAddress(
    { kind: LINK_DESTINATION.INBOX_ITEM, taskId: PLAN, itemId: ITEM },
    attachmentId,
    "acme",
  );
}

describe("inboxThreadMessages", () => {
  it("plays a recording or a sound clip its words name where they name it, and draws after them only what they leave unnamed, a clip as a clip and a PDF as a file", () => {
    const item: InboxItem = {
      id: ITEM,
      agentId: "agent-1",
      key: "recording",
      revision: 1,
      version: INBOX_WIRE_VERSION,
      title: "Recorded the flow",
      needsReply: false,
      status: INBOX_STATUS.OPEN,
      thread: [
        {
          id: "message-1",
          author: INBOX_MESSAGE_AUTHOR.AGENT,
          text: `The page:\n\n![The page](${address(STILL)})\n\nThe flow:\n\n![The flow](${address(CLIP)})\n\n![The export](${address(MOVIE)})\n\n![The chime](${address(CHIME)})`,
          files: [
            { attachmentId: STILL, name: "page.png", mediaType: "image/png" },
            { attachmentId: CLIP, name: "flow.webm", mediaType: "video/webm" },
            { attachmentId: SHOT, name: "after.png", mediaType: "image/png" },
            { attachmentId: MOVIE, name: "export.mp4", mediaType: "video/mp4" },
            { attachmentId: PLAN_PDF, name: "plan.pdf", mediaType: "application/pdf" },
            { attachmentId: CHIME, name: "chime.mp3", mediaType: "audio/mpeg" },
            { attachmentId: ALARM, name: "alarm.ogg", mediaType: "audio/ogg" },
          ],
          createdAt: 1_000,
        },
      ],
      postedAt: 1_000,
      updatedAt: 1_000,
    };

    const [message] = inboxThreadMessages(item, "Agent", undefined);

    expect(message?.drawn).toEqual([
      { kind: INBOX_MEDIA.PICTURE, attachmentId: STILL },
      { kind: INBOX_MEDIA.VIDEO, attachmentId: CLIP },
      { kind: INBOX_MEDIA.VIDEO, attachmentId: MOVIE },
      { kind: INBOX_MEDIA.AUDIO, attachmentId: CHIME },
    ]);
    expect(message?.media.map(({ kind, attachmentId }) => ({ kind, attachmentId }))).toEqual([
      { kind: INBOX_MEDIA.PICTURE, attachmentId: SHOT },
      { kind: INBOX_MEDIA.AUDIO, attachmentId: ALARM },
      { kind: INBOX_MEDIA.FILE, attachmentId: PLAN_PDF },
    ]);
  });

  it("says a marker naming one of a message's files as the file's name, which stands after the words as its chip", () => {
    const item: InboxItem = {
      id: ITEM,
      agentId: "agent-1",
      key: "plan",
      revision: 1,
      version: INBOX_WIRE_VERSION,
      title: "The plan",
      needsReply: false,
      status: INBOX_STATUS.OPEN,
      thread: [
        {
          id: "message-1",
          author: INBOX_MESSAGE_AUTHOR.AGENT,
          text: "The plan is in [File: plan.pdf].",
          files: [{ attachmentId: PLAN_PDF, name: "plan.pdf", mediaType: "application/pdf" }],
          createdAt: 1_000,
        },
      ],
      postedAt: 1_000,
      updatedAt: 1_000,
    };

    const [message] = inboxThreadMessages(item, "Agent", undefined);

    expect(message?.words).toBe("The plan is in plan.pdf.");
  });

  it("keeps the values an answer filled, in the order it sent them, a yes or no as its word, so a settled thread still says what was answered", () => {
    const item: InboxItem = {
      id: ITEM,
      agentId: "agent-1",
      key: "limits",
      revision: 2,
      version: INBOX_WIRE_VERSION,
      title: "Invite limits",
      needsReply: false,
      status: INBOX_STATUS.ANSWERED,
      thread: [
        {
          id: "0c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5",
          author: INBOX_MESSAGE_AUTHOR.AGENT,
          text: "Fill in the limits.",
          createdAt: 1_000,
        },
        {
          id: "message-2",
          author: INBOX_MESSAGE_AUTHOR.MEMBER,
          text: "",
          answers: {
            ask: "0c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5",
            reply: INBOX_REPLY.ANSWERED,
            values: [
              { label: "Invites a day", value: 20 },
              { label: "Admins only", value: false },
            ],
          },
          createdAt: 2_000,
        },
      ],
      postedAt: 1_000,
      updatedAt: 2_000,
    };

    const [asking, answering] = inboxThreadMessages(item, "Agent", undefined);

    expect(asking?.values).toBeUndefined();
    expect(answering?.values).toEqual([
      { label: "Invites a day", words: "20" },
      { label: "Admins only", words: "no" },
    ]);
  });
});

describe("inboxThreadEventsShown", () => {
  it("says who resolved a notice without an answer, the reader as You, after the last message written by then", () => {
    const item: InboxItem = {
      id: ITEM,
      agentId: "agent-1",
      key: "notice",
      revision: 3,
      version: INBOX_WIRE_VERSION,
      title: "Recorded the flow",
      needsReply: false,
      status: INBOX_STATUS.CLOSED,
      closedBy: { userId: "reader-1", name: "Ada Lovelace" },
      settledAt: 2_500,
      thread: [
        { id: "message-1", author: INBOX_MESSAGE_AUTHOR.AGENT, text: "Done.", createdAt: 1_000 },
        {
          id: "message-2",
          author: INBOX_MESSAGE_AUTHOR.AGENT,
          text: "Also this.",
          createdAt: 2_000,
        },
        { id: "message-3", author: INBOX_MESSAGE_AUTHOR.AGENT, text: "Later.", createdAt: 3_000 },
      ],
      postedAt: 1_000,
      updatedAt: 3_000,
    };

    const names = { agentName: "Agent", readerId: "reader-1", memberName: () => undefined };

    expect([...inboxThreadEventsShown(item, names)]).toEqual([
      [
        1,
        [
          {
            key: ITEM,
            who: { name: "You", agent: false },
            did: "resolved this without an answer",
            at: 2_500,
          },
        ],
      ],
    ]);
  });
});

/** A thread an agent posted, open on the reader or settled, posted and last changed at the given minutes. */
function posted(
  id: string,
  agentId: string,
  status: InboxItem["status"],
  postedAt: number,
  updatedAt: number,
): InboxRow {
  return inboxRowOf({
    id,
    agentId,
    key: id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: id,
    needsReply: false,
    status,
    postedAt,
    updatedAt,
  });
}

describe("agentInboxGroups", () => {
  it("lists only the threads the agent posted, though its read answered another agent's beside them", () => {
    const own = agentHolder({
      id: "agent-1",
      name: "Invitations",
      model: "opus",
      workspaceId: "w",
      repository: null,
    });

    const other = agentHolder({
      id: "agent-2",
      name: "Digest",
      model: "opus",
      workspaceId: "w",
      repository: null,
    });

    const groups = agentInboxGroups(
      [
        { holder: own, items: [posted("own-open", "agent-1", INBOX_STATUS.OPEN, 1, 1)] },
        { holder: other, items: [posted("another-agent's", "agent-2", INBOX_STATUS.OPEN, 2, 2)] },
      ],
      "agent-1",
    );

    expect(groups.flatMap(({ items }) => items.map((item) => item.id))).toEqual(["own-open"]);
  });
});

describe("agentThreadsLine", () => {
  it("counts only the agent's own threads that wait on the reader, opening the oldest posted of them", () => {
    const line = agentThreadsLine(
      [
        posted("newer-open", "agent-1", INBOX_STATUS.OPEN, 3, 9),
        posted("older-open", "agent-1", INBOX_STATUS.OPEN, 2, 2),
        posted("answered", "agent-1", INBOX_STATUS.ANSWERED, 1, 10),
        posted("another-agent's", "agent-2", INBOX_STATUS.OPEN, 0, 0),
      ],
      "agent-1",
      undefined,
      100,
    );

    expect(line).toEqual({
      words: "Inbox",
      waiting: 2,
      opens: expect.objectContaining({ id: "older-open" }),
    });
  });

  it("says how many threads the agent posted once none waits, opening the latest changed", () => {
    const line = agentThreadsLine(
      [
        posted("answered", "agent-1", INBOX_STATUS.ANSWERED, 1, 4),
        posted("closed", "agent-1", INBOX_STATUS.CLOSED, 2, 7),
      ],
      "agent-1",
      undefined,
      100,
    );

    expect(line).toEqual({
      words: "2 threads",
      waiting: 0,
      opens: expect.objectContaining({ id: "closed" }),
    });
  });
});

describe("inboxWaitingAt", () => {
  it("counts what waits on the reader by task, by agent, and in all, in each workspace and across them, a Manager's thread toward its agent alone", () => {
    const task = {
      id: "task-1",
      workspaceId: "acme",
      name: "Ship it",
      createdAt: 1,
      updatedAt: 1,
      repository: null,
      openedAt: 1,
    };

    const manager = {
      id: "manager-1",
      name: "Release manager",
      model: "claude-opus-5-5",
      workspaceId: "stage",
      repository: null,
    };

    const groups = [
      {
        holder: { task },
        items: [
          posted("open", "agent-1", INBOX_STATUS.OPEN, 1, 1),
          posted("answered", "agent-1", INBOX_STATUS.ANSWERED, 2, 2),
        ],
      },
      { holder: { agent: manager }, items: [posted("asks", "manager-1", INBOX_STATUS.OPEN, 3, 3)] },
    ];

    const { waiting } = inboxWaitingAt(groups, undefined, 100);

    expect(waiting.get("acme")).toEqual({
      byTask: new Map([["task-1", 1]]),
      byAgent: new Map([["agent-1", 1]]),
      total: 1,
    });
    expect(waiting.get("stage")).toEqual({
      byTask: new Map(),
      byAgent: new Map([["manager-1", 1]]),
      total: 1,
    });
    expect(waiting.get(undefined)?.total).toBe(2);

    // Counted again with nothing moved, each workspace's counts are the very object held, so their readers draw nothing again.
    const kept = inboxWaitingKept(waiting, inboxWaitingAt(groups, undefined, 100).waiting);

    expect(kept.get("acme")).toBe(waiting.get("acme"));

    // A thread put away until a reminder comes due is counted again then, not at the next write.
    const reminded = [
      {
        holder: { task },
        items: [{ ...posted("later", "agent-1", INBOX_STATUS.OPEN, 1, 1), remindAt: 500 }],
      },
    ];

    const before = inboxWaitingAt(reminded, undefined, 100);

    expect(before.waiting.get("acme")).toBeUndefined();
    expect(before.nextReminderDue).toBe(500);

    const due = inboxWaitingAt(reminded, undefined, 500);

    expect(due.waiting.get("acme")?.total).toBe(1);
    expect(due.nextReminderDue).toBeUndefined();
  });
});
