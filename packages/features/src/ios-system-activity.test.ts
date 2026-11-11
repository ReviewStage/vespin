import { describe, expect, it } from "vitest";
import { taskHolder } from "./inbox-list-model.js";
import {
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "./inbox-wire.js";
import {
  agentActivity,
  iosContinuedRouteOf,
  pullRequestActivity,
  SPOTLIGHT_DOMAIN,
  spotlightChanges,
  spotlightItems,
  taskActivity,
  threadActivity,
} from "./ios-system-activity.js";
import { TASK_STATUS, type TaskSummary } from "./task-wire.js";
import { WORKSPACE_ROLE, type Workspace } from "./workspace-wire.js";

/**
 * ios-system-activity.test.ts -- what a screen hands the system, Handoff's
 * activity and Spotlight's items, opens that same screen when it comes back
 * to the app; and the index takes only what changed, and lets a workspace's
 * items go once another is chosen.
 */

const READER = "user-ada";

function workspace(id: string, slug: string, name: string): Workspace {
  return { id, slug, name, role: WORKSPACE_ROLE.MEMBER, github: null };
}

const ACME = workspace("workspace-acme", "acme", "Acme");
const OTHER = workspace("workspace-other", "other", "Other");

function task(id: string, workspaceId: string, more: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    workspaceId,
    name: `Task ${id}`,
    createdAt: 0,
    updatedAt: 0,
    repository: null,
    status: TASK_STATUS.IN_PROGRESS,
    ownerId: READER,
    createdBy: { userId: READER, name: "Ada Lovelace" },
    ...more,
  };
}

function thread(id: string, title: string, words: string): InboxItem {
  return {
    id,
    agentId: "agent-1",
    key: id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: false,
    status: INBOX_STATUS.OPEN,
    thread: [
      { id: `${id}-message`, author: INBOX_MESSAGE_AUTHOR.AGENT, text: words, createdAt: 1 },
    ],
    postedAt: 1,
    updatedAt: 1,
  };
}

const INVITES = task("task-1", ACME.id, { number: 42, name: "Resend expired invites" });
const ELSEWHERE = task("task-2", OTHER.id);
const ASK = { holder: taskHolder(INVITES), item: thread("item-1", "Which expiry?", "Pick one.") };
const ELSEWHERE_ASK = { holder: taskHolder(ELSEWHERE), item: thread("item-2", "Elsewhere", "") };

// Note that the regression these catch is a screen's activity naming a page the app routes elsewhere, or
// nowhere: a pull request's page is its agent's Changes, which only its number brings back to its screen.
describe("a screen's activity, continued on another of the member's devices", () => {
  it.each([
    [
      "a thread",
      threadActivity(ASK, [ACME]),
      "https://vespin.dev/acme/inbox/item-1",
      "/inbox/item-1",
    ],
    ["a task", taskActivity(INVITES, [ACME]), "https://vespin.dev/acme/task/42", "/tasks/42"],
    [
      "an agent",
      agentActivity({ id: "agent-1", title: "Invites", workspaceId: ACME.id, taskId: INVITES.id }, [
        ACME,
      ]),
      "https://vespin.dev/acme/task/task-1/agent/agent-1",
      "/tasks/agent/agent-1",
    ],
    [
      "a pull request",
      pullRequestActivity(
        { agentId: "agent-1", workspaceId: ACME.id, number: 7, title: "Resend invites" },
        [ACME],
      ),
      "https://vespin.dev/acme/agent/agent-1/changes",
      "/tasks/agent/agent-1/pull/7",
    ],
  ])("%s names its page on vespin.dev and opens on its own screen", (_, activity, page, route) => {
    expect(activity.webpageUrl).toBe(page);
    expect(
      iosContinuedRouteOf({
        link: activity.webpageUrl,
        ...(activity.pullRequest === undefined ? {} : { pullRequest: activity.pullRequest }),
      }),
    ).toBe(route);
  });

  it("leaves a page the app draws no screen for, or a link not ours, to the web", () => {
    expect(iosContinuedRouteOf({ link: "https://vespin.dev/acme/agent/agent-1/changes" })).toBe(
      undefined,
    );
    expect(iosContinuedRouteOf({ link: "https://example.com/acme/task/42" })).toBe(undefined);
  });
});

describe("the Spotlight index", () => {
  const read = { tasks: [INVITES, ELSEWHERE], threads: [ASK, ELSEWHERE_ASK], readerId: READER };

  it("holds the chosen workspace's tasks and threads, each named by a link that opens it", () => {
    const items = spotlightItems({ ...read, workspace: ACME });

    expect(items).toEqual([
      {
        id: "https://vespin.dev/acme/task/42",
        domain: SPOTLIGHT_DOMAIN.TASK,
        title: "Resend expired invites",
        summary: "In progress · Acme",
      },
      {
        id: "https://vespin.dev/acme/inbox/item-1",
        domain: SPOTLIGHT_DOMAIN.THREAD,
        title: "Which expiry?",
        summary: "Pick one.",
      },
    ]);
    expect(items.map(({ id }) => iosContinuedRouteOf({ link: id }))).toEqual([
      "/tasks/42",
      "/inbox/item-1",
    ]);
  });

  it("takes only what is new or reads otherwise, and lets the last workspace's items go", () => {
    const indexed = new Map(
      spotlightItems({ ...read, workspace: ACME }).map((item) => [item.id, item]),
    );
    const renamed = { ...INVITES, name: "Resend invites" };

    expect(
      spotlightChanges(indexed, spotlightItems({ ...read, tasks: [renamed], workspace: ACME })),
    ).toEqual({
      index: [expect.objectContaining({ title: "Resend invites" })],
      remove: [],
    });
    expect(spotlightChanges(indexed, spotlightItems({ ...read, workspace: OTHER }))).toEqual({
      index: [
        expect.objectContaining({ id: "https://vespin.dev/other/task/task-2" }),
        expect.objectContaining({ id: "https://vespin.dev/other/inbox/item-2" }),
      ],
      remove: ["https://vespin.dev/acme/task/42", "https://vespin.dev/acme/inbox/item-1"],
    });
  });
});
