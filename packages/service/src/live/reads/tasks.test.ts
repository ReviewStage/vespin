import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@repo/database/core/live-statement";
import { Database } from "@repo/database/core/query";
import { expireTurnApprovals, recordApprovalAsked } from "@repo/database/models/agent-approvals";
import {
  recordAgentSandboxBooted,
  recordAgentSandboxBooting,
} from "@repo/database/models/agent-sandboxes";
import {
  archiveAgent,
  createAgent,
  listAgents,
  type NewAgent,
  pinAgent,
  pinAgentCommitted,
  renameAgentCommitted,
  updateAgentPermissionModeCommitted,
} from "@repo/database/models/agent-store";
import { devicesNamed, registerDevice } from "@repo/database/models/device-store";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import { addTaskBlock } from "@repo/database/models/task-block-store";
import { listTasksFollowersNamed } from "@repo/database/models/task-follower-store";
import {
  assignUnassignedTaskCommitted,
  beginTaskWorkCommitted,
  deleteTaskCommitted,
  listTasks,
  updateTask,
  updateTaskCommitted,
} from "@repo/database/models/task-store";
import { readAccountNames } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { messages, turns } from "@repo/database/schemas/storage";
import { task } from "@repo/database/schemas/task";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { TOPIC } from "@repo/database/sync/notification";
import { taskSync } from "@repo/database/sync/tables";
import {
  DEVICE_LAYOUT,
  getTestDB,
  joinWorkspace,
  mutableFunctionsOf,
  openedPullRequest,
  openWorkspace,
  startTask,
} from "@repo/database/testing";
import { AGENT_PERMISSION_MODE } from "@repo/features/agent-approval-wire";
import { SANDBOX_STATE } from "@repo/features/agent-sandbox-wire";
import { STARTING_GRACE_MILLIS } from "@repo/features/agent-status";
import {
  AGENT_FAILURE,
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentSummary,
  CHECK_SUMMARY,
  type ListedAgent,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { agentsOfTask, pullRequestsOfTask } from "@repo/features/task-agents-model";
import {
  agentPullRequestsOfLiveRows,
  SETTLED_PAGE_SIZE,
  type SettledPageCursor,
  settledPageCursorOf,
  TASK_LIST_READ,
  TASK_PAGE_READ,
  TASK_ROWS_READ,
  TASK_SEARCH_READ,
  TASK_SUB_TASKS_READ,
  taskAgentPinsOfLiveRows,
  taskAgentsOfLiveRows,
  taskListOfLiveRows,
  taskPullRequestsOfLiveRows,
} from "@repo/features/task-list-live";
import {
  DESCRIPTION_ACTOR,
  type HeldTaskSummary,
  TASK_STATUS,
  type TaskSummary,
} from "@repo/features/task-wire";
import { SANDBOX_IDLE } from "@repo/sandbox";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnStatus,
} from "@repo/wire";
import { eq, inArray } from "drizzle-orm";
import { Clock, Duration, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { agentSandboxName } from "../../agents/agent-sandbox-open.js";
import { agentSummary, summaryAccounts, summaryDevices } from "../../agents/coder-host/status.js";
import { continuedByOf, standingsOf } from "../../agents/coder-host/stop.js";
import { withTaskAgents } from "../../agents/task-agents.js";
import { TURN_FAILURE } from "../../core.js";
import type { SyncMoved } from "../../sync/live-query.js";
import {
  taskPageRead,
  taskRowsRead,
  taskSearchRead,
  taskSubTasksRead,
  tasksRead,
} from "./tasks.js";

/**
 * The plan list's live statements against the held read it stands in for:
 * run as raw SQL as Realtime runs them, decoded as the desktop decodes the
 * rows, and built into the list at the instant the held read was read, they
 * answer what the held read answers, for every member and for no one else.
 *
 * Synthetic accounts, plans, and words throughout.
 */

/** The instant the list is read at. */
const NOW = Date.parse("2026-10-15T09:00:00Z");

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

  return userId;
});

/** An agent the account starts on the plan, started `ago` before the list is read. */
const openAgent = (
  userId: string,
  place: { readonly taskId: string; readonly blank?: boolean },
  ago: number,
  started: Partial<
    Pick<
      NewAgent,
      "runtime" | "machine" | "deviceId" | "startedFrom" | "automationRunId" | "startedByAgentId"
    >
  > = {},
) =>
  Effect.gen(function* () {
    const made = yield* createAgent(userId, {
      ...(place.blank === true
        ? { taskId: place.taskId, descriptionSnapshot: null, prompt: null }
        : { taskId: place.taskId, descriptionSnapshot: "# Invitations\n", prompt: null }),
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
      ...started,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });

    const { agent } = Option.getOrThrow(made);
    const db = yield* Database;
    yield* db
      .update(agentTable)
      .set({ createdAt: new Date(NOW - ago) })
      .where(eq(agentTable.id, agent.id));

    return agent;
  });

/** A turn of the agent's conversation, queued `ago` before the list is read. */
const turnOf = (
  agent: { readonly userId: string; readonly conversationId: string },
  status: TurnStatus,
  ago: number,
  options: {
    readonly canceled?: boolean;
    readonly settled?: boolean;
    readonly failure?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const [row] = yield* db
      .insert(turns)
      .values({
        userId: agent.userId,
        conversationId: agent.conversationId,
        origin: TURN_ORIGIN.TYPED,
        status,
        queuedAt: new Date(NOW - ago),
        startedAt: new Date(NOW - ago + 1000),
        settledAt: options.settled === true ? new Date(NOW - ago + 60_000) : null,
        cancelRequestedAt: options.canceled === true ? new Date(NOW - ago + 2000) : null,
        ...(options.failure === undefined ? undefined : { failure: options.failure }),
      })
      .returning({ id: turns.id });

    return row?.id ?? "";
  });

/** A line of the developer's to the agent, taken into the turn named or awaiting one, written `ago` before the list is read. */
const lineOf = (
  agent: { readonly userId: string; readonly conversationId: string },
  seq: number,
  text: string,
  turnId: string | null,
  ago = 1000,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(messages).values({
      userId: agent.userId,
      conversationId: agent.conversationId,
      seq,
      clientId: randomUUID(),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text }],
      placedAt: new Date(NOW - ago),
      createdAt: new Date(NOW - ago),
      turnId,
    });
  });

const runLive = (statement: LiveStatement) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement.sql, [...statement.params]));

/** The rows the live statements deliver to the account, decoded as the desktop decodes them. */
const liveRowsOf = (userId: string) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(tasksRead.statements({ userId }));

    return yield* Schema.decodeUnknownEffect(TASK_LIST_READ.rows)({
      plans: yield* runLive(statements.plans),
      agents: yield* runLive(statements.agents),
    });
  });

/** The rows one task's read delivers to the account, by the task or the agent `id` names, decoded as the desktop decodes them. */
const taskRowsOf = (userId: string, id: string) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(taskRowsRead.statements({ userId, id }));

    const rows = yield* Schema.decodeUnknownEffect(TASK_ROWS_READ.rows)({
      plans: yield* runLive(statements.plans),
      agents: yield* runLive(statements.agents),
    });

    return {
      plans: rows.plans.map((plan) => plan.id),
      agents: rows.agents.map((agent) => agent.id).toSorted(),
    };
  });

/** The tasks and agents a search delivers to the account, decoded as the desktop decodes them. */
const searchedOf = (userId: string, query: string) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(taskSearchRead.statements({ userId, query }));

    const rows = yield* Schema.decodeUnknownEffect(TASK_SEARCH_READ.rows)({
      plans: yield* runLive(statements.plans),
      agents: yield* runLive(statements.agents),
    });

    return {
      plans: rows.plans.map((plan) => plan.id).toSorted(),
      agents: rows.agents.map((agent) => agent.id).toSorted(),
    };
  });

/** One page of the workspace's settled tasks the account reads past `before`, decoded as the desktop decodes them: its tasks in the order a reader lists them, newest finished first, their names, its agents, and the cursor the next page reads past. */
const settledPageOf = (userId: string, workspaceId: string, before?: SettledPageCursor) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(
      taskPageRead.statements({
        userId,
        workspaceId,
        beforeAt: before === undefined ? "" : String(before.finishedAt),
        beforeId: before?.taskId ?? "",
      }),
    );

    const rows = yield* Schema.decodeUnknownEffect(TASK_PAGE_READ.rows)({
      plans: yield* runLive(statements.plans),
      agents: yield* runLive(statements.agents),
    });

    const plans = rows.plans.toSorted(
      (a, b) =>
        (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt) || (a.id < b.id ? 1 : -1),
    );

    return {
      plans: plans.map((plan) => plan.id),
      names: plans.map((plan) => plan.name),
      agents: rows.agents.map((agent) => agent.id).toSorted(),
      next: settledPageCursorOf(rows.plans),
    };
  });

/** The tasks and agents a parent's sub-task read delivers to the account, decoded as the desktop decodes them. */
const subTasksOf = (userId: string, id: string) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(taskSubTasksRead.statements({ userId, id }));

    const rows = yield* Schema.decodeUnknownEffect(TASK_SUB_TASKS_READ.rows)({
      plans: yield* runLive(statements.plans),
      agents: yield* runLive(statements.agents),
    });

    return {
      plans: rows.plans.map((plan) => plan.id).toSorted(),
      agents: rows.agents.map((agent) => agent.id).toSorted(),
    };
  });

/** An agent on a plan as the plan's own list names it, the workspace and repository the live list keeps beside it left out. */
const summaryOf = ({
  workspaceId: _workspaceId,
  repository: _repository,
  settledAt: _settledAt,
  ...agent
}: ListedAgent) => agent;

/** The statuses of a plan's agents as the desktop reads them from the live rows at `now`, the archived left out, those at work first. */
const liveStatusesOf = (userId: string, taskId: string, now: number) =>
  Effect.map(liveRowsOf(userId), (rows) =>
    agentsOfTask(taskAgentsOfLiveRows(rows, now), taskId).map((agent) => agent.status),
  );

/** The list as the desktop builds it from the live rows, at `now`. */
const liveListOf = (userId: string, now: number) =>
  Effect.map(liveRowsOf(userId), (rows) => taskListOfLiveRows(rows, now));

/** A plan's agents as its own list answers them at `now`, archived ones among them, as the service's endpoint builds them. */
const heldTaskAgentsOf = (userId: string, taskId: string, now: number) =>
  Effect.gen(function* () {
    const agents = yield* listAgents(userId, taskId, { includeArchived: true });
    const standing = yield* standingsOf(agents.map((agent) => agent.conversationId));
    const names = yield* readAccountNames(agents.flatMap(summaryAccounts));

    const continuedBy = yield* continuedByOf(
      userId,
      agents.map((agent) => agent.id),
    );

    const macs = yield* devicesNamed(summaryDevices(agents));

    return agents.map((agent) =>
      agentSummary(agent, standing(agent.conversationId), now, names, continuedBy(agent.id), macs),
    );
  });

/**
 * A clock reading `now` for the held read alone, sleeping as the test's own
 * does. Note that the test's clock is not moved there, because a store test
 * on Postgres shares its connection pool with that clock.
 */
const clockAt = (now: number) =>
  Effect.map(
    Clock.Clock,
    (running): Clock.Clock => ({
      currentTimeMillisUnsafe: () => now,
      currentTimeMillis: Effect.succeed(now),
      currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
      currentTimeNanos: Effect.succeed(BigInt(now) * 1_000_000n),
      monotonicTimeNanosUnsafe: () => running.monotonicTimeNanosUnsafe(),
      monotonicTimeNanos: running.monotonicTimeNanos,
      sleep: (duration) => running.sleep(duration),
    }),
  );

/** The list as the service's collection answers it to the desktop at `now`, archived agents among them. */
const heldListOf = (userId: string, now: number) =>
  Effect.gen(function* () {
    const clock = yield* clockAt(now);

    return yield* Effect.provideService(heldList(userId), Clock.Clock, clock);
  });

/** A plan as the held read answers it, counted as the live list counts it: the lines it keeps for released clients left out. */
function countedOf(plan: HeldTaskSummary): TaskSummary {
  const { agents, ...rest } = plan;

  if (agents === undefined) return rest;
  const { agents: _agents, pullRequests: _pullRequests, ...counts } = agents;

  return { ...rest, agents: counts };
}

/** Each listed task's direct children among `tasks`, the finished ones apart, by the parent's id, as the live row counts them over the tasks its reader reaches. */
function subTasksAmong(
  tasks: readonly { readonly parentTaskId?: string; readonly status?: string }[],
): ReadonlyMap<string, { readonly finished: number; readonly total: number }> {
  const counts = new Map<string, { finished: number; total: number }>();

  for (const { parentTaskId, status } of tasks) {
    if (parentTaskId === undefined) continue;
    const count = counts.get(parentTaskId) ?? { finished: 0, total: 0 };
    count.total += 1;
    count.finished += status === TASK_STATUS.DONE || status === TASK_STATUS.CANCELED ? 1 : 0;
    counts.set(parentTaskId, count);
  }

  return counts;
}

/** The held list with each plan's followers as the store reads them, which the held read leaves to the live one, and its sub-tasks counted over the held list itself, which the held read carries no count of. */
const heldList = (userId: string) =>
  Effect.gen(function* () {
    const tasks = yield* listTasks(userId);
    const ids = tasks.map((each) => each.id);
    const followers = yield* listTasksFollowersNamed(userId, ids);
    const subTasks = subTasksAmong(tasks);

    return {
      plans: (yield* withTaskAgents(userId, tasks)).map((plan) => ({
        ...countedOf(plan),
        ...(subTasks.has(plan.id) ? { subTasks: subTasks.get(plan.id) } : undefined),
        followers: (followers.get(plan.id) ?? []).map(({ userId, assignee, machines }) => ({
          userId,
          assignee,
          machines,
        })),
      })),
    };
  });

const PUBLISHED = {
  number: 42,
  title: "Fix the refresh",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  queued: true,
  author: "octo-dev",
} as const;

it.layer(getTestDB())("the plan list's live statements", (it) => {
  it.effect(
    "a write that changes the task answers the transaction it committed in, and one that changes nothing answers none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });

        const renamed = Option.getOrThrow(
          yield* updateTaskCommitted(owner, plan.id, { name: "Invitations" }),
        );

        const pinned = Option.getOrThrow(
          yield* updateTaskCommitted(owner, plan.id, { pinned: true }),
        );

        const again = Option.getOrThrow(
          yield* updateTaskCommitted(owner, plan.id, { pinned: true }),
        );

        assert.match(renamed.txid ?? "", /^[0-9]+$/u);
        assert.match(pinned.txid ?? "", /^[0-9]+$/u);
        assert.notEqual(renamed.txid, pinned.txid, "each write is its own transaction");
        assert.equal(again.txid, undefined, "a pin asked again writes nothing to wait for");
        assert.equal(renamed.task.name, "Invitations");
      }),
  );

  it.effect(
    "an agent's rename and pin answer the transaction they committed in, a pin asked again none, and a delete its own",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const loose = yield* openAgent(owner, { taskId: plan.id }, 60_000);

        const renamed = Option.getOrThrow(yield* renameAgentCommitted(owner, loose.id, "Sweep"));
        const pinned = Option.getOrThrow(yield* pinAgentCommitted(owner, loose.id, true));
        const again = Option.getOrThrow(yield* pinAgentCommitted(owner, loose.id, true));
        const deleted = Option.getOrThrow(yield* deleteTaskCommitted(owner, plan.id));
        const missing = yield* deleteTaskCommitted(owner, plan.id);

        assert.match(renamed.txid ?? "", /^[0-9]+$/u);
        assert.equal(renamed.agent.title, "Sweep");
        assert.match(pinned.txid ?? "", /^[0-9]+$/u);
        assert.equal(again.txid, undefined, "a pin asked again writes nothing to wait for");
        assert.match(deleted.txid, /^[0-9]+$/u);
        assert.ok(Option.isNone(missing), "a task already gone is deleted by nothing");
      }),
  );

  it.effect(
    "a Start's move into progress and its assignment answer their own later transactions, and none asked again",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });

        const begun = Option.getOrThrow(yield* beginTaskWorkCommitted(owner, plan.id));
        const assigned = Option.getOrThrow(yield* assignUnassignedTaskCommitted(owner, plan.id));

        assert.match(begun.txid, /^[0-9]+$/u);
        assert.ok(BigInt(assigned.txid) > BigInt(begun.txid), "the later write's transaction");
        assert.ok(Option.isNone(yield* beginTaskWorkCommitted(owner, plan.id)));
        assert.ok(Option.isNone(yield* assignUnassignedTaskCommitted(owner, plan.id)));
      }),
  );

  it.effect(
    "deliver a pin of an agent on a plan to the member who pinned it and to no one else",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        yield* joinWorkspace(plan.workspaceId, teammate);
        const agent = yield* openAgent(owner, { taskId: plan.id }, 60_000);

        yield* pinAgent(teammate, agent.id, true, "a1");

        const pinsOf = (reader: string) =>
          Effect.map(liveRowsOf(reader), (rows) =>
            taskAgentPinsOfLiveRows(rows).map(({ agentId, taskId, pinPosition }) => ({
              agentId,
              taskId,
              pinPosition,
            })),
          );

        assert.deepEqual(yield* pinsOf(teammate), [
          { agentId: agent.id, taskId: plan.id, pinPosition: "a1" },
        ]);
        assert.deepEqual(yield* pinsOf(owner), []);
        assert.deepEqual(yield* pinsOf(outsider), []);
      }),
  );

  it.effect(
    "follow a task the reader pinned, and the task of an agent it pinned, however long ago it was done",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const pinned = yield* startTask(owner, { name: "Teammate invitations" });
        const ofAgent = yield* startTask(owner, { name: "Billing export" });
        const agent = yield* openAgent(owner, { taskId: ofAgent.id }, 60_000);
        yield* updateTask(owner, pinned.id, { pinned: true });
        yield* pinAgent(owner, agent.id, true);
        // Both were finished a year before the list is read, well past any recent window.
        const db = yield* Database;
        const yearAgo = new Date(NOW - Duration.toMillis(Duration.days(365)));
        yield* db
          .update(task)
          .set({ status: TASK_STATUS.DONE, completedAt: yearAgo, updatedAt: yearAgo })
          .where(inArray(task.id, [pinned.id, ofAgent.id]));

        const followedBy = (reader: string) =>
          Effect.map(liveRowsOf(reader), (rows) => rows.plans.map((plan) => plan.id).toSorted());

        assert.deepEqual(yield* followedBy(owner), [pinned.id, ofAgent.id].toSorted());
        assert.deepEqual(yield* followedBy(outsider), [], "no other account's list holds them");
      }),
  );

  it.effect("call only functions Postgres marks immutable, as Realtime requires", () =>
    Effect.gen(function* () {
      const { plans, agents, issues } = Option.getOrThrow(
        tasksRead.statements({ userId: "user-immutable" }),
      );

      assert.deepEqual(yield* mutableFunctionsOf(plans), []);
      assert.deepEqual(yield* mutableFunctionsOf(agents), []);
      assert.deepEqual(yield* mutableFunctionsOf(issues), []);
    }),
  );

  it.effect(
    "deliver the rows the held list is built from, every status, pin, archive, parent, and pull request alike, to every member and to no one else",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const shelved = yield* startTask(owner, { name: "Billing export" });
        yield* joinWorkspace(plan.workspaceId, teammate);

        // A plan's agents in every standing the list says.
        const done = yield* openAgent(owner, { taskId: plan.id }, 60 * 60_000);
        yield* turnOf(done, TURN_STATUS.SETTLED, 50 * 60_000, { settled: true });
        yield* openedPullRequest(owner, done.id, PUBLISHED);
        const stopping = yield* openAgent(teammate, { taskId: plan.id }, 30 * 60_000);

        const stoppingTurn = yield* turnOf(stopping, TURN_STATUS.RUNNING, 20 * 60_000, {
          canceled: true,
        });

        yield* openAgent(owner, { taskId: plan.id }, 60_000);
        yield* openAgent(owner, { taskId: plan.id }, STARTING_GRACE_MILLIS + 60_000);
        const messaged = yield* openAgent(owner, { taskId: plan.id }, 40 * 60_000);
        const ended = yield* turnOf(messaged, TURN_STATUS.SETTLED, 35 * 60_000, { settled: true });
        yield* lineOf(messaged, 1, "Fix the flaky test.", ended);
        // Its second line queued the next turn, which no runner has taken yet.
        yield* turnOf(messaged, TURN_STATUS.QUEUED, 1000);
        yield* lineOf(messaged, 2, "And the other one.", null);
        const archived = yield* openAgent(owner, { taskId: plan.id }, 90 * 60_000);
        yield* turnOf(archived, TURN_STATUS.FAILED, 80 * 60_000, { settled: true });
        yield* archiveAgent(owner, archived.id, true);
        // A line no turn took long ago, and a line after a turn whose session ended for good: the turn alone says each status.
        const unanswered = yield* openAgent(owner, { taskId: plan.id }, 45 * 60_000);

        const answered = yield* turnOf(unanswered, TURN_STATUS.SETTLED, 44 * 60_000, {
          settled: true,
        });

        yield* lineOf(unanswered, 1, "Start the export.", answered);
        yield* lineOf(unanswered, 2, "Are you there?", null, 6 * 60_000);
        const orphaned = yield* openAgent(owner, { taskId: plan.id }, 25 * 60_000);

        const orphanedTurn = yield* turnOf(orphaned, TURN_STATUS.FAILED, 24 * 60_000, {
          settled: true,
          failure: TURN_FAILURE.SESSION_ENDED,
        });

        yield* lineOf(orphaned, 1, "Try again.", null, 60_000);
        // The newest agent's failure, which alone the row counts, since every other failed before an agent was started after it.
        const latest = yield* openAgent(owner, { taskId: plan.id }, 30_000);
        yield* turnOf(latest, TURN_STATUS.FAILED, 20_000, { settled: true });

        // A settled plan the owner pinned.
        // An agent started blank, long past the starting grace: it reads completed, not failed.
        yield* openAgent(owner, { taskId: shelved.id, blank: true }, STARTING_GRACE_MILLIS * 3);
        // A failure a later agent took over from, which stays taken over once that agent is archived.
        const retried = yield* openAgent(owner, { taskId: shelved.id }, 20 * 60_000);
        yield* turnOf(retried, TURN_STATUS.FAILED, 15 * 60_000, { settled: true });
        const retry = yield* openAgent(owner, { taskId: shelved.id }, 10 * 60_000);
        yield* archiveAgent(owner, retry.id, true);
        // An agent its plan's usage limit stopped since, which is no failure to count.
        const limited = yield* openAgent(owner, { taskId: shelved.id }, 5 * 60_000);
        yield* turnOf(limited, TURN_STATUS.FAILED, 4 * 60_000, {
          settled: true,
          failure: TURN_FAILURE.PLAN_LIMIT,
        });
        yield* updateTask(owner, plan.id, { assigneeId: teammate });
        yield* updateTask(owner, shelved.id, { pinned: true });
        yield* updateTask(owner, shelved.id, { status: TASK_STATUS.DONE });
        // A local agent on the owner's Mac running Claude Code, continued and forked on a plan of its own.
        const runs = yield* startTask(owner, { name: "Local runs" });
        const deviceId = randomUUID();
        yield* registerDevice(owner, { id: deviceId, name: "Studio", ...DEVICE_LAYOUT });

        const local = yield* openAgent(owner, { taskId: runs.id }, 20 * 60_000, {
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          machine: AGENT_MACHINE.DEVICE,
          deviceId,
        });

        yield* openAgent(owner, { taskId: runs.id }, 15 * 60_000, {
          startedFrom: { agentId: local.id, steps: 2, totalSteps: 2 },
        });
        yield* openAgent(owner, { taskId: runs.id }, 10 * 60_000, {
          startedFrom: { agentId: local.id, messageId: randomUUID(), steps: 1, totalSteps: 2 },
        });

        // One the local agent started with its own start_agent, which names that agent as its starter.
        const helper = yield* openAgent(owner, { taskId: runs.id }, 5 * 60_000, {
          startedByAgentId: local.id,
        });

        // Tasks made for the owner by a coding agent, and by the notetaker on their call.
        const followUp = yield* startTask(owner, {
          name: "Invite emails",
          origin: { actor: DESCRIPTION_ACTOR.AGENT, agentId: done.id },
        });

        const fromCall = yield* startTask(owner, {
          name: "Audit log export",
          origin: { actor: DESCRIPTION_ACTOR.NOTETAKER },
        });

        // The follow-up made a child of the first plan.
        const db = yield* Database;
        yield* db.update(task).set({ parentTaskId: plan.id }).where(eq(task.id, followUp.id));

        for (const reader of [owner, teammate, outsider]) {
          assert.deepEqual(yield* liveListOf(reader, NOW), yield* heldListOf(reader, NOW));
        }

        // Every plan's agents, the archived among them, as each plan's own list names them, for its
        // tabs, their harness, Mac, and continues among it; the live rows come in the order they
        // were started across the plans.
        const byId = (agents: readonly { readonly id: string }[]) =>
          agents.toSorted((a, b) => a.id.localeCompare(b.id));

        // The live row names a Mac and not its last beat, which wakes nothing.
        const withoutBeat = (agent: AgentSummary): AgentSummary => {
          if (agent.mac === undefined) return agent;
          const { seenAt: _seenAt, ...mac } = agent.mac;

          return { ...agent, mac };
        };

        for (const reader of [owner, teammate]) {
          const taskAgents = taskAgentsOfLiveRows(yield* liveRowsOf(reader), NOW).map(summaryOf);
          assert.deepEqual(
            byId(taskAgents),
            byId(
              [
                ...(yield* heldTaskAgentsOf(reader, plan.id, NOW)),
                ...(yield* heldTaskAgentsOf(reader, shelved.id, NOW)),
                ...(yield* heldTaskAgentsOf(reader, runs.id, NOW)),
              ].map(withoutBeat),
            ),
          );
        }

        const helperRow = taskAgentsOfLiveRows(yield* liveRowsOf(owner), NOW).find(
          (agent) => agent.id === helper.id,
        );

        assert.equal(helperRow?.startedByAgentId, local.id);
        const read = yield* liveListOf(owner, NOW);
        const originOf = (taskId: string) => read.plans.find((each) => each.id === taskId)?.origin;
        assert.deepEqual(
          [originOf(plan.id), originOf(followUp.id), originOf(fromCall.id)],
          [
            undefined,
            { actor: DESCRIPTION_ACTOR.AGENT, agentId: done.id },
            { actor: DESCRIPTION_ACTOR.NOTETAKER },
          ],
        );

        const parentOf = (taskId: string) =>
          read.plans.find((each) => each.id === taskId)?.parentTaskId;

        assert.deepEqual([parentOf(plan.id), parentOf(followUp.id)], [undefined, plan.id]);
        const agents = read.plans.find((each) => each.id === plan.id)?.agents;
        assert.deepEqual(
          [agents?.total, agents?.working, agents?.failed, agents?.pullRequestTotal],
          [8, 2, 1, 1],
        );
        assert.equal(read.plans.find((each) => each.id === shelved.id)?.agents?.failed, 0);
        const rows = yield* liveRowsOf(owner);
        const pullRequests = pullRequestsOfTask(taskPullRequestsOfLiveRows(rows), plan.id);
        assert.equal(pullRequests[0]?.queued, true, "a queued pull request says so");
        assert.equal(pullRequests[0]?.author, "octo-dev", "it names who opened it");
        const liveAgents = agentsOfTask(taskAgentsOfLiveRows(rows, NOW), plan.id);
        assert.deepEqual(
          [unanswered.id, orphaned.id].map(
            (id) => liveAgents.find((line) => line.id === id)?.status,
          ),
          [AGENT_STATUS.COMPLETED, AGENT_STATUS.FAILED],
          "a line no turn took moves nothing: its settled turn reads completed, and its ended session failed",
        );
        assert.deepEqual(
          [stopping.id, orphaned.id].map((id) => liveAgents.find((line) => line.id === id)?.turn),
          [
            {
              id: stoppingTurn,
              queuedAt: NOW - 20 * 60_000,
              status: TURN_STATUS.RUNNING,
              stopAsked: true,
            },
            {
              id: orphanedTurn,
              queuedAt: NOW - 24 * 60_000,
              status: TURN_STATUS.FAILED,
              failure: AGENT_FAILURE.SESSION_ENDED,
            },
          ],
          "each summary carries its newest turn as the row records it, a Stop asked and why it failed among it",
        );
        assert.deepEqual((yield* liveListOf(outsider, NOW)).plans, []);
      }),
  );

  it.effect(
    "a plan waiting on an open task is marked blocked until every blocker is done or canceled, and each names what it waits on and blocks, live as the held read reads it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const shipped = yield* startTask(owner, { name: "Invitation emails" });
        const cut = yield* startTask(owner, { name: "Invitation links" });
        const waiting = yield* startTask(owner, { name: "Teammate invitations" });

        for (const blocker of [shipped, cut]) {
          yield* addTaskBlock(owner, { blockerTaskId: blocker.id, blockedTaskId: waiting.id });
          // Note that each block is added a second apart, so the earlier one reads first.
          yield* TestClock.adjust("1 second");
        }

        const blocked = Effect.gen(function* () {
          const live = yield* liveListOf(owner, NOW);
          const held = yield* heldListOf(owner, NOW);

          const marked = (plans: readonly { id: string; blocked?: true }[]) =>
            plans.flatMap((plan) => (plan.blocked === true ? [plan.id] : []));

          assert.deepEqual(marked(live.plans), marked(held.plans), "live as held");

          return marked(live.plans);
        });

        assert.deepEqual(yield* blocked, [waiting.id], "both blockers open");

        const live = yield* liveListOf(owner, NOW);
        const held = yield* heldListOf(owner, NOW);

        const blocksOf = (
          plans: readonly {
            id: string;
            blockedBy?: readonly string[];
            blocks?: readonly string[];
          }[],
        ) =>
          [waiting, shipped, cut].map(({ id }) => {
            const plan = plans.find((each) => each.id === id);

            return { blockedBy: plan?.blockedBy, blocks: plan?.blocks };
          });

        assert.deepEqual(
          blocksOf(live.plans),
          [
            { blockedBy: [shipped.id, cut.id], blocks: [] },
            { blockedBy: [], blocks: [waiting.id] },
            { blockedBy: [], blocks: [waiting.id] },
          ],
          "each row names its blockers, the earliest first, and what it blocks",
        );
        assert.deepEqual(blocksOf(held.plans), blocksOf(live.plans), "live as held");
        yield* updateTask(owner, shipped.id, { status: TASK_STATUS.DONE });
        assert.deepEqual(yield* blocked, [waiting.id], "one blocker still open");
        yield* updateTask(owner, cut.id, { status: TASK_STATUS.CANCELED });
        assert.deepEqual(yield* blocked, [], "every blocker done or canceled");
      }),
  );

  it.effect(
    "a plan's row counts its pull requests, every one stands beside the list in the order its readers name them, and each agent's own beside it, an archived agent's among them",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const { queued: _, ...published } = PUBLISHED;
        const numbers = [41, 42, 43, 44, 45];

        for (const [index, number] of numbers.entries()) {
          const agent = yield* openAgent(owner, { taskId: plan.id }, (index + 1) * 60_000);
          yield* openedPullRequest(owner, agent.id, {
            ...published,
            number,
            url: `https://github.com/acme/relay/pull/${number}`,
          });
        }

        const archived = yield* openAgent(owner, { taskId: plan.id }, 6 * 60_000);
        yield* openedPullRequest(owner, archived.id, {
          ...published,
          number: 40,
          url: "https://github.com/acme/relay/pull/40",
        });
        yield* archiveAgent(owner, archived.id, true);

        const rows = yield* liveRowsOf(owner);
        const row = taskListOfLiveRows(rows, NOW).plans.find((each) => each.id === plan.id);
        const every = taskPullRequestsOfLiveRows(rows).find((each) => each.taskId === plan.id);
        assert.equal(row?.agents?.pullRequestTotal, 5);
        assert.deepEqual(
          every?.pullRequests.map((each) => each.number),
          [41, 42, 43, 44, 45],
          "every pull request, the newest agent's first",
        );
        assert.deepEqual(
          agentPullRequestsOfLiveRows(rows)
            .filter((each) => each.taskId === plan.id)
            .map((each) => each.pullRequest.number)
            .toSorted(),
          [40, 41, 42, 43, 44, 45],
          "each agent's own, the archived agent's among them",
        );
      }),
  );

  it.effect(
    "an agent that opened a pull request before its newest names the older one while it stands open and its newest merged, as the plan's row does, live as held",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const { queued: _, ...published } = PUBLISHED;
        const agent = yield* openAgent(owner, { taskId: plan.id }, 60_000);
        yield* openedPullRequest(owner, agent.id, {
          ...published,
          number: 41,
          url: "https://github.com/acme/relay/pull/41",
        });
        yield* openedPullRequest(owner, agent.id, {
          ...published,
          number: 42,
          url: "https://github.com/acme/relay/pull/42",
          state: PULL_REQUEST_STATE.MERGED,
        });

        const rows = yield* liveRowsOf(owner);
        const every = taskPullRequestsOfLiveRows(rows).find((each) => each.taskId === plan.id);
        assert.deepEqual(
          every?.pullRequests.map((each) => [each.number, each.state]),
          [
            [41, PULL_REQUEST_STATE.OPEN],
            [42, PULL_REQUEST_STATE.MERGED],
          ],
        );
        assert.deepEqual(
          agentPullRequestsOfLiveRows(rows).map((each) => each.pullRequest.number),
          [41],
        );
        assert.deepEqual(yield* liveListOf(owner, NOW), yield* heldListOf(owner, NOW));
      }),
  );

  it.effect(
    "an agent's sandbox reads open once its conversation claims a session, as the held read reads it, and running once booted",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const agent = yield* openAgent(owner, { taskId: plan.id }, 60_000);

        const listed = Effect.map(liveRowsOf(owner), (rows) =>
          agentsOfTask(taskAgentsOfLiveRows(rows, NOW), plan.id).find(
            (each) => each.id === agent.id,
          ),
        );

        const sandboxOf = Effect.map(listed, (each) => each?.sandboxOpen);

        const starting = yield* liveListOf(owner, NOW);
        assert.deepEqual(starting, yield* heldListOf(owner, NOW));
        assert.equal(yield* sandboxOf, false);

        yield* claimRuntimeSession(
          { userId: owner, conversationId: agent.conversationId },
          "session-1",
          new Date(NOW),
        );

        const opened = yield* liveListOf(owner, NOW);
        assert.deepEqual(opened, yield* heldListOf(owner, NOW));
        assert.equal(yield* sandboxOf, true);
        assert.equal((yield* listed)?.sandbox, undefined);

        // Its sandbox, booted a minute on, runs SANDBOX_IDLE past that unless touched.
        const name = agentSandboxName("session-1");
        yield* recordAgentSandboxBooting(agent.id, name, new Date(NOW));
        yield* recordAgentSandboxBooted(name, new Date(NOW + 60_000));
        assert.deepEqual((yield* listed)?.sandbox, {
          state: SANDBOX_STATE.RUNNING,
          stateAt: NOW + 60_000,
          runsUntil: NOW + 60_000 + Duration.toMillis(SANDBOX_IDLE),
        });
      }),
  );

  it.effect(
    "an agent's permission mode reads as the held read reads it, and the asks its runner holds read live until settled",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const agent = yield* openAgent(owner, { taskId: plan.id }, 60_000);
        const turnId = yield* turnOf(agent, TURN_STATUS.RUNNING, 30_000);
        yield* updateAgentPermissionModeCommitted(owner, agent.id, AGENT_PERMISSION_MODE.ASK);
        yield* recordApprovalAsked({
          conversationId: agent.conversationId,
          turnId,
          requestId: "request-1",
          toolUseId: "toolu_1",
          subagentId: null,
          toolName: "Bash",
          title: "Run pnpm test?",
          description: "In the checkout",
          input: { command: "pnpm test" },
          commandPrefix: null,
          at: new Date(NOW - 10_000),
        });

        const liveOf = Effect.map(liveRowsOf(owner), (rows) =>
          agentsOfTask(taskAgentsOfLiveRows(rows, NOW), plan.id).find(
            (each) => each.id === agent.id,
          ),
        );

        const asking = yield* liveOf;

        const held = (yield* heldTaskAgentsOf(owner, plan.id, NOW)).find(
          (each) => each.id === agent.id,
        );

        yield* expireTurnApprovals(agent.conversationId, turnId, new Date(NOW));
        const settled = yield* liveOf;

        assert.equal(asking?.permissionMode, AGENT_PERMISSION_MODE.ASK);
        assert.equal(held?.permissionMode, AGENT_PERMISSION_MODE.ASK);
        assert.deepEqual(
          asking?.pendingApprovals?.map(({ id: _id, ...ask }) => ask),
          [
            {
              toolUseId: "toolu_1",
              toolName: "Bash",
              title: "Run pnpm test?",
              description: "In the checkout",
              input: { command: "pnpm test" },
              askedAt: NOW - 10_000,
            },
          ],
        );
        assert.equal(settled?.pendingApprovals, undefined);
      }),
  );

  it.effect(
    "an agent with no turn reads failed once its grace ends, as the held read reads it then",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        yield* openAgent(owner, { taskId: plan.id }, 0);
        const later = NOW + STARTING_GRACE_MILLIS + 1;

        const read = yield* liveListOf(owner, later);

        assert.deepEqual(read, yield* heldListOf(owner, later));
        assert.deepEqual(yield* liveStatusesOf(owner, plan.id, later), [AGENT_STATUS.FAILED]);
      }),
  );

  it.effect(
    "a line a call spoke or took typed, and an agent only its starter sees, read as the held read reads them",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        yield* joinWorkspace(plan.workspaceId, teammate);

        // A line a call spoke after the agent's turn settled, which opens no turn of its own.
        const spoken = yield* openAgent(owner, { taskId: plan.id }, 30 * 60_000);
        const settled = yield* turnOf(spoken, TURN_STATUS.SETTLED, 25 * 60_000, { settled: true });
        yield* lineOf(spoken, 1, "Fix the flaky test.", settled);
        yield* db.insert(messages).values({
          userId: owner,
          conversationId: spoken.conversationId,
          seq: 2,
          clientId: randomUUID(),
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "Thanks, that's all." }],
          metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE },
          placedAt: new Date(NOW - 1000),
          createdAt: new Date(NOW - 1000),
          turnId: null,
        });
        // And a line typed into the agent's call, which the call answers without a turn of the agent's.
        yield* db.insert(messages).values({
          userId: owner,
          conversationId: spoken.conversationId,
          seq: 3,
          clientId: randomUUID(),
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "One more thing." }],
          metadata: {
            channel: MESSAGE_CHANNEL.TYPED,
            voice_session_id: "voice-session-1",
          },
          placedAt: new Date(NOW - 500),
          createdAt: new Date(NOW - 500),
          turnId: null,
        });

        // An agent on the shared task working through its starter's own token, which the teammate does not see.
        const hidden = yield* openAgent(owner, { taskId: plan.id }, 5 * 60_000);
        yield* db
          .update(agentTable)
          .set({ githubAccess: GITHUB_ACCESS.TOKEN })
          .where(eq(agentTable.id, hidden.id));

        for (const reader of [owner, teammate]) {
          assert.deepEqual(yield* liveListOf(reader, NOW), yield* heldListOf(reader, NOW));
        }

        const lines = agentsOfTask(taskAgentsOfLiveRows(yield* liveRowsOf(owner), NOW), plan.id);
        assert.equal(
          lines.find((line) => line.id === spoken.id)?.status,
          AGENT_STATUS.COMPLETED,
          "a line a call spoke or took typed leaves a settled agent completed",
        );
        const seen = taskAgentsOfLiveRows(yield* liveRowsOf(teammate), NOW);
        assert.ok(
          !seen.some((line) => line.id === hidden.id),
          "the teammate's list leaves out the agent they do not see",
        );
      }),
  );

  it.effect(
    "deliver one task and its agents, by the task or one of its agents, to a member and to no one else",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const other = yield* startTask(owner, { name: "Billing export" });
        yield* joinWorkspace(plan.workspaceId, teammate);
        const first = yield* openAgent(owner, { taskId: plan.id }, 60_000);
        const second = yield* openAgent(owner, { taskId: plan.id }, 30_000);
        yield* openAgent(owner, { taskId: other.id }, 30_000);
        const whole = { plans: [plan.id], agents: [first.id, second.id].toSorted() };

        assert.deepEqual(yield* taskRowsOf(teammate, plan.id), whole);
        assert.deepEqual(yield* taskRowsOf(teammate, second.id), whole);
        assert.deepEqual(yield* taskRowsOf(outsider, plan.id), { plans: [], agents: [] });
        assert.deepEqual(yield* taskRowsOf(outsider, first.id), { plans: [], agents: [] });
      }),
  );

  it.effect(
    "find a task by every word of its name or by its key, with its agents, for a member and no one else",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const plan = yield* startTask(owner, { name: "Teammate invitations" });
        const other = yield* startTask(owner, { name: "Billing export" });
        yield* joinWorkspace(plan.workspaceId, teammate);
        const agent = yield* openAgent(owner, { taskId: plan.id }, 60_000);
        yield* openAgent(owner, { taskId: other.id }, 30_000);
        const found = { plans: [plan.id], agents: [agent.id] };
        const db = yield* Database;

        const [numbered] = yield* db
          .select({ number: task.number })
          .from(task)
          .where(eq(task.id, plan.id));

        assert.deepEqual(yield* searchedOf(teammate, "INVITATIONS team"), found);
        assert.deepEqual(yield* searchedOf(teammate, `ACME-${numbered?.number}`), found);
        assert.deepEqual(yield* searchedOf(teammate, "invitations billing"), {
          plans: [],
          agents: [],
        });
        assert.deepEqual(yield* searchedOf(outsider, "invitations"), { plans: [], agents: [] });
      }),
  );

  it.effect(
    "page a workspace's settled tasks, newest finished first, past the cursor, to a member and to no one else",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const open = yield* startTask(owner, { name: "Teammate invitations" });
        const elsewhere = yield* startTask(outsider, { name: "Billing export" });
        const { workspaceId } = open;
        yield* joinWorkspace(workspaceId, teammate);

        // Two more settled tasks than a page holds, a minute apart, the newest first; the last two finished in the same millisecond, and the one before kept no finish, so its last save stands for it.
        const finished = Array.from({ length: SETTLED_PAGE_SIZE + 2 }, (_, index) => ({
          id: randomUUID(),
          at: new Date(NOW - (Math.min(index, SETTLED_PAGE_SIZE) + 1) * 60_000),
          index,
        }));

        yield* db.insert(task).values(
          finished.map(({ id, at, index }) => ({
            id,
            organizationId: workspaceId,
            userId: owner,
            name: `Shipped ${index}`,
            number: 1000 + index,
            description: "",
            status: index % 2 === 0 ? TASK_STATUS.DONE : TASK_STATUS.CANCELED,
            completedAt: index === SETTLED_PAGE_SIZE - 1 ? null : at,
            updatedAt: at,
          })),
        );

        yield* db
          .update(task)
          .set({ status: TASK_STATUS.DONE, completedAt: new Date(NOW) })
          .where(eq(task.id, elsewhere.id));

        const first = finished[0]?.id ?? "";
        const agent = yield* openAgent(owner, { taskId: first }, 30_000);
        // Note that the two finished in one millisecond stand by id, the greater first.
        const tied = finished.slice(SETTLED_PAGE_SIZE).toSorted((a, b) => (a.id < b.id ? 1 : -1));
        const order = [...finished.slice(0, SETTLED_PAGE_SIZE), ...tied].map(({ id }) => id);

        const page = yield* settledPageOf(teammate, workspaceId);
        assert.deepEqual(page.plans, order.slice(0, SETTLED_PAGE_SIZE));
        assert.deepEqual(page.agents, [agent.id]);
        assert.notEqual(page.next, undefined);

        // A task of the first page reopened, and one of the next renamed, while the reader pages: the next page reads past where the first ended, the rename with it.
        yield* updateTask(owner, first, { status: TASK_STATUS.TODO });
        yield* updateTask(owner, order[SETTLED_PAGE_SIZE] ?? "", { name: "Shipped, renamed" });
        const next = yield* settledPageOf(teammate, workspaceId, page.next);
        assert.deepEqual(next.plans, order.slice(SETTLED_PAGE_SIZE));
        assert.deepEqual(next.names[0], "Shipped, renamed");
        assert.deepEqual(next.agents, []);
        assert.equal(next.next, undefined);

        const none = { plans: [], names: [], agents: [], next: undefined };
        assert.deepEqual(yield* settledPageOf(outsider, workspaceId), none);
        assert.deepEqual(yield* settledPageOf(outsider, workspaceId, page.next), none);
      }),
  );
  it.effect(
    "count a task's direct children the reader reaches, the finished apart, and send both parents of a child moved between them past a sync id, and read a parent's children, to a member and no one else",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const outsider = yield* openUser;
        yield* openWorkspace(outsider);
        const parent = yield* startTask(owner, { name: "Teammate invitations" });
        const other = yield* startTask(owner, { name: "Billing export" });
        yield* joinWorkspace(parent.workspaceId, teammate);
        const shipped = yield* startTask(owner, { name: "Invitation emails" });
        const working = yield* startTask(owner, { name: "Invitation links" });
        const hidden = yield* startTask(owner, { name: "Invitation audit" });
        const grandchild = yield* startTask(owner, { name: "Link expiry" });
        const db = yield* Database;

        for (const child of [shipped, working, hidden]) {
          yield* db.update(task).set({ parentTaskId: parent.id }).where(eq(task.id, child.id));
        }

        yield* db.update(task).set({ parentTaskId: working.id }).where(eq(task.id, grandchild.id));
        yield* updateTask(owner, shipped.id, { status: TASK_STATUS.DONE });
        // A child on its owner's own token, which the teammate does not reach, and so does not count.
        yield* db
          .update(task)
          .set({ githubAccess: GITHUB_ACCESS.TOKEN, repository: "acme/side" })
          .where(eq(task.id, hidden.id));

        const countsOf = (reader: string) =>
          Effect.map(liveListOf(reader, NOW), (list) =>
            [parent, working, other].map(
              ({ id }) => list.plans.find((plan) => plan.id === id)?.subTasks,
            ),
          );

        assert.deepEqual(yield* countsOf(owner), [
          { finished: 1, total: 3 },
          { finished: 0, total: 1 },
          undefined,
        ]);
        assert.deepEqual(yield* countsOf(teammate), [
          { finished: 1, total: 2 },
          { finished: 0, total: 1 },
          undefined,
        ]);
        assert.deepEqual(yield* countsOf(outsider), [undefined, undefined, undefined]);

        // The finished child moves to the other parent, which the log names as both of its parents (`TOPIC.TASK_PARENT`).
        yield* db.update(task).set({ parentTaskId: other.id }).where(eq(task.id, shipped.id));

        const moved: SyncMoved = {
          keys: (table) => (table === taskSync ? [shipped.id] : []),
          topics: (table, kind) =>
            table === taskSync && kind === TOPIC.TASK_PARENT ? [parent.id, other.id] : [],
        };

        const { delta } = tasksRead;
        assert.ok(delta !== undefined, "the list answers deltas");
        const statements = Option.getOrThrow(delta.statements({ userId: teammate }, moved));

        const rows = yield* Schema.decodeUnknownEffect(
          Schema.Array(TASK_LIST_READ.parts.plans.row),
        )(yield* runLive(statements.plans));

        assert.deepEqual(
          rows
            .map(({ id, subTaskCount, finishedSubTaskCount }) => ({
              id,
              subTaskCount,
              finishedSubTaskCount,
            }))
            .toSorted((a, b) => a.id.localeCompare(b.id)),
          [
            { id: parent.id, subTaskCount: 1, finishedSubTaskCount: 0 },
            { id: other.id, subTaskCount: 1, finishedSubTaskCount: 1 },
            { id: shipped.id, subTaskCount: 0, finishedSubTaskCount: 0 },
          ].toSorted((a, b) => a.id.localeCompare(b.id)),
          "the child and both its parents are sent, each counted anew",
        );

        // The other parent's children are read with their agents for a member, the one on a token they do not reach left out, and for no one else.
        yield* db.update(task).set({ parentTaskId: other.id }).where(eq(task.id, hidden.id));
        const agent = yield* openAgent(owner, { taskId: shipped.id }, 60_000);
        const read = { plans: [shipped.id], agents: [agent.id] };
        assert.deepEqual(yield* subTasksOf(teammate, other.id), read);
        assert.deepEqual(yield* subTasksOf(owner, other.id), {
          plans: [shipped.id, hidden.id].toSorted(),
          agents: [agent.id],
        });
        assert.deepEqual(yield* subTasksOf(outsider, other.id), { plans: [], agents: [] });
      }),
  );
});
