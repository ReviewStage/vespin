import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  type Agent,
  listWorkspaceAgents,
  readAgent,
  readVisibleAgent,
  taskNamesOf,
} from "@repo/database/models/agent-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import { type TaskStatus, taskStatusSchema } from "@repo/features/task-wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { isRecord, type UnparsedWireValue, wireUuidSchema } from "../core.js";
import { assigneeIdOf, memberLinkWrittenSchema } from "./task-assignee.js";
import { TASK_REF_INPUT } from "./task-ref.js";

/**
 * workspace-agents.ts -- the coding agents of one workspace as an agent's tools read them: on any task, by any member, one task's alone where asked, each with its task's name.
 *
 * The agent tools every coding agent is offered
 * (`agent-tools.ts`) list and find the agents here. A list names the archived
 * agents too, each marked, since an agent may need to know one stands, and
 * names each agent's task by its name, read once
 * for the lot; it is narrowed to one task by the id a listed agent's task
 * answered or the caller's own, searched by words of an agent's title
 * or its task's name, and narrowed by whether an agent is archived, who
 * started it, whether an automation (or which) started it, and where its
 * task stands, each in the query so a page is never cut short. The agents the caller works beside come first,
 * the agent that started it and the agents it started, then those on its
 * task, as the store orders them (`agent-store.ts`'s `around`), and the
 * rest newest first, a page at a time: a list cut at its bound says so with
 * the offset of the next page, so a caller is never left with a silent cut.
 * Every read is on the account's own
 * standing: a workspace it is not in has no agents, and an agent of another
 * workspace, even one the account is also in, is none of these.
 */

/** The most agents a list answers at once, the caller's own first and then the newest started first. */
export const WORKSPACE_AGENTS_LIST_LIMIT = 50;

/** Why a list's filter read as nothing to list by, in words the model can act on. */
export const AGENT_LIST_FILTER_REFUSAL = {
  UNREADABLE:
    "Not run: narrow the list by a taskId, by words of an agent's title or its " +
    `task's name of at most ${AGENT_BOUNDS.MAX_SEARCH_CHARS} characters, by archived, ` +
    "startedBy, automation, automationId, or a task status, and page it by an offset of 0 or more.",
  THIS_TASK_KEY:
    "Not run: list_agents takes no thisTask; pass your own task's id, the taskId your " +
    "instructions name, as taskId.",
  MINE_KEY:
    "Not run: list_agents takes no mine; pass the developer you work for as startedBy, by the " +
    "mention link your instructions name for them.",
  NO_MEMBER:
    "Not run: startedBy names no person; name a member by their mention link, " +
    "`[@Name](…/person/<id>)`, or its address alone.",
} as const;

/** The filters a list takes: one task by its id, words to search by, and the page to read. */
export const AGENT_LIST_INPUT = Schema.Struct({
  taskId: Schema.optionalKey(
    describeWire(
      TASK_REF_INPUT,
      "Only the agents on this task, by the id a listed agent's task answered or its key, such as ACME-42; leave it out for the whole workspace.",
    ),
  ),
  words: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(AGENT_BOUNDS.MAX_SEARCH_CHARS)),
      "Only the agents whose title or task's name holds each of these words, whatever their " +
        "case, to search the workspace by; leave it out for every agent.",
    ),
  ),
  archived: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true for only the archived agents, false for only those not archived; leave it out for both.",
    ),
  ),
  startedBy: Schema.optionalKey(
    describeWire(
      memberLinkWrittenSchema,
      "Only the agents this member started, by their mention link, `[@Name](…/person/<id>)`, " +
        "or its address alone; leave it out for every member's.",
    ),
  ),
  automation: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true for only the agents an automation's run started, false for only those started " +
        "otherwise; leave it out for both.",
    ),
  ),
  automationId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      `Only the agents this automation's runs started, by the id ${AGENT_TOOL.LIST_AUTOMATIONS} answered.`,
    ),
  ),
  taskStatus: Schema.optionalKey(
    describeWire(taskStatusSchema, "Only the agents on a task that stands here, such as done."),
  ),
  offset: Schema.optionalKey(
    describeWire(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      "How many of the matching agents to pass over: the nextOffset an earlier list answered, " +
        "to read the next page; leave it out for the first.",
    ),
  ),
});

const readFilter = Schema.decodeUnknownResult(AGENT_LIST_INPUT);

/** An agent's task as a list names it; null for a task the reader cannot read. */
export interface AgentTask {
  readonly id: string;
  readonly name: string;
}

/** A page of a workspace's agents, the task each stands on, and the offset of the next page where the list was cut. */
export interface WorkspaceAgents {
  readonly agents: readonly Agent[];
  readonly taskOf: (agent: Agent) => AgentTask | null;
  readonly nextOffset: number | null;
}

/** What a list's input narrows it to: one task where it names one, words to search by, the agents' archive, starter (by their account's id), automation and task's status where named, and the page to read. */
export interface AgentListFilter {
  readonly taskId: string | undefined;
  readonly words: string | undefined;
  readonly archived: boolean | undefined;
  readonly startedBy: string | undefined;
  readonly automation: boolean | undefined;
  readonly automationId: string | undefined;
  readonly taskStatus: TaskStatus | undefined;
  readonly offset: number;
}

/** The keys the tool's earlier words taught, each refused with the one that replaced it. */
const RETIRED_LIST_KEYS = [
  { key: "thisTask", refusal: AGENT_LIST_FILTER_REFUSAL.THIS_TASK_KEY },
  { key: "mine", refusal: AGENT_LIST_FILTER_REFUSAL.MINE_KEY },
] as const;

/**
 * What a list's input narrows it to: the whole workspace where it names
 * nothing, or a refusal where the input does not read, names a key the
 * tool's earlier words taught (`RETIRED_LIST_KEYS`), or names a starter by
 * a link that is no person's.
 */
export function listedFilter(input: UnparsedWireValue): Result.Result<AgentListFilter, string> {
  const retired = isRecord(input)
    ? RETIRED_LIST_KEYS.find(({ key }) => input[key] !== undefined)
    : undefined;

  if (retired !== undefined) return Result.fail(retired.refusal);
  const read = readFilter(input);

  if (Result.isFailure(read)) return Result.fail(AGENT_LIST_FILTER_REFUSAL.UNREADABLE);
  const { offset, startedBy, ...narrowed } = read.success;
  const starter = startedBy === undefined ? undefined : assigneeIdOf(startedBy);

  if (startedBy !== undefined && starter === undefined) {
    return Result.fail(AGENT_LIST_FILTER_REFUSAL.NO_MEMBER);
  }

  return Result.succeed({
    taskId: narrowed.taskId,
    words: narrowed.words,
    archived: narrowed.archived,
    startedBy: starter,
    automation: narrowed.automation,
    automationId: narrowed.automationId,
    taskStatus: narrowed.taskStatus,
    offset: offset ?? 0,
  });
}

/** The store's narrowing for a list's archive, starter, automation and task's status, each left out where the filter names none. */
function storeNarrowingOf(filter: AgentListFilter) {
  const { archived, startedBy, automation, automationId, taskStatus } = filter;

  return {
    // An archived agent is listed unless the filter asks for only those not archived.
    includeArchived: archived !== false,
    ...(archived === true ? { archivedOnly: true } : undefined),
    ...(startedBy === undefined ? undefined : { startedBy }),
    ...(automation === undefined ? undefined : { automation }),
    ...(automationId === undefined ? undefined : { automationId }),
    ...(taskStatus === undefined ? undefined : { taskStatus }),
  };
}

/** A page cut from a list read one past its bound, and the next page's offset where that one past stood; null where the list ended. */
export interface ListedPage<A> {
  readonly page: readonly A[];
  readonly nextOffset: number | null;
}

/**
 * A page of a list the store read from `offset` at one past `bound`, so a
 * next page is known to stand without a count of its own: the agent tools'
 * list and the hosted list (`agents-procedures.ts`) cut their pages here.
 */
export function listedPage<A>(listed: readonly A[], offset: number, bound: number): ListedPage<A> {
  return {
    page: listed.slice(0, bound),
    nextOffset: listed.length > bound ? offset + bound : null,
  };
}

/**
 * A page of the workspace's agents, archived ones among them unless the
 * filter leaves them out, narrowed as the filter asks, the calling agent left out: its starter and the agents
 * it started first, then those on its task, then the rest, each newest
 * first, at most the list's bound from the filter's offset, and the next
 * page's offset where more stand. A caller that is no agent, a member,
 * leaves no one out and reads the whole list newest first.
 */
export const workspaceAgentsOf = (
  userId: string,
  workspaceId: string,
  caller: Agent | undefined,
  filter: AgentListFilter,
): Effect.Effect<WorkspaceAgents, StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    const listed = yield* listWorkspaceAgents(userId, workspaceId, {
      ...(filter.taskId === undefined ? undefined : { taskId: filter.taskId }),
      ...(filter.words === undefined ? undefined : { words: filter.words }),
      ...storeNarrowingOf(filter),
      ...(caller === undefined
        ? undefined
        : {
            except: caller.id,
            around: {
              agentId: caller.id,
              taskId: caller.taskId,
              startedByAgentId: caller.startedByAgentId,
            },
          }),
      offset: filter.offset,
      // One past the bound tells whether a next page stands, without a count of its own.
      limit: WORKSPACE_AGENTS_LIST_LIMIT + 1,
    });

    const { page: agents, nextOffset } = listedPage(
      listed,
      filter.offset,
      WORKSPACE_AGENTS_LIST_LIMIT,
    );

    const names = yield* taskNamesOf(
      userId,
      agents.flatMap((agent) => (agent.taskId === null ? [] : [agent.taskId])),
    );

    const taskOf = ({ taskId }: Agent): AgentTask | null => {
      const named = taskId === null ? undefined : names.get(taskId);

      return taskId === null || named === undefined ? null : { id: taskId, ...named };
    };

    return { agents, taskOf, nextOffset };
  });

/**
 * The agent under the id where it is one of the workspace's, archived or
 * not, as the caller's tools name it; nothing for an agent of another
 * workspace or none. Another agent is read as a member may read it
 * (`readVisibleAgent`), and a calling agent itself as it reads itself
 * (`readAgent`), so its own tools never lose it when its starter
 * loses sight of its task; a caller that is no agent, a member, names no
 * `callerId`.
 */
export const workspaceAgent = (
  userId: string,
  workspaceId: string,
  agentId: string,
  callerId: string | undefined,
): Effect.Effect<Option.Option<Agent>, StoreFailure, DatabaseServices> =>
  Effect.map(
    agentId === callerId ? readAgent(userId, agentId) : readVisibleAgent(userId, agentId),
    (found) => Option.filter(found, (agent) => agent.organizationId === workspaceId),
  );

/** The task one agent stands on, read as the account; null for one the account cannot read. */
export const agentTaskOf = (
  userId: string,
  agent: Agent,
): Effect.Effect<AgentTask | null, StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    const { taskId } = agent;

    if (taskId === null) return null;
    const named = (yield* taskNamesOf(userId, [taskId])).get(taskId);

    return named === undefined ? null : { id: taskId, ...named };
  });

/** One agent's task as the model reads it, and whether it is the task of whoever is asking. */
export interface AgentTaskReading {
  readonly task: AgentTask | null;
  readonly onYourTask: boolean;
}

/** One agent's task as the model reads it, beside the task of whoever is asking. */
export function taskReading(task: AgentTask | null, ownTask: string | null): AgentTaskReading {
  return { task, onYourTask: task !== null && task.id === ownTask };
}
