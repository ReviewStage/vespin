import { liveKeysIn } from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { sandboxNamedFor } from "@repo/database/models/agent-sandboxes";
import { PULL_REQUEST_OF_AGENT_BRANCH } from "@repo/database/models/agent-store";
import { taskMadeByRun } from "@repo/database/models/run-tasks";
import { taskBlockedFor, taskBlockIdsFor } from "@repo/database/models/task-block-store";
import { agentVisibleTo, taskReachableBy } from "@repo/database/models/workspace-store";
import {
  agentPin,
  agentPullRequest,
  conversations,
  device,
  taskFollower,
  taskPin,
  taskRead,
} from "@repo/database/schemas";
import { agentTable } from "@repo/database/schemas/agent";
import { agentApproval } from "@repo/database/schemas/agent-approval";
import { agentBootTable } from "@repo/database/schemas/agent-boot";
import { AGENT_SANDBOX_STATE, agentSandboxTable } from "@repo/database/schemas/agent-sandbox";
import { member, user } from "@repo/database/schemas/auth";
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
  taskFollowerSync,
  taskPinSync,
  taskReadSync,
  taskSync,
  turnsSync,
  userSync,
} from "@repo/database/sync/tables";
import { BOOT_PHASE, type WireBootPhase } from "@repo/features/agent-boot";
import { SANDBOX_STATE, type SandboxState } from "@repo/features/agent-sandbox-wire";
import { AGENT_BRIEF, type AgentFailure } from "@repo/features/agent-wire";
import {
  NO_TASK_OWNER,
  SETTLED_PAGE_SIZE,
  TASK_LIST_READ,
  TASK_PAGE_READ,
  TASK_ROWS_READ,
  TASK_SEARCH_LIMIT,
  TASK_SEARCH_READ,
} from "@repo/features/task-list-live";
import { TASK_BLOCK_RELATION, TASK_STATUS } from "@repo/features/task-wire";
import { SANDBOX_IDLE } from "@repo/sandbox";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
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
 * One column of the task's followers who are members of its workspace, the
 * earliest to follow first, as an array. Note that each follower's id and switch are two arrays in
 * one order rather than one of objects, because building an object calls a
 * function Postgres marks only stable.
 */
function followersColumnOf<Value>(
  column: typeof taskFollower.userId | typeof taskFollower.machines,
) {
  const followers = queryBuilder
    .select({ value: column })
    .from(taskFollower)
    .where(
      and(
        eq(taskFollower.taskId, task.id),
        exists(
          queryBuilder
            .select({ one: sql`1` })
            .from(member)
            .where(
              and(
                eq(member.userId, taskFollower.userId),
                eq(member.organizationId, task.organizationId),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(taskFollower.createdAt), asc(taskFollower.userId));

  return sql<Value[] | null>`array(${followers})`;
}

/**
 * The plans the account reaches, each with the reader's own pin, its
 * owner's name, whether it waits on an open task the account reaches
 * (`taskBlockedFor`), the tasks it waits on and that wait on it
 * (`taskBlockIdsFor`), and whether an automation's run made it for itself
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
        blockedBy: taskBlockIdsFor(userId, TASK_BLOCK_RELATION.BLOCKED_BY),
        blocks: taskBlockIdsFor(userId, TASK_BLOCK_RELATION.BLOCKS),
        madeByRun: sql<boolean>`${taskMadeByRun(task.id)}`,
        markedUnread: sql<boolean>`coalesce(${taskRead.markedUnread}, false)`,
        followerIds: followersColumnOf<string>(taskFollower.userId),
        followerMachines: followersColumnOf<boolean>(taskFollower.machines),
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
 * The tasks of the account's own pins, whatever their status or age: each
 * it pinned, and each with an agent it pinned. Note that a tab pinned to
 * the sidebar is kept in the window's own storage, never here, so the
 * window reads a pinned tab's task outside the list itself.
 */
function pinnedTaskOf(userId: string): SQL {
  const pinnedAgentTasks = queryBuilder
    .select({ taskId: agentTable.taskId })
    .from(agentPin)
    .innerJoin(agentTable, eq(agentTable.id, agentPin.agentId))
    .where(eq(agentPin.userId, userId));

  return (
    or(
      exists(
        queryBuilder
          .select({ one: sql`1` })
          .from(taskPin)
          .where(and(eq(taskPin.taskId, task.id), eq(taskPin.userId, userId))),
      ),
      sql`${task.id} in (${pinnedAgentTasks})`,
    ) ?? sql`false`
  );
}

/**
 * Which tasks the account's list follows live (`tasksRead`), of those it
 * reaches: the tasks of its own pins (`pinnedTaskOf`), which Pinned draws
 * whatever their status or age, and the active and recent ones. Note that
 * every task is still active and recent here, so the list follows every
 * task it reaches; the narrowing to active and recent ones replaces that
 * `true` alone, and the pins stay live beside it.
 */
function liveTaskOf(userId: string): SQL {
  return or(pinnedTaskOf(userId), sql`true`) ?? sql`true`;
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
        // Note that a boot waiting on its workspace's drive is said as starting with building beside it, since released apps decode the phase strictly.
        bootPhase: sql<WireBootPhase | null>`case when ${agentBootTable.phase} = ${BOOT_PHASE.BUILDING} then ${BOOT_PHASE.STARTING} else ${agentBootTable.phase} end`,
        building: sql<
          true | null
        >`case when ${agentBootTable.phase} = ${BOOT_PHASE.BUILDING} then true else null end`,
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

/**
 * The plans what moved could move: their own rows, the reader's pins and
 * read marks, a block either way, a follower, a plan a moved plan blocks,
 * a plan whose agent's pin moved, and a plan naming a moved member.
 */
function movedPlans(moved: SyncMoved): SQL {
  const plans = moved.keys(taskSync, task.id);
  const members = moved.keys(userSync, user.id);

  const blockedByMoved = sql`(${queryBuilder
    .select({ id: taskBlock.blockedTaskId })
    .from(taskBlock)
    .where(liveKeysIn(taskBlock.blockerTaskId, plans))})`;

  // A pin of an agent moves its task into the live set or out of it, so its task is read again.
  const ofPinnedAgent = sql`(${queryBuilder
    .select({ taskId: agentTable.taskId })
    .from(agentTable)
    .where(liveKeysIn(agentTable.id, moved.keys(agentPinSync, agentPin.agentId)))})`;

  return (
    or(
      liveKeysIn(task.id, [
        ...plans,
        ...moved.keys(taskPinSync, taskPin.taskId),
        ...moved.keys(taskReadSync, taskRead.taskId),
        ...moved.keys(taskBlockSync, taskBlock.blockedTaskId),
        ...moved.keys(taskBlockSync, taskBlock.blockerTaskId),
        ...moved.keys(taskFollowerSync, taskFollower.taskId),
      ]),
      sql`${task.id} in ${blockedByMoved}`,
      sql`${task.id} in ${ofPinnedAgent}`,
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

/** Every table the task list's statements read, which a write to wakes them. */
const TASK_LIST_TABLES = [
  taskSync,
  taskBlockSync,
  taskFollowerSync,
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
];

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
  reads: TASK_LIST_TABLES,
  topics: ({ userId }) => readerAndWorkspaceTopics(userId),
  statements: ({ userId }) => ({
    plans: tasksStatement(userId, liveTaskOf(userId)),
    agents: agentsStatement(userId),
    issues: issuesStatement(),
  }),
  delta: {
    whole: [memberSync, githubPersonalTokenSync, githubRepositoryReadSync],
    anyTopic: [messagesSync, conversationsSync],
    own: { plans: taskSync, agents: agentSync },
    statements: ({ userId }, moved) => ({
      plans: tasksStatement(userId, and(liveTaskOf(userId), movedPlans(moved)) ?? sql`false`),
      agents: agentsStatement(userId, movedAgents(moved)),
      issues: issuesStatement(),
    }),
  },
});

/**
 * The task `id` names, or the task of the agent it names, as one statement
 * of the list's: the task itself where `id` is one, or the agent's own
 * task. Note that an agent on no task names no task, so it reads none.
 */
function taskNamedBy(id: string): SQL {
  const ofAgent = queryBuilder
    .select({ taskId: agentTable.taskId })
    .from(agentTable)
    .where(eq(agentTable.id, id));

  return or(eq(task.id, id), sql`${task.id} in (${ofAgent})`) ?? sql`false`;
}

/**
 * One task outside the list a window holds (`taskRows`), by the task or the
 * agent its `id` names: the list's own statements narrowed to that task and
 * every agent of it, or to the agent alone where it stands on no task, on
 * the list's rule of who reads them, so one the account does not reach
 * reads no row. It is read once, as a window opens it, and never followed,
 * so it wakes as the list does.
 */
export const taskRowsRead = bindLiveRead(TASK_ROWS_READ, {
  reads: TASK_LIST_TABLES,
  topics: ({ userId }) => readerAndWorkspaceTopics(userId),
  statements: ({ userId, id }) => {
    const ofTask = queryBuilder.select({ id: task.id }).from(task).where(taskNamedBy(id));

    return {
      plans: tasksStatement(userId, taskNamedBy(id)),
      agents: agentsStatement(
        userId,
        or(eq(agentTable.id, id), sql`${agentTable.taskId} in (${ofTask})`) ?? sql`false`,
      ),
    };
  },
});

/** A query that is a task's key (`ACME-42`), its number taken; the prefix is read off the workspace's name, so the number alone is matched and the key's prefix ranked by the window. */
const KEY_QUERY = /^[\p{L}\p{N}]{1,4}-(\d+)$/u;

/** The largest number a task's key may name, Postgres's `integer`. */
const MAX_TASK_NUMBER = 2_147_483_647;

/** An `ILIKE` pattern holding `word` anywhere, its own `%`, `_`, and `\` taken as themselves. */
function containing(word: string): string {
  return `%${word.replace(/[\\%_]/gu, (special) => `\\${special}`)}%`;
}

/** The words of a query, split as the window's search splits them, on white space. */
function wordsOf(query: string): readonly string[] {
  return query.trim().split(/\s+/u).filter(Boolean);
}

/** The tasks whose name holds every word of `query`, whatever its case; none for a query of no words. */
function taskNamedWith(query: string): SQL {
  const words = wordsOf(query);

  return and(...words.map((word) => ilike(task.name, containing(word)))) ?? sql`false`;
}

/**
 * The tasks whose number `query` names, as a key (`ACME-42`) or alone; none
 * for any other query. Note that a number names at most one task of each
 * workspace, so these are few however many tasks the account reaches.
 */
function taskNumberedBy(query: string): SQL {
  const words = wordsOf(query);
  const keyed = words.length === 1 ? (KEY_QUERY.exec(words[0] ?? "")?.[1] ?? words[0]) : undefined;
  const number = keyed !== undefined && /^\d+$/u.test(keyed) ? Number(keyed) : undefined;

  return number === undefined || number > MAX_TASK_NUMBER ? sql`false` : eq(task.number, number);
}

/**
 * A task search (`taskSearch`): the list's own statements narrowed to the
 * tasks its `query` finds among those the account reaches, and every agent
 * of them, on the list's rule of who reads them, so a task the account does
 * not reach is never found: the latest changed of those whose name holds
 * every word of it, at most `TASK_SEARCH_LIMIT`, and each whose number its
 * key names, which no limit leaves out. It is read once, as a window
 * searches, and never followed, so it wakes as the list does. Note that a
 * name is matched by a scan of the account's tasks with no index of its
 * own, as the list itself reads them all.
 */
export const taskSearchRead = bindLiveRead(TASK_SEARCH_READ, {
  reads: TASK_LIST_TABLES,
  topics: ({ userId }) => readerAndWorkspaceTopics(userId),
  statements: ({ userId, query }) => {
    const named = queryBuilder
      .select({ id: task.id })
      .from(task)
      .where(and(taskReachableBy(userId), taskNamedWith(query)))
      .orderBy(desc(task.updatedAt), desc(task.id))
      .limit(TASK_SEARCH_LIMIT);

    const numbered = queryBuilder
      .select({ id: task.id })
      .from(task)
      .where(and(taskReachableBy(userId), taskNumberedBy(query)));

    const found = sql`(${named}) union (${numbered})`;

    return {
      plans: tasksStatement(userId, sql`${task.id} in (${found})`),
      agents: agentsStatement(userId, sql`${agentTable.taskId} in (${found})`),
    };
  },
});

/**
 * When a settled task was finished, as the wire carries an instant, whole
 * epoch milliseconds read at UTC (`live-statement.ts`): its `completedAt`,
 * else its last save for one finished before that was kept.
 */
const FINISHED_AT = sql<number>`floor(extract(epoch from (coalesce(${task.completedAt}, ${task.updatedAt}) at time zone 'UTC')) * 1000)::float8`;

/**
 * The tasks one page of a workspace's settled ones holds (`taskPage`): those
 * the account reaches, Done or Canceled, finished before the cursor where
 * one is named, the newest finished first and by id between those finished
 * at one instant, at most a page of them. Note that the order and the cursor
 * read the instant in whole milliseconds, as the wire carries it, so a task
 * finished within the millisecond of the cursor's is neither read twice nor
 * left out.
 */
function settledPage(userId: string, workspaceId: string, beforeAt: string, beforeId: string) {
  const at = Number(beforeAt);

  const past =
    beforeId === "" || beforeAt === "" || !Number.isFinite(at)
      ? sql`true`
      : sql`(${FINISHED_AT}, ${task.id}) < (${at}::float8, ${beforeId}::uuid)`;

  return queryBuilder
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        taskReachableBy(userId),
        eq(task.organizationId, workspaceId),
        inArray(task.status, [TASK_STATUS.DONE, TASK_STATUS.CANCELED]),
        past,
      ),
    )
    .orderBy(sql`${FINISHED_AT} desc`, sql`${task.id} desc`)
    .limit(SETTLED_PAGE_SIZE);
}

/**
 * One page of a workspace's settled tasks (`taskPage`), past the cursor the
 * reader names: the list's own statements narrowed to the page's tasks and
 * every agent of them, on the list's rule of who reads them, so a task the
 * account does not reach reads no row. It is read once, as a list asks for
 * the page, and never followed, so it wakes as the list does.
 */
export const taskPageRead = bindLiveRead(TASK_PAGE_READ, {
  reads: TASK_LIST_TABLES,
  topics: ({ userId }) => readerAndWorkspaceTopics(userId),
  statements: ({ userId, workspaceId, beforeAt, beforeId }) => {
    const page = settledPage(userId, workspaceId, beforeAt, beforeId);

    return {
      plans: tasksStatement(userId, sql`${task.id} in (${page})`),
      agents: agentsStatement(userId, sql`${agentTable.taskId} in (${page})`),
    };
  },
});
