import { expect, test } from "vitest";
import { AGENT_CALL_FAILURE } from "./agent-view.js";
import { SHARE_NEW_TASK_ID } from "./ios-share-page-model.js";
import { newTaskShareWent, SHARE_SEND_KIND, shareSendsOf } from "./ios-share-send.js";
import { SHARE_DESTINATION_KIND, type ShareDestination } from "./ios-share-wire.js";
import { TASK_STATUS } from "./task-wire.js";
import { TASK_CALL_FAILURE } from "./tasks-view.js";

/**
 * ios-share-send.test.ts -- a share sends each place ticked the one write
 * its own composer makes, under that place's key, and nothing to a place the
 * snapshot no longer holds. Synthetic ids throughout.
 */

const ROWS: readonly ShareDestination[] = [
  { kind: SHARE_DESTINATION_KIND.MANAGER, id: "m-ios", name: "iOS engineer", at: 1 },
  { kind: SHARE_DESTINATION_KIND.AGENT, id: "a-fix", name: "Refresh fix", task: "Refresh", at: 2 },
  {
    kind: SHARE_DESTINATION_KIND.THREAD,
    id: "i-pick",
    title: "Pick a design",
    agentId: "a-mock",
    holder: "Share sheet",
    at: 3,
  },
  {
    kind: SHARE_DESTINATION_KIND.TASK,
    id: "t-share",
    name: "Share sheet",
    status: TASK_STATUS.TODO,
    at: 4,
  },
];

/** The key each place's write goes under, minted once for the page. */
const KEYS = new Map([
  ["m-ios", "key-1"],
  ["a-fix", "key-2"],
  ["i-pick", "key-3"],
  ["t-share", "key-4"],
  [SHARE_NEW_TASK_ID, "key-5"],
]);

const PICTURE = { name: "Picture 1", mediaType: "image/jpeg", data: "AAAA" } as const;

test("each place ticked is sent the write its own composer makes, under its own key", () => {
  const sends = shareSendsOf({
    to: ["m-ios", "a-fix", "i-pick", "t-share", SHARE_NEW_TASK_ID, "m-gone"],
    rows: ROWS,
    text: "Look at this",
    attachments: [PICTURE],
    keyOf: (to) => KEYS.get(to) ?? "key-unminted",
    newTask: { taskId: "task-new", workspaceId: "workspace-acme", repository: "acme/web" },
  });

  const message = { text: "Look at this", attachments: [PICTURE] };

  expect(sends).toEqual([
    {
      to: "m-ios",
      send: {
        kind: SHARE_SEND_KIND.MANAGER_CHAT,
        params: { agentId: "m-ios", ...message, clientKey: "key-1" },
      },
    },
    {
      to: "a-fix",
      send: {
        kind: SHARE_SEND_KIND.AGENT_MESSAGE,
        params: { agentId: "a-fix", ...message, clientKey: "key-2" },
      },
    },
    {
      to: "i-pick",
      send: {
        kind: SHARE_SEND_KIND.THREAD_REPLY,
        params: { itemId: "i-pick", ...message, clientKey: "key-3" },
      },
    },
    {
      to: "t-share",
      send: {
        kind: SHARE_SEND_KIND.TASK_AGENT,
        params: {
          taskId: "t-share",
          idempotencyKey: "key-4",
          prompt: "Look at this",
          attachments: [PICTURE],
        },
      },
    },
    {
      to: SHARE_NEW_TASK_ID,
      send: {
        kind: SHARE_SEND_KIND.NEW_TASK,
        params: {
          id: "task-new",
          workspaceId: "workspace-acme",
          repository: "acme/web",
          planning: false,
          agent: { idempotencyKey: "key-5", prompt: "Look at this", attachments: [PICTURE] },
        },
      },
    },
  ]);
});

test("a new task whose agent was refused did not take the share, since its words went only to the agent", () => {
  expect(
    newTaskShareWent({
      taskId: "task-new",
      agentStart: { failure: AGENT_CALL_FAILURE.UNANSWERED },
    }),
  ).toBe(false);
  expect(newTaskShareWent({ taskId: "task-new" })).toBe(true);
  expect(newTaskShareWent({ failure: TASK_CALL_FAILURE.NOT_FOUND })).toBe(false);
});
