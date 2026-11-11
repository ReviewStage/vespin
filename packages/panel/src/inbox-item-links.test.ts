import assert from "node:assert/strict";
import { LINK_DESTINATION, type ReadLink } from "@repo/features/link-grammar";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { it } from "vitest";
import { besideItem, type InboxItemHere } from "./inbox-item-links.js";
import { createPanelRouter } from "./panel-router.js";
import { addressOf, HERE, ROUTE, type Route, THING, type Thing } from "./places/pressed-address.js";

/**
 * inbox-item-links.test.ts -- what a link pressed on an Inbox item opens
 * beside it, one row per kind of address, each a place in the app matched
 * on the window's route tree, standing under Acme. Synthetic ids.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OTHER = "5b7d9f1a-3c5e-4a7b-9d1f-2b4c6d8e0f1a";
const PAGE = "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b";
const THREAD = "PRRT_kwDOA1";
const MESSAGE = "4a6c8e0b-2d4f-4b6d-8f0a-1c3e5a7b9d2c";
const INBOX_ITEM = "6e8a0c2d-4f6b-4d8f-a1c3-5e7a9b1d3f4e";
const PR = "https://github.com/acme/relay/pull/42";
const FILE = "https://github.com/acme/relay/blob/HEAD/src/invites.ts";
const APP = "https://vespin.dev/acme";

/** The window's router, standing on Acme's Inbox. */
const ROUTER = createPanelRouter(
  createMemoryHistory({ initialEntries: ["/acme/inbox"] }),
  new QueryClient(),
);

/** A task's or an agent's: its repository, and one agent, which opened the pull request numbered 42. */
const HOLDING = {
  repository: "acme/relay",
  pullRequests: new Map([[AGENT, { url: PR }]]),
  agentIds: [AGENT],
  heldIds: undefined,
};

/** The same, its agent archived: no longer drawn, though still held. */
const ARCHIVED = { ...HOLDING, agentIds: [], heldIds: [AGENT] };

const ITEM: InboxItemHere = { kind: HERE.INBOX_ITEM, taskId: TASK, ...HOLDING };

const NOTHING: Route = { kind: ROUTE.NOTHING };

function beside(thing: Thing): Route {
  return { kind: ROUTE.BESIDE, thing };
}

function go(link: ReadLink): Route {
  return { kind: ROUTE.GO, link };
}

it.each<[string, string, InboxItemHere, Route]>([
  [
    "an Inbox item: a pull request one of its agents opened, however its page is spelled, in that agent's Pull request tab",
    `${PR}#issuecomment-1`,
    ITEM,
    beside({ kind: THING.PULL_REQUEST, agentId: AGENT }),
  ],
  [
    "an Inbox item: another pull request of its repository, in any case, by its number in its first agent's tab",
    "https://github.com/Acme/Relay/pull/41/files",
    ITEM,
    beside({ kind: THING.PULL_REQUEST, agentId: AGENT, number: 41 }),
  ],
  [
    "an Inbox item: a pull request of another repository, the window's",
    "https://github.com/acme/other/pull/41",
    ITEM,
    NOTHING,
  ],
  [
    "an Inbox item: another pull request of its repository with none of its agents drawn, the window's",
    "https://github.com/acme/relay/pull/41",
    { ...ITEM, agentIds: [] },
    NOTHING,
  ],
  [
    "an Inbox item: a page under its agent's own pull request's, in that agent's own Pull request tab",
    `${PR}/files`,
    ITEM,
    beside({ kind: THING.PULL_REQUEST, agentId: AGENT }),
  ],
  [
    "an Inbox item: a long run of slashes, read at once as any address no pull request matches",
    `https://github.com/acme/relay/pull/43${"/".repeat(50_000)}x`,
    { ...ITEM, agentIds: undefined },
    NOTHING,
  ],
  [
    "an Inbox item: a file of its repository, beside it",
    FILE,
    ITEM,
    beside({ kind: THING.FILE, path: "src/invites.ts", lines: undefined }),
  ],
  [
    "an Inbox item: a file of another repository, beside it read from that repository",
    "https://github.com/acme/other/blob/HEAD/src/invites.ts",
    ITEM,
    beside({
      kind: THING.FILE,
      path: "src/invites.ts",
      lines: undefined,
      repository: "acme/other",
    }),
  ],
  [
    "an Inbox item not yet chosen: nothing beside it",
    FILE,
    { ...ITEM, taskId: undefined },
    NOTHING,
  ],
  [
    "an Inbox item: its task's own page, beside it",
    `${APP}/plan/${TASK}/page/${PAGE}`,
    ITEM,
    beside({ kind: THING.PAGE, pageId: PAGE }),
  ],
  [
    "an Inbox item: another task's page, a subtask's among them, beside it read on that task",
    `${APP}/plan/${OTHER}/page/${PAGE}`,
    ITEM,
    beside({ kind: THING.PAGE, pageId: PAGE, place: { taskId: OTHER } }),
  ],
  [
    "an Inbox item: a page under a task named by a number not found, the window's, which finds the task",
    `${APP}/task/42/page/${PAGE}`,
    ITEM,
    NOTHING,
  ],
  [
    "an Inbox item: a page an agent showed on itself, as an older link names it, the window's, which finds its task",
    `${APP}/agent/${OTHER}/page/${PAGE}`,
    ITEM,
    NOTHING,
  ],
  ["an Inbox item: its task's plan, the window's", `${APP}/plan/${TASK}`, ITEM, NOTHING],
  [
    "an Inbox item: an agent of its task, archived or not, to the task on its tab, never beside it",
    `${APP}/plan/${TASK}/agent/${AGENT}`,
    ITEM,
    go({
      workspace: "acme",
      place: { kind: LINK_DESTINATION.AGENT, planId: TASK, agentId: AGENT },
    }),
  ],
  [
    "an Inbox item: an agent under another task, the window's",
    `${APP}/plan/${OTHER}/agent/${AGENT}`,
    ITEM,
    NOTHING,
  ],
  ["an Inbox item: an agent not of its task, the window's", `${APP}/agent/${OTHER}`, ITEM, NOTHING],
  [
    "an Inbox item: an archived agent's Changes, beside it",
    `${APP}/agent/${AGENT}/changes`,
    { ...ITEM, ...ARCHIVED },
    beside({ kind: THING.CHANGES, agentId: AGENT }),
  ],
  [
    "an Inbox item: a message of an agent of its task, the window's, which opens the agent's tab at it",
    `${APP}/agent/${AGENT}/message/${MESSAGE}`,
    ITEM,
    NOTHING,
  ],
  [
    "an Inbox item: a review thread of an archived agent's pull request, beside it at the thread",
    `${APP}/agent/${AGENT}/changes/conversation/thread/${THREAD}`,
    { ...ITEM, ...ARCHIVED },
    beside({ kind: THING.THREAD, agentId: AGENT, threadId: THREAD, view: "conversation" }),
  ],
  [
    "an Inbox item: a review thread of an agent not of its task, the window's",
    `${APP}/agent/${OTHER}/changes/files/thread/${THREAD}`,
    ITEM,
    NOTHING,
  ],
  [
    "an Inbox item: another task's Inbox item, chosen in this Inbox",
    `${APP}/plan/${OTHER}/inbox/${INBOX_ITEM}`,
    ITEM,
    beside({ kind: THING.INBOX_ITEM, itemId: INBOX_ITEM, taskId: OTHER, agentId: undefined }),
  ],
  [
    "an Inbox item: an Inbox item an agent of its task posted, chosen in this Inbox under the task",
    `${APP}/agent/${AGENT}/inbox/${INBOX_ITEM}`,
    ITEM,
    beside({ kind: THING.INBOX_ITEM, itemId: INBOX_ITEM, taskId: TASK, agentId: AGENT }),
  ],
  [
    "an Inbox item: an Inbox item an agent it does not hold posted, the window's to find",
    `${APP}/agent/${OTHER}/inbox/${INBOX_ITEM}`,
    ITEM,
    NOTHING,
  ],
])("%s", (_, href, here, expected) => {
  assert.deepEqual(besideItem(addressOf(href, ROUTER), here), expected);
});
