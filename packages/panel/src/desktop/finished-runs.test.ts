import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@repo/features/agent-wire";
import type { TaskAgentsSummary, TaskSummary } from "@repo/features/task-wire";
import { describe, it } from "vitest";
import { type RunTasksHeld, withoutFinishedRunTasks } from "./finished-runs.js";

/**
 * finished-runs.test.ts -- a task a run made leaves the sidebar's Tasks once its run failed or was stopped and nothing holds it; any other task always stands.
 *
 * Synthetic tasks throughout.
 */

/** The agents of a run's task whose one agent failed. */
const FAILED_RUN_AGENTS: TaskAgentsSummary = {
  total: 1,
  working: 0,
  failed: 1,
  pullRequestTotal: 0,
};

/** A task a run made whose run failed, as the sidebar lists it. */
const RUN_TASK: TaskSummary = {
  id: "9c8b7a6f-5e4d-4c3b-8a29-1f0e9d8c7b6a",
  workspaceId: "workspace-1",
  name: "Copy sweep · Nov 4, 9:00",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
  madeByRun: true,
  agents: FAILED_RUN_AGENTS,
};

/** The same task made by a member, which names no run. */
const { madeByRun: _madeByRun, ...BY_MEMBER } = RUN_TASK;

/** Nothing holding any task. */
const NO_TASK_HELD: RunTasksHeld = {
  unread: () => false,
  inbox: [],
  shown: () => false,
  pullRequests: [],
};

/** The run's task's one pull request, in the state given, as the list followed live holds it. */
function heldPullRequest(state: PullRequestState): RunTasksHeld {
  const pullRequest = {
    number: 42,
    title: "Remove the stale copy",
    state,
    checks: CHECK_SUMMARY.PASSING,
    additions: 3,
    deletions: 1,
  };

  return { ...NO_TASK_HELD, pullRequests: [{ taskId: RUN_TASK.id, pullRequests: [pullRequest] }] };
}

/** The task ids that stand. */
function tasksStanding(task: TaskSummary, held: RunTasksHeld): readonly string[] {
  return withoutFinishedRunTasks([task], held).map((each) => each.id);
}

describe("the tasks an automation's runs made under Tasks", () => {
  it("leaves a run's task once its run failed and nothing holds it", () => {
    assert.deepEqual(tasksStanding(RUN_TASK, NO_TASK_HELD), []);
  });

  it.each<[string, TaskSummary, RunTasksHeld]>([
    ["no run made", BY_MEMBER, NO_TASK_HELD],
    [
      "whose run still works",
      { ...RUN_TASK, agents: { ...FAILED_RUN_AGENTS, working: 1 } },
      NO_TASK_HELD,
    ],
    ["unread", RUN_TASK, { ...NO_TASK_HELD, unread: (task) => task.id === RUN_TASK.id }],
    [
      "waiting on the reader in the Inbox",
      RUN_TASK,
      { ...NO_TASK_HELD, inbox: [{ taskId: RUN_TASK.id }] },
    ],
    ["with a pull request open", RUN_TASK, heldPullRequest(PULL_REQUEST_STATE.OPEN)],
    ["shown", RUN_TASK, { ...NO_TASK_HELD, shown: (taskId) => taskId === RUN_TASK.id }],
  ])("keeps a task %s", (_, task, held) => {
    assert.deepEqual(tasksStanding(task, held), [RUN_TASK.id]);
  });
});
