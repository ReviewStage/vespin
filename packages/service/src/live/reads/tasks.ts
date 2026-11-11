import { liveKeysIn } from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { sandboxNamedFor } from "@repo/database/models/agent-sandboxes";
import { PULL_REQUEST_OF_AGENT_BRANCH } from "@repo/database/models/agent-store";
import { taskMadeByRun } from "@repo/database/models/run-tasks";
import { taskBlockedFor } from "@repo/database/models/task-block-store";
import { agentVisibleTo, taskReachableBy } from "@repo/database/models/workspace-store";
import {
  agentPin,
  agentPullRequest,
  conversations,
  device,
  taskPin,
  taskRead,
} from "@repo/database/schemas";
import { agentTable } from "@repo/database/schemas/agent";
import { agentApproval } from "@repo/database/schemas/agent-approval";
import { agentBootTable } from "@repo/database/schemas/agent-boot";
import { AGENT_SANDBOX_STATE, agentSandboxTable } from "@repo/database/schemas/agent-sandbox";
import { user } from "@repo/database/schemas/auth";
import { automationRun } from "@repo/database/schemas/automation";
import { task } from "@repo/database/schemas/task";
import { taskBlock } from "@repo/database/schemas/task-block";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentApprovalSync,
  agentBootSync,
  agentPinSync,
  agentPullRequestSync,
  agentSandboxSync,
  agentSync,
  automationRunSync,
  automationSync,
  conversationsSync,
  deviceSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
  messagesSync,
  taskBlockSync,
  taskPinSync,
  taskReadSync,
  taskSync,
  turnsSync,
  userSync,
} from "@repo/database/sync/tables";
import type { BootPhase } from "@repo/features/agent-boot";
import { SANDBOX_STATE, type SandboxState } from "@repo/features/agent-sandbox-wire";
import { AGENT_BRIEF, type AgentFailure } from "@repo/features/agent-wire";
import { NO_TASK_OWNER, TASK_LIST_READ } from "@repo/features/task-list-live";
import { SANDBOX_IDLE } from "@repo/sandbox";
import { and, eq, isNotNull, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Duration } from "effect";
import type { SyncMoved } from "../../sync/live-query.js";
import { readerAndWorkspaceTopics } from "../../sync/reader-topics.js";
import { failureWordOf, lastSettledAtIn, latestTurnOf, sessionEndedOf } from "../agent-standing.js";
import { bindLiveRead, liveRowsStatement, outerJoined } from "../live-read-binding.js";

/**
 * tasks.ts -- the plan list bound (`TASK_LIST_READ`): the plans the account reaches, and every agent of them, with what the list reads each agent's status from, the tables they read, the topics that wake them, and what a reader past a sync id is answered.
 *
 * Two statements, each the same rows and rule of who may read them as the
 * held read (`tasks-app.ts`'s collection, through `listTasks` and
 * `withTaskAgents`), with every archived agent among them, as the desktop asks for them: the plans with the
 * reader's own pin and read mark and the owner's name, and the agents with their newest
 * turn, when the newest line
 * of the developer's awaiting its turn was written and whether that turn's session ended, when the newest turn to end
 * ended, what each last published and every pull request it opened, the harness its conversation runs on, the
 * Mac a local one runs on, and the names of the members each names. A third, the issues
 * the plans linked, answers no rows now that a plan links none, and stands
 * because a released desktop follows it. Every column stands
 * under the key `@repo/features/task-list-live` reads it by and every
 * instant as epoch milliseconds. Nothing here reads the clock: an agent's
 * status, which turns on it, is the reader's to read, and so is the order,
 * since Realtime keeps none.
 *
 * A reader past a sync id is read the same statements narrowed to the rows
 * what moved could move (`taskListDeltaStatements`): a plan whose own row,
 * pin, read mark, or block moved, that a moved plan blocks, or that names a
 * moved member, and an agent whose own row or pin moved, whose turn or
 * conversation moved, whose plan moved, that names a moved member or Mac,
 * or that a moved run started. Each keeps its rule of who reads it,
 * so a key another workspace's write moved reads no row.
 */

/** An agent as its live row declares it, which an expression among its columns is typed to. */
type AgentRow = (typeof TASK_LIST_READ.parts.agents.row)["Encoded"];

const starter = alias(user, "starter");
const archiver = alias(user, "archiver");
const assignee = alias(user, "assignee");

/**
 * The plans the account reaches, each with the reader's own pin, its
 * owner's name, whether it waits on an open task the account reaches
 * (`taskBlockedFor`), and whether an automation's run made it for itself
 * (`taskMadeByRun`), which the run names in the transaction that inserts the
 * task (`automation-runs.ts`'s `runTaskOf`), so the plan's own row moving
 * reads it. Note that `archivedAt` is still answered, as null, because
 * a desktop from before #4541 decodes a row without it as no row: no
 * plan is archived any more, and the column is dropped. The key goes with
 * the minimum supported desktop version, not with a service deploy, since a
 * desktop stays old far longer than a service build runs.
 */
function tasksStatement(userId: string, narrowed: SQL = sql`true`) {
  return liveRowsStatement(
    TASK_LIST_READ.parts.plans,
    {
      ordered: false,
      columns: {
        id: task.id,
        archivedAt: sql<null>`null::bigint`,
        workspaceId: task.organizationId,
        name: task.name,
        repository: task.repository,
        ownerId: sql<string>`coalesce(${task.userId}, ${NO_TASK_OWNER})`,
        ownerName: outerJoined(user.name),
        assigneeId: task.assigneeId,
        assigneeName: outerJoined(assignee.name),
        pinPosition: taskPin.position,
        status: task.status,
        priority: task.priority,
        number: task.number,
        creatorActor: task.creatorActor,
        creatorAgentId: task.creatorAgentId,
        parentTaskId: task.parentTaskId,
        mode: task.mode,
        blocked: sql<boolean>`${taskBlockedFor(userId)}`,
        madeByRun: sql<boolean>`${taskMadeByRun(task.id)}`,
        markedUnread: sql<boolean>`coalesce(${taskRead.markedUnread}, false)`,
      },
      instants: {
        pinnedAt: outerJoined(taskPin.pinnedAt),
        readThrough: sql<Date>`coalesce(${taskRead.readThrough}, ${task.readThrough}, ${task.createdAt})`,
        completedAt: task.completedAt,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(task)
        .leftJoin(taskPin, and(eq(taskPin.taskId, task.id), eq(taskPin.userId, userId)))
        .leftJoin(taskRead, and(eq(taskRead.taskId, task.id), eq(taskRead.userId, userId)))
        .leftJoin(user, eq(user.id, task.userId))
        .leftJoin(assignee, eq(assignee.id, task.assigneeId))
        .where(and(taskReachableBy(userId), narrowed)),
  );
}

/**
 * The issues the plans linked: none, since a plan links none. A released
 * desktop still follows the statement and decodes its rows, so it stands,
 * answering no rows.
 */
function issuesStatement() {
  return liveRowsStatement(
    TASK_LIST_READ.parts.issues,
    { ordered: false, columns: { id: task.id } },
    (selection) => queryBuilder.select(selection).from(task).where(sql`false`),
  );
}

/**
 * Every agent of a plan the account reaches, archived ones among them, each with its newest turn by
 * the order turns were queued, as `findLatestTurns` reads it, the harness
 * its conversation runs on, the Mac it runs on by its name, as
 * `devicesNamed` reads them, and whether its sandbox stands open: its
 * conversation records the session its sandbox is tagged with, which the
 * claim writes on the conversation's row, so a delta read takes the flip
 * from the log (`movedAgents`) and a pane waiting on the sandbox connects
 * as it lands, and where that sandbox stands (`SANDBOX_STATE_OF_AGENT`),
 * from its row in `agent_sandbox`, on its agent's topic. Note that its read mark is a constant, read through its
 * start and never marked unread, since an agent is read through its task's
 * mark alone and a released desktop reads one only for an agent on no task;
 * and that the Mac's last beat is not read,
 * because a beat wakes nothing (`deviceSync`) and a window judges a Mac by
 * its own presence read.
 */
function agentsStatement(userId: string, narrowed: SQL = sql`true`) {
  const latest = latestTurnOf(agentTable.conversationId, "latest_turn");
  return liveRowsStatement(
    TASK_LIST_READ.parts.agents,
    {
      ordered: false,
      columns: {
        id: agentTable.id,
        planId: agentTable.taskId,
        workspaceId: agentTable.organizationId,
        model: agentTable.model,
        effort: agentTable.effort,
        contextWindow: sql<string | null>`${agentTable.contextWindow}`,
        title: agentTable.title,
        brief: sql<
          AgentRow["brief"]
        >`case when ${agentTable.prompt} is not null then ${AGENT_BRIEF.PROMPT} when ${agentTable.descriptionSnapshot} is not null then ${AGENT_BRIEF.DESCRIPTION} else ${AGENT_BRIEF.BLANK} end`,
        repository: agentTable.repository,
        starterId: agentTable.userId,
        starterName: outerJoined(starter.name),
        startedByAgentId: agentTable.startedByAgentId,
        automationId: agentTable.automationId,
        automationName: sql<string | null>`${agentTable.automationOrigin} ->> 'name'`,
        runId: agentTable.automationRunId,
        runAutomationId: outerJoined(automationRun.automationId),
        archivedBy: agentTable.archivedBy,
        archiverName: outerJoined(archiver.name),
        disabledServers: agentTable.disabledServers,
        published: PULL_REQUEST_OF_AGENT_BRANCH,
        pullRequests: sql<
          AgentRow["pullRequests"]
        >`array(select ${agentPullRequest.pullRequest} from ${agentPullRequest} where ${agentPullRequest.agentId} = ${agentTable.id} order by ${agentPullRequest.createdAt} desc, ${agentPullRequest.number} desc)`,
        startedFrom: agentTable.startedFrom,
        source: agentTable.source,
        runtime: conversations.runtime,
        machine: sql<string | null>`${agentTable.machine}`,
        deviceId: agentTable.deviceId,
        deviceName: outerJoined(device.name),
        pinPosition: agentPin.position,
        turnId: outerJoined(latest.id),
        turnStatus: outerJoined(latest.status),
        cancelRequested: sql<boolean | null>`${isNotNull(latest.cancelRequestedAt)}`,
        turnFailure: sql<AgentFailure | null>`case when ${latest.id} is null then null else ${failureWordOf(latest)} end`,
        turnSessionEnded: sessionEndedOf(latest),
        sandboxOpen: sql<boolean>`${conversations.runtimeSessionId} is not null`,
        permissionMode: agentTable.permissionMode,
        pendingApprovals: PENDING_APPROVALS_OF_AGENT,
        sandboxState: SANDBOX_STATE_OF_AGENT,
        bootPhase: sql<BootPhase | null>`${agentBootTable.phase}`,
        sandboxRunsUntil: SANDBOX_RUNS_UNTIL_OF_AGENT,
        // Note that a released desktop reads an agent's read mark only for one on no task, which no agent is, so it is never marked.
        markedUnread: sql<boolean>`false`,
      },
      instants: {
        archivedAt: agentTable.archivedAt,
        pinnedAt: outerJoined(agentPin.pinnedAt),
        readThrough: agentTable.createdAt,
        createdAt: agentTable.createdAt,
        cancelRequestedAt: latest.cancelRequestedAt,
        queuedAt: outerJoined(latest.queuedAt),
        startedAt: latest.startedAt,
        settledAt: latest.settledAt,
        leaseUntil: latest.leaseUntil,
        waitsUntil: latest.waitsUntil,
        // Note that a desktop released before the turn record reads a line awaiting its turn by this; null
        // now that the turn the line awaits says it, until the next desktop release is the oldest in use.
        awaitingLineAt: sql<Date | null>`null::timestamptz`,
        lastSettledAt: lastSettledAtIn(agentTable.conversationId),
        sandboxStateAt: SANDBOX_STATE_AT_OF_AGENT,
      },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(agentTable)
        .leftJoin(agentPin, and(eq(agentPin.agentId, agentTable.id), eq(agentPin.userId, userId)))
        .leftJoin(starter, eq(starter.id, agentTable.userId))
        .leftJoin(automationRun, eq(automationRun.id, agentTable.automationRunId))
        .leftJoin(archiver, eq(archiver.id, sql`${agentTable.archivedBy} ->> 'userId'`))
        .leftJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .leftJoin(
          agentSandboxTable,
          and(
            eq(agentSandboxTable.sandboxName, sandboxNamedFor(conversations.runtimeSessionId)),
            eq(agentSandboxTable.agentId, agentTable.id),
          ),
        )
        .leftJoin(device, eq(device.id, agentTable.deviceId))
        .leftJoin(agentBootTable, eq(agentBootTable.agentId, agentTable.id))
        .leftJoinLateral(latest, sql`true`)
        .where(
          // An agent on a task is listed only where the account reaches the task too, as a read of it by its id is.
          and(agentVisibleTo(userId), narrowed),
        ),
  );
}

/**
 * Where the agent's current sandbox stands as its row in `agent_sandbox`
 * last recorded it (`@repo/features/agent-sandbox-wire`): none where no
 * row stands, off where it was released or is being, booting while a boot
 * is under way, and otherwise running until `SANDBOX_IDLE` after its last
 * recorded use, which a reader reads against its own clock. The last use is
 * written at most once a minute, so the stop it gives is never later than
 * the sandbox's own, and at most that much earlier.
 */
const SANDBOX_STATE_OF_AGENT = sql<SandboxState | null>`case
  when ${agentSandboxTable.sandboxName} is null then null
  when ${agentSandboxTable.state} <> ${AGENT_SANDBOX_STATE.LIVE} then ${SANDBOX_STATE.OFF}
  when ${agentSandboxTable.bootingSince} is not null then ${SANDBOX_STATE.BOOTING}
  else ${SANDBOX_STATE.RUNNING} end`;

const SANDBOX_STATE_AT_OF_AGENT = sql<Date | null>`coalesce(${agentSandboxTable.bootingSince}, ${agentSandboxTable.usedAt})`;

// Note that the stop is summed as epoch milliseconds, as an instant is read, since adding an interval to a timestamp is not immutable.
const SANDBOX_RUNS_UNTIL_OF_AGENT = sql<number | null>`case
  when ${agentSandboxTable.state} = ${AGENT_SANDBOX_STATE.LIVE} and ${agentSandboxTable.bootingSince} is null
  then floor(extract(epoch from (${agentSandboxTable.usedAt} at time zone 'UTC')) * 1000)::float8 + ${Duration.toMillis(SANDBOX_IDLE)} end`;

/**
 * The asks the agent's runner holds for a member's answer, the oldest first,
 * each as its row keeps it in the wire's shape (`agent_approval.ask`), so
 * the statement calls no function Realtime refuses. Note that the input is
 * carried as its row keeps it, the agent's transcript content, to the
 * members who see the agent alone.
 */
const PENDING_APPROVALS_OF_AGENT = sql<
  AgentRow["pendingApprovals"]
>`array(select ${agentApproval.ask} from ${agentApproval} where ${agentApproval.agentId} = ${agentTable.id} and ${agentApproval.settledAt} is null order by ${agentApproval.createdAt}, ${agentApproval.id})`;

/** The plans what moved could move: their own rows, the reader's pins and read marks, a block either way, a plan a moved plan blocks, and a plan naming a moved member. */
function movedPlans(moved: SyncMoved): SQL {
  const plans = moved.keys(taskSync, task.id);
  const members = moved.keys(userSync, user.id);
  const blockedByMoved = sql`(${queryBuilder
    .select({ id: taskBlock.blockedTaskId })
    .from(taskBlock)
    .where(liveKeysIn(taskBlock.blockerTaskId, plans))})`;
  return (
    or(
      liveKeysIn(task.id, [
        ...plans,
        ...moved.keys(taskPinSync, taskPin.taskId),
        ...moved.keys(taskReadSync, taskRead.taskId),
        ...moved.keys(taskBlockSync, taskBlock.blockedTaskId),
      ]),
      sql`${task.id} in ${blockedByMoved}`,
      liveKeysIn(task.userId, members),
      liveKeysIn(task.assigneeId, members),
    ) ?? sql`false`
  );
}

/**
 * The agents what moved could move: their own rows and the reader's pins,
 * those whose turn or conversation moved, those of a moved plan, those
 * naming a moved member or Mac, and those a moved run started.
 */
function movedAgents(moved: SyncMoved): SQL {
  const agents = moved.keys(agentSync, agentTable.id);
  const members = moved.keys(userSync, user.id);
  return (
    or(
      liveKeysIn(agentTable.id, [
        ...agents,
        ...moved.keys(agentPinSync, agentPin.agentId),
        ...moved.keys(agentPullRequestSync, agentPullRequest.agentId),
        ...moved.topics(agentApprovalSync, TOPIC.AGENT),
        ...moved.topics(agentSandboxSync, TOPIC.AGENT),
        ...moved.topics(agentBootSync, TOPIC.AGENT),
        ...moved.topics(turnsSync, TOPIC.AGENT),
      ]),
      liveKeysIn(agentTable.conversationId, [
        ...moved.topics(messagesSync, TOPIC.CONVERSATION),
        ...moved.topics(conversationsSync, TOPIC.CONVERSATION),
      ]),
      liveKeysIn(agentTable.taskId, moved.keys(taskSync, task.id)),
      liveKeysIn(agentTable.userId, members),
      liveKeysIn(sql`${agentTable.archivedBy} ->> 'userId'`, members),
      liveKeysIn(agentTable.deviceId, moved.keys(deviceSync, device.id)),
      liveKeysIn(agentTable.automationRunId, moved.keys(automationRunSync, automationRun.id)),
    ) ?? sql`false`
  );
}

/**
 * The account's task list (`tasks`): the tasks it reaches and every agent
 * of them, each with the account's pin, the names it
 * shows, and what its status is read from, woken on the account's topic
 * and on each of its workspaces'. A task, a block between two tasks, an
 * agent, a member's name, a Mac's name, or a turn starting or settling
 * names the workspace; the account's pins and read marks, its memberships,
 * and what admits it to a repository name the account. Note that a message
 * wakes no task list, because a streamed step rewrites one every moment and
 * names only its conversation: an awaiting line that moves with no turn
 * starting or settling shows at the hold's end, as do the rename of
 * someone the list names who has left every workspace and a Mac's last
 * beat, which wakes nothing.
 *
 * A reader past a sync id is answered what moved alone: a message or a
 * conversation names only its conversation, so its rows are taken whatever
 * they name, and narrow the agents to the one of that conversation the
 * reader reaches. Its plans and its agents are each part's own rows, and a
 * write to its account's membership or GitHub access answers it whole.
 */
export const tasksRead = bindLiveRead(TASK_LIST_READ, {
  reads: [
    taskSync,
    taskBlockSync,
    taskPinSync,
    taskReadSync,
    agentSync,
    agentPinSync,
    agentPullRequestSync,
    agentApprovalSync,
    agentSandboxSync,
    agentBootSync,
    automationSync,
    automationRunSync,
    userSync,
    turnsSync,
    messagesSync,
    conversationsSync,
    deviceSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId }) => readerAndWorkspaceTopics(userId),
  statements: ({ userId }) => ({
    plans: tasksStatement(userId),
    agents: agentsStatement(userId),
    issues: issuesStatement(),
  }),
  delta: {
    whole: [memberSync, githubPersonalTokenSync, githubRepositoryReadSync],
    anyTopic: [messagesSync, conversationsSync],
    own: { plans: taskSync, agents: agentSync },
    statements: ({ userId }, moved) => ({
      plans: tasksStatement(userId, movedPlans(moved)),
      agents: agentsStatement(userId, movedAgents(moved)),
      issues: issuesStatement(),
    }),
  },
});
