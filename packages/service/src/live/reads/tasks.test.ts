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
  TASK_LIST_READ,
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
import { eq } from "drizzle-orm";
import { Clock, Duration, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { agentSandboxName } from "../../agents/agent-sandbox-open.js";
import { agentSummary, summaryAccounts, summaryDevices } from "../../agents/coder-host/status.js";
import { continuedByOf, standingsOf } from "../../agents/coder-host/stop.js";
import { withTaskAgents } from "../../agents/task-agents.js";
import { TURN_FAILURE } from "../../core.js";
import { tasksRead } from "./tasks.js";

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

const heldList = (userId: string) =>
  Effect.gen(function* () {
    const tasks = yield* listTasks(userId);

    return { plans: (yield* withTaskAgents(userId, tasks)).map(countedOf) };
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
    "a plan waiting on an open task is marked blocked until every blocker is done or canceled, live as the held read reads it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const shipped = yield* startTask(owner, { name: "Invitation emails" });
        const cut = yield* startTask(owner, { name: "Invitation links" });
        const waiting = yield* startTask(owner, { name: "Teammate invitations" });

        for (const blocker of [shipped, cut]) {
          yield* addTaskBlock(owner, { blockerTaskId: blocker.id, blockedTaskId: waiting.id });
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
});
