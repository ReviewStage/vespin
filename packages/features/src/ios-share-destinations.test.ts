import { expect, test } from "vitest";
import { AGENT_KIND, AGENT_STATUS, type ListedAgent } from "./agent-wire.js";
import { inboxRowOf } from "./inbox-digest.js";
import { type InboxAnyHolder, type InboxGroup, taskHolder } from "./inbox-list-model.js";
import { INBOX_STATUS, INBOX_WIRE_VERSION, type InboxItem } from "./inbox-wire.js";
import { shareDestinationsOf } from "./ios-share-destinations.js";
import { SHARE_DESTINATION_BOUNDS, SHARE_DESTINATION_KIND } from "./ios-share-wire.js";
import { MANAGER_FACE_CHARACTER, MANAGER_FACE_COLOR } from "./manager-face.js";
import { TASK_STATUS, type TaskStatus, type TaskSummary } from "./task-wire.js";

/**
 * ios-share-destinations.test.ts -- the share sheet's snapshot holds only
 * the account's own rows of the workspace the phone works in, and each kind
 * newest moved first, cut at its bound. Synthetic ids throughout.
 */

const ACME = "workspace-acme";
const GLOBEX = "workspace-globex";
const FACE = { character: MANAGER_FACE_CHARACTER.CAT, color: MANAGER_FACE_COLOR.TEAL };

/** A task of `workspaceId`, last changed at `at`. */
function task(
  id: string,
  at: number,
  workspaceId = ACME,
  status: TaskStatus = TASK_STATUS.IN_PROGRESS,
): TaskSummary {
  return {
    id,
    workspaceId,
    number: 1,
    name: `Task ${id}`,
    createdAt: 0,
    updatedAt: at,
    repository: null,
    status,
    ownerId: "user-ada",
  };
}

/** A settled agent of `workspaceId` on `taskId` (a Manager on none), last moved at `at`. */
function agent(
  id: string,
  at: number,
  taskId: string | null,
  rest: Partial<ListedAgent> = {},
): ListedAgent {
  return {
    id,
    taskId,
    title: `Agent ${id}`,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    status: AGENT_STATUS.COMPLETED,
    createdAt: 0,
    settledAt: at,
    turnId: null,
    workspaceId: ACME,
    repository: null,
    ...rest,
  };
}

/** A Manager of `workspaceId`, last moved at `at`. */
function manager(id: string, at: number, rest: Partial<ListedAgent> = {}): ListedAgent {
  return agent(id, at, null, { kind: AGENT_KIND.MANAGER, face: FACE, ...rest });
}

/** `holder`'s group of threads, each `[id, status, at]`. */
function inbox(
  holder: TaskSummary,
  threads: readonly (readonly [string, InboxItem["status"], number])[],
): InboxGroup<InboxAnyHolder> {
  return {
    holder: taskHolder(holder),
    items: threads.map(([id, status, at]) =>
      inboxRowOf({
        id,
        agentId: "agent-replier",
        key: id,
        revision: 1,
        version: INBOX_WIRE_VERSION,
        title: `Thread ${id}`,
        needsReply: false,
        status,
        postedAt: 0,
        updatedAt: at,
      }),
    ),
  };
}

test("only the account's own rows of the workspace stand, an agent only on one of its tasks", () => {
  const work = task("t-work", 30);
  const theirs = task("t-theirs", 90, GLOBEX);

  const destinations = shareDestinationsOf({
    workspaceId: ACME,
    agents: [
      manager("m-ios", 50),
      manager("m-archived", 60, { archivedAt: 61 }),
      manager("m-globex", 70, { workspaceId: GLOBEX }),
      agent("a-work", 40, work.id),
      agent("a-globex", 80, theirs.id, { workspaceId: GLOBEX }),
      // Note that an agent on a task the account's reads never handed it stands nowhere.
      agent("a-unknown", 85, "t-unknown"),
    ],
    tasks: [work, theirs, task("t-done", 95, ACME, TASK_STATUS.DONE)],
    inbox: [
      inbox(work, [
        ["i-open", INBOX_STATUS.OPEN, 20],
        ["i-closed", INBOX_STATUS.CLOSED, 25],
      ]),
      inbox(theirs, [["i-globex", INBOX_STATUS.OPEN, 99]]),
    ],
  });

  expect(destinations).toEqual({
    workspaceId: ACME,
    rows: [
      {
        kind: SHARE_DESTINATION_KIND.MANAGER,
        id: "m-ios",
        name: "Agent m-ios",
        face: FACE,
        at: 50,
      },
      {
        kind: SHARE_DESTINATION_KIND.THREAD,
        id: "i-open",
        title: "Thread i-open",
        agentId: "agent-replier",
        holder: "Task t-work",
        holderStatus: TASK_STATUS.IN_PROGRESS,
        at: 20,
      },
      {
        kind: SHARE_DESTINATION_KIND.TASK,
        id: "t-work",
        name: "Task t-work",
        status: TASK_STATUS.IN_PROGRESS,
        at: 30,
      },
      {
        kind: SHARE_DESTINATION_KIND.AGENT,
        id: "a-work",
        name: "Agent a-work",
        task: "Task t-work",
        harness: "anthropic",
        at: 40,
      },
    ],
  });
});

test("each kind stands newest moved first, cut at its bound", () => {
  const count = SHARE_DESTINATION_BOUNDS.TASKS + 2;
  const tasks = Array.from({ length: count }, (_, index) => task(`t-${index}`, index));

  const { rows } = shareDestinationsOf({ workspaceId: ACME, agents: [], tasks, inbox: [] });

  // Note that the two oldest, changed at 0 and 1, are the ones left out.
  expect(rows.map((row) => row.id)).toEqual(
    Array.from({ length: SHARE_DESTINATION_BOUNDS.TASKS }, (_, index) => `t-${count - 1 - index}`),
  );
});
