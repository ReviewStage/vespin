import assert from "node:assert/strict";
import { TASKS_READ } from "@repo/features/tasks-view";
import { test } from "vitest";
import { INBOX_FEED } from "./app-state-reads.js";
import { threadLookedFor, threadStanding } from "./inbox-thread-standing.js";

test("a thread opened while its kept rows still load stands as still read, never missing, and is not looked for elsewhere", () => {
  // The phone keeps its Inbox on disk, so the document's feed answered with no item and holds none.
  const reads = {
    feed: INBOX_FEED.ANSWERED,
    rowsRead: false,
    held: false,
    tasks: TASKS_READ.READY,
    inFeed: false,
  };

  // A Manager's thread, on no task, as a reopen finds the service's answer of where it stands already in hand.
  const lookup = {
    drawn: false,
    home: {
      agentId: "0b7c2f4e-3a1d-4c5e-9f8a-6d7e8f9a0b1c",
      taskId: null,
      workspaceId: "stage",
    },
    homeInbox: INBOX_FEED.READING,
  };

  assert.equal(threadLookedFor(reads), false);
  assert.equal(threadStanding(reads, lookup), INBOX_FEED.READING);
});
