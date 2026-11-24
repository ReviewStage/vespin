import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  readTask,
  type TaskAssigneeNotMember,
  type TaskIdTaken,
} from "@repo/database/models/task-store";
import { turnAsker } from "@repo/database/models/turn-asker";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { githubRepositoryFullNameSchema } from "@repo/features/github-repositories-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  DESCRIPTION_ACTOR,
  TASK_BOUNDS,
  TASK_CREATE_RELATION_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskCreateRelation,
  type TaskOrigin,
  type TaskSummary,
  taskPrioritySchema,
  taskStatusSchema,
} from "@repo/features/task-wire";
import { EXPERIMENT } from "@repo/settings";
import { describeWire } from "@repo/wire/effect";
import { Effect, Match, Option, Predicate, Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, type WireRecord } from "../core.js";
import { SERVER_TASK_SOURCE } from "../events/server-events.js";
import type { HostedRefusal } from "../http/http-effect.js";
import {
  createTaskAsked,
  type TaskCreateAsked,
  type TaskCreateRelationRefused,
} from "../tasks/task-create-relation.js";
import { followerReadingsOf } from "../tasks/task-following.js";
import {
  AGENT_CALLER,
  AGENT_TOOL_REFUSAL,
  type AgentCall,
  type AgentReadCall,
  type AgentToolServices,
  agentToolRejected,
  callerAgent,
  callerTask,
  callerUserId,
  callerWorkspace,
  cutOnLine,
  orStoreRefusal,
  repositoryRefusalWords,
  TASK_PRIORITY_WORDS,
  taskStandingOf,
} from "./agent-tools.js";
import { calledId } from "./called-id.js";
import { assigneeIdOf, TASK_ASSIGNEE_INPUT } from "./task-assignee.js";
import { TASK_IDS, taskBlockReadings } from "./task-block-changes.js";
import {
  TASK_REF_INPUT,
  TASK_REF_MISS,
  TASK_REF_WORDS,
  type TaskRefMiss,
  taskIdOfInput,
  taskIdOfRef,
  taskIdsOfInput,
} from "./task-ref.js";
import {
  EVERY_EXPERIMENT_ON,
  type ExperimentsOn,
  experimentOnIn,
} from "./workspace-experiment-on.js";
import { workspaceNamingOf } from "./written-mentions.js";

/**
 * task-tools.ts -- the tools every agent reads and makes the workspace's tasks by: read one task's description and where it stands, and make one.
 *
 * Every coding agent is offered the same `read_task`,
 * one implementation, beside `list_tasks` (`agent-tools.ts`), which
 * names the tasks it reads by id; a key such as `ACME-42` names its number
 * in the caller's workspace, and one whose prefix is not that workspace's is
 * refused, naming the prefix it holds (`task-ref.ts`). It reads any task of the caller's
 * workspace, a teammate's included, as the member the
 * caller acts for could open it in the sidebar, read on that member's
 * standing now; a task of another workspace is none of the caller's, even
 * where the member is also in it. It answers the task as its row stands, the
 * brief the developer started it with, the tasks it is blocked by and blocks
 * that the member reaches, and its description's saved text cut on a
 * line to a bound, so an agent reads another task's description without its being
 * mentioned.
 *
 * `create_task` makes a task as the member the caller acts for makes one from
 * the sidebar, through the one make every door shares
 * (`tasks/task-create-relation.ts`): in the caller's workspace, on the
 * repository named, the one the caller works in where none is, or none, and
 * with a description to start from where one is given, always worked by its
 * agents: a `mode` an agent whose session listed it before Pilot was removed
 * still sends is ignored, as any key the input does not declare is. It is
 * made under an id drawn from the call's key (`called-id.ts`), so a call run again answers the
 * task it made and makes no second.
 * Every answer is data the model reads, never a credential.
 */

/** The most characters of a description a read answers, about ten thousand tokens: the rest is counted, never sent. */
export const DESCRIPTION_TEXT_READ_CHARS = 40_000;

/** Why a read answered nothing, in words the model can act on. */
export const READ_TASK_REFUSAL = {
  UNREADABLE:
    `Not read: name the task in taskId by the id ${AGENT_TOOL.LIST_TASKS} answered or by its ` +
    "key, such as ACME-42.",
  NO_TASK:
    "Not read: no task of your workspace has that id or key; " +
    `${AGENT_TOOL.LIST_TASKS} names them.`,
} as const;

/** Why a key of another workspace's prefix read nothing, naming the prefix the caller's workspace keys its tasks by. */
export function readTaskOtherPrefixRefusal(miss: { prefix: string; key: string }): string {
  return (
    `Not read: that key names no task of your workspace, whose keys open with ${miss.prefix}-; ` +
    `name the task in taskId by a key such as ${miss.key}, or by the id ${AGENT_TOOL.LIST_TASKS} answered.`
  );
}

const READ_TASK_INPUT = Schema.Struct({
  taskId: describeWire(
    TASK_REF_INPUT,
    `The task to read, by the id ${AGENT_TOOL.LIST_TASKS} answered or by its key, such as ` +
      "ACME-42, whose prefix must be its workspace's.",
  ),
});

const readTaskAsked = Schema.decodeUnknownResult(READ_TASK_INPUT);

/** What `read_task` answers beyond the task's own fields, as a workspace with Task descriptions on or off words it. */
const READ_TASK_DESCRIPTION_WORDS = {
  on:
    ", " +
    `and its description as last saved, cut on a line at ${DESCRIPTION_TEXT_READ_CHARS} characters with how many were ` +
    "left out.",
  off: ".",
} as const;

/** `read_task` in the words of the workspace's experiments: its name, its words, and its input schema. */
export function readTaskToolOf(on: Pick<ExperimentsOn, "descriptionsOn">) {
  return {
    name: AGENT_TOOL.READ_TASK,
    description:
      "Read one task of your workspace by its id or its key, a teammate's included: its " +
      "key, name, status, priority, repository, who started it (startedBy, and startedByUserId to " +
      "link them by), whether it is the task you work on, the brief the developer started it with, " +
      "the tasks it is blocked by and the tasks it blocks, its followers" +
      `${READ_TASK_DESCRIPTION_WORDS[on.descriptionsOn ? "on" : "off"]} Read one before you start an agent on it, or to learn what another task is about.`,
    inputSchema: READ_TASK_INPUT,
  } as const;
}

export const READ_TASK_TOOL = readTaskToolOf(EVERY_EXPERIMENT_ON);

/** Whether the caller reaches tasks' descriptions: as the coding agent's standing read its workspace's Task descriptions, or as the workspace the member's call is about has them (`experimentOnIn`). */
function callerDescriptionsOn(caller: AgentCall["caller"]) {
  return caller.kind === AGENT_CALLER.AGENT
    ? Effect.succeed(caller.descriptionsOn)
    : experimentOnIn(caller.workspaceId, EXPERIMENT.DESCRIPTIONS);
}

/** The refusal a task ref that found nothing reads as. */
function readTaskMissRefusal(miss: TaskRefMiss): WireRecord {
  return agentToolRejected(
    Match.value(miss).pipe(
      Match.discriminatorsExhaustive("kind")({
        [TASK_REF_MISS.UNREADABLE]: () => READ_TASK_REFUSAL.UNREADABLE,
        [TASK_REF_MISS.NO_TASK]: () => READ_TASK_REFUSAL.NO_TASK,
        [TASK_REF_MISS.OTHER_PREFIX]: readTaskOtherPrefixRefusal,
      }),
    ),
  );
}

/** One call of `read_task`: a task of the caller's workspace, its description cut to the bound, or why there is none; no description where the caller has Task descriptions off. */
export function runReadTask(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const asked = readTaskAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(READ_TASK_REFUSAL.UNREADABLE));
  }

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);

      if (Option.isNone(workspace)) {
        return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }

      const userId = callerUserId(call.caller);

      // A key names its number in the caller's workspace, and only under that workspace's prefix.
      const taskId = yield* taskIdOfRef(userId, workspace.value, asked.success.taskId);

      if (Result.isFailure(taskId)) return readTaskMissRefusal(taskId.failure);

      const stored = yield* readTask(userId, taskId.success);

      // A task of another workspace, even one the member is also in, is none of the caller's.
      if (Option.isNone(stored) || stored.value.task.workspaceId !== workspace.value) {
        return agentToolRejected(READ_TASK_REFUSAL.NO_TASK);
      }

      const { task, text, saved, brief } = stored.value;
      const { step, name } = yield* workspaceNamingOf(userId, workspace.value);
      const description = cutOnLine(text, DESCRIPTION_TEXT_READ_CHARS);
      const descriptionsOn = yield* callerDescriptionsOn(call.caller);
      const blocks = yield* taskBlockReadings(userId, task);

      const followers = yield* followerReadingsOf(userId, [task.id]);

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        task: {
          id: task.id,
          ...taskStandingOf(task, { step, name }),
          name: task.name,
          repository: task.repository ?? null,
          startedBy: task.createdBy?.name ?? null,
          startedByUserId: task.createdBy?.userId ?? null,
          isYourTask: task.id === callerTask(call.caller),
          brief: brief ?? null,
          ...blocks,
          followers: (followers.get(task.id) ?? []).map((follower) => ({ ...follower })),
        },
        ...(descriptionsOn
          ? {
              description: {
                text: description.text,
                saved,
                leftOutChars: description.leftOutChars,
              },
            }
          : undefined),
      };
    }),
  );
}

/** Why a make made nothing, in words the model can act on. */
export const CREATE_TASK_REFUSAL = {
  UNREADABLE:
    `Not made: give a name of at most ${TASK_BOUNDS.MAX_NAME_CHARS} characters, a repository as ` +
    `owner/name or null for none, a brief of at most ` +
    `${TASK_BOUNDS.MAX_BRIEF_CHARS} characters or none, a description of at most ` +
    `${TASK_BOUNDS.MAX_BODY_CHARS} characters or none, a status ` +
    `(${Object.values(TASK_STATUS).join(", ")}), a priority ` +
    `(${Object.values(TASK_PRIORITY).join(", ")}) or none, an assignee as a member's ` +
    `mention link or none, a parent task by the id ${AGENT_TOOL.LIST_TASKS} answered or its key, ` +
    "or none, and subTaskIds, blockedBy, and blocks as lists of such ids or keys, or none.",
  NO_REPOSITORY:
    "Not made: repository is required for a task with no parentTaskId or subTaskIds; give the " +
    "repository its agents work in as owner/name, or null for none.",
  NO_STATUS:
    "Not made: status is required; give where the task stands, one of " +
    `${Object.values(TASK_STATUS).join(", ")}, such as ${TASK_STATUS.TODO} for work to start ` +
    `or ${TASK_STATUS.BACKLOG} for work filed for later.`,
  NOT_MEMBER:
    "Not made: that assignee is no member of the workspace, or names no person; name a member by " +
    `the mention link ${AGENT_TOOL.LIST_TASKS} hands you, or leave it out for no one.`,
  NO_PARENT: `Not made: no task of your workspace has that id to be its parent; ${AGENT_TOOL.LIST_TASKS} names them.`,
  PARENT_REPOSITORY:
    "Not made: a child task always works in its parent's repository; leave repository out to " +
    "take the parent's, or make it with no parent to work in another.",
  NO_RELATED:
    "Not made: a task named in subTaskIds, blockedBy, or blocks is no task of your workspace, so " +
    `it is none you can join to this one; ${AGENT_TOOL.LIST_TASKS} names them.`,
  CHILD_REPOSITORY:
    "Not made: a task always works in its sub-tasks' repository; leave repository out to take " +
    "theirs, and name in subTaskIds only tasks that work in one repository.",
  PARENT_HELD:
    "Not made: a task named in subTaskIds has a parent already, which a new task never takes " +
    "the place of; give that parent as parentTaskId to make the new task its sibling, or leave " +
    "that task out.",
  RELATION_CYCLE:
    "Not made: that would close a cycle, since a task it would block already blocks a blocker, " +
    "or a task named in subTaskIds stands above its parent, directly or through other tasks; " +
    "take away the relation that runs the other way first.",
  // Note that the field was `plan` before the task's document was its description, and an agent whose session listed the tool then may still send it, which the schema would otherwise drop and make the task empty.
  RENAMED_DESCRIPTION:
    "Not made: the task's starting text is now named description, not plan; call again with the " +
    "same text as description.",
  // Note that one relation was the field before the tree and the blocks were lists of their own, and an agent whose session listed the tool then may still send it, which the schema would otherwise drop and make the task unrelated.
  RENAMED_RELATION:
    "Not made: create_task takes no relation now; name the other task in parentTaskId for " +
    `${TASK_CREATE_RELATION_KIND.SUB_TASK_OF}, subTaskIds for ${TASK_CREATE_RELATION_KIND.PARENT_OF}, ` +
    `blockedBy for ${TASK_CREATE_RELATION_KIND.BLOCKED_BY}, or blocks for ` +
    `${TASK_CREATE_RELATION_KIND.BLOCKS}, and call again.`,
} as const;

/** `create_task`'s fields before its description, which every workspace offers. */
const CREATE_TASK_FIELDS_BEFORE = {
  name: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(TASK_BOUNDS.MAX_NAME_CHARS)),
    "The task's name, as the developer would name it in the sidebar.",
  ),
  repository: Schema.optionalKey(
    describeWire(
      Schema.NullOr(githubRepositoryFullNameSchema),
      "The GitHub repository its agents work in, as owner/name, which the workspace's GitHub " +
        "installation must reach, or null for none; required, but left out where you give a " +
        "parentTaskId or subTaskIds, whose repository it takes.",
    ),
  ),
  brief: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isMaxLength(TASK_BOUNDS.MAX_BRIEF_CHARS)),
      `The developer's own words about the task, which ${PRODUCT_NAME} is handed when they open a call on ` +
        "it; their words where they gave them, left out otherwise.",
    ),
  ),
};

/** `create_task`'s fields after its description, which every workspace offers. */
const CREATE_TASK_FIELDS_AFTER = {
  status: describeWire(
    taskStatusSchema,
    "Where the task stands: todo for work to start, backlog for work filed for later.",
  ),
  priority: Schema.optionalKey(describeWire(taskPrioritySchema, TASK_PRIORITY_WORDS)),
  assignee: Schema.optionalKey(TASK_ASSIGNEE_INPUT),
  parentTaskId: Schema.optionalKey(
    describeWire(
      TASK_REF_INPUT,
      `The task to make it a child of, by ${TASK_REF_WORDS}: a task of ` +
        "your workspace, whose repository it works in. Left out, it stands at the top.",
    ),
  ),
  subTaskIds: Schema.optionalKey(
    describeWire(
      TASK_IDS,
      `Its sub-tasks (the tasks it is the parent of), each by ${TASK_REF_WORDS}, ` +
        "each a task of your workspace with no parent yet, working in one repository " +
        "with it, which it takes, so leave repository out. Left out, it has none.",
    ),
  ),
  blockedBy: Schema.optionalKey(
    describeWire(
      TASK_IDS,
      `Its blocked-by (the tasks it waits on), each by ${TASK_REF_WORDS}, ` +
        "each a task of your workspace, such as a sibling whose work comes first. Left out, it " +
        "waits on none.",
    ),
  ),
  blocks: Schema.optionalKey(
    describeWire(
      TASK_IDS,
      `Its blocks (the tasks that wait on it), each by ${TASK_REF_WORDS}, each ` +
        "a task of your workspace. Left out, none waits on it.",
    ),
  ),
};

/** `create_task`'s starting description, offered only where the workspace has Task descriptions on. */
const CREATE_TASK_DESCRIPTION_FIELD = {
  description: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isMaxLength(TASK_BOUNDS.MAX_BODY_CHARS)),
      "The description's body to start it with, as Markdown under its sections' ## headings, without " +
        "the # title, which the task's name is; an agent started on it with no prompt is handed " +
        "it. Left out, it starts empty.",
    ),
  ),
};

/** `create_task`'s input in the words of the workspace's experiments: its description where it has Task descriptions on. */
function createTaskInputOf(on: Pick<ExperimentsOn, "descriptionsOn">) {
  return Schema.Struct({
    ...CREATE_TASK_FIELDS_BEFORE,
    ...(on.descriptionsOn && CREATE_TASK_DESCRIPTION_FIELD),
    ...CREATE_TASK_FIELDS_AFTER,
  });
}

const CREATE_TASK_INPUT = Schema.Struct({
  ...CREATE_TASK_FIELDS_BEFORE,
  ...CREATE_TASK_DESCRIPTION_FIELD,
  ...CREATE_TASK_FIELDS_AFTER,
});

const readCreateAsked = Schema.decodeUnknownResult(CREATE_TASK_INPUT);

/** A make that names the starting text by the field's name before the rename. */
const namesRetiredPlan = Schema.is(Schema.Struct({ plan: Schema.Unknown }));

/** A make that names one relation, as the tool took before the tree and the blocks were lists of their own. */
const namesRetiredRelation = Schema.is(Schema.Struct({ relation: Schema.Unknown }));

/** A make that names a status, which every make must. */
const namesStatus = Schema.is(Schema.Struct({ status: Schema.Unknown }));

/** What a made task starts with, as a workspace with Task descriptions on or off words it. */
const CREATE_TASK_STARTS_WITH = {
  on: "with their brief and a description to start from where given",
  off: "with their brief where given",
} as const;

/** `create_task` in the words of the workspace's experiments: its name, its words, and its input schema. */
export function createTaskToolOf(on: Pick<ExperimentsOn, "descriptionsOn">) {
  return {
    name: AGENT_TOOL.CREATE_TASK,
    description: createTaskWords(on),
    inputSchema: createTaskInputOf(on),
  } as const;
}

function createTaskWords(on: Pick<ExperimentsOn, "descriptionsOn">): string {
  return (
    "Make a task in your workspace for the developer you work for, as the sidebar's New task " +
    "would: owned by them, on the repository named, " +
    `${CREATE_TASK_STARTS_WITH[on.descriptionsOn ? "on" : "off"]}, and no agent on it, for work that ` +
    "should stand as a task of its own where the developer asked for one; " +
    `start an agent on it with ${AGENT_TOOL.START_AGENT}'s taskId. ` +
    "Give it a status, a priority, and an assignee where the developer said them. Its parent, " +
    "sub-tasks, and blocks are all written in the same call: a child always works in its parent's " +
    "repository, and a child that waits on a sibling takes a parentTaskId and a blockedBy."
  );
}

export const CREATE_TASK_TOOL = {
  name: AGENT_TOOL.CREATE_TASK,
  description: createTaskWords(EVERY_EXPERIMENT_ON),
  inputSchema: CREATE_TASK_INPUT,
} as const;

/** A # title at a description's head, as Markdown spells one: at most three spaces in, and a space, a tab, or the line's end after the #, so `#define` or a code line is no title. */
const TITLE_HEADING = /^(?:[ \t]*\r?\n)*[ ]{0,3}#(?:[ \t][^\r\n]*)?\r?(?:\n|$)/u;

/** A description's body as a task keeps it: without a # title at its head, which the task's name is, and its ends trimmed. */
function descriptionTextOf(description: string): string {
  return description.replace(TITLE_HEADING, "").trim();
}

/** Who a task's first description is written by, as its history names them: the calling coding agent, or the member calling, as the developer. */
function revisionWriterOf(call: AgentCall): NonNullable<TaskCreateAsked["writer"]> {
  const agent = callerAgent(call.caller);

  return agent === undefined
    ? { actor: DESCRIPTION_ACTOR.DEVELOPER }
    : { actor: DESCRIPTION_ACTOR.AGENT, agentId: agent.id };
}

/** The relations a make asks, from the new task's side: the parent of each sub-task, then each block on either side. */
function relationsOf(asked: {
  readonly subTaskIds?: readonly string[];
  readonly blockedBy?: readonly string[];
  readonly blocks?: readonly string[];
}): readonly TaskCreateRelation[] {
  const sideOf = (ids: readonly string[] | undefined, kind: TaskCreateRelation["kind"]) =>
    (ids ?? []).map((taskId) => ({ kind, taskId }));

  return [
    ...sideOf(asked.subTaskIds, TASK_CREATE_RELATION_KIND.PARENT_OF),
    ...sideOf(asked.blockedBy, TASK_CREATE_RELATION_KIND.BLOCKED_BY),
    ...sideOf(asked.blocks, TASK_CREATE_RELATION_KIND.BLOCKS),
  ];
}

/** The tasks a make names, as their fields carry them. */
interface CreatedTasks {
  readonly parentTaskId?: string;
  readonly subTaskIds?: readonly string[];
  readonly blockedBy?: readonly string[];
  readonly blocks?: readonly string[];
}

/** The lists of tasks a make names, by their fields. */
const CREATED_TASK_LISTS = ["subTaskIds", "blockedBy", "blocks"] as const;

/** The tasks a make names, each by id or key read as its id in the workspace; or the refusal naming its field. */
const createdTasksById = (userId: string, workspaceId: string, asked: CreatedTasks) =>
  Effect.gen(function* () {
    const parent =
      asked.parentTaskId === undefined
        ? Result.succeed(undefined)
        : yield* taskIdOfInput(
            userId,
            workspaceId,
            { opening: "Not made", field: "parentTaskId" },
            asked.parentTaskId,
          );

    if (Result.isFailure(parent)) return Result.fail(parent.failure);
    const byId: { -readonly [K in keyof CreatedTasks]: CreatedTasks[K] } = {};

    if (parent.success !== undefined) byId.parentTaskId = parent.success;

    for (const field of CREATED_TASK_LISTS) {
      const written = asked[field];

      if (written === undefined) continue;

      const ids = yield* taskIdsOfInput(
        userId,
        workspaceId,
        { opening: "Not made", field },
        written,
      );

      if (Result.isFailure(ids)) return Result.fail(ids.failure);
      byId[field] = ids.success;
    }

    return Result.succeed(byId);
  });

/** Who made a task for the caller's member: the coding agent by its id; none for the member calling, as for one they make by hand. */
function originOf(call: AgentCall): { readonly origin?: TaskOrigin } {
  const agent = callerAgent(call.caller);

  return agent === undefined
    ? {}
    : { origin: { actor: DESCRIPTION_ACTOR.AGENT, agentId: agent.id } };
}

/**
 * Who a made task is started for: a Manager's, for the member who asked for
 * the turn under way (`turnAsker`), its owner standing in where no member
 * did, who is its assignee too where the call names none; any other
 * caller's, for the member it acts for, with no assignee but the one named.
 * Note that a Manager is shared across its workspace, so its owner is no one
 * in particular to start, assign, or follow the tasks it makes for others.
 */
function startedFor(
  call: AgentCall,
): Effect.Effect<
  { readonly starter: string; readonly assignee: string | undefined },
  StoreFailure,
  DatabaseServices
> {
  const agent = callerAgent(call.caller);

  if (agent?.kind !== AGENT_KIND.MANAGER) {
    return Effect.succeed({ starter: callerUserId(call.caller), assignee: undefined });
  }

  return Effect.map(
    turnAsker({ userId: agent.userId, conversationId: agent.conversationId }),
    (asker) => ({ starter: asker, assignee: asker }),
  );
}

/**
 * Why the make made nothing (`createTaskAsked`), in words the model can act
 * on; a store failure is left to `orStoreRefusal`. Note that the parent's
 * refusals and a sub-task's share their tags, so they are told apart by
 * whether the call named a parent, which is read before any sub-task.
 */
const madeRefusal =
  (parentNamed: boolean) =>
  (
    failure:
      | HostedRefusal
      | TaskAssigneeNotMember
      | TaskIdTaken
      | TaskCreateRelationRefused
      | StoreFailure,
  ): Effect.Effect<string, StoreFailure> => {
    if (!("_tag" in failure)) return Effect.succeed(repositoryRefusalWords(failure));

    return Match.value(failure).pipe(
      Match.tag("TaskAssigneeNotMember", () => Effect.succeed(CREATE_TASK_REFUSAL.NOT_MEMBER)),
      Match.tag("TaskParentHeld", () => Effect.succeed(CREATE_TASK_REFUSAL.PARENT_HELD)),
      Match.tag("TaskParentRepositoryDiffers", () =>
        Effect.succeed(
          parentNamed
            ? CREATE_TASK_REFUSAL.PARENT_REPOSITORY
            : CREATE_TASK_REFUSAL.CHILD_REPOSITORY,
        ),
      ),
      Match.tag("TaskParentCycle", "TaskBlockCycle", () =>
        Effect.succeed(CREATE_TASK_REFUSAL.RELATION_CYCLE),
      ),
      Match.tag("TaskParentUnreached", () =>
        Effect.succeed(
          parentNamed ? CREATE_TASK_REFUSAL.NO_PARENT : CREATE_TASK_REFUSAL.NO_RELATED,
        ),
      ),
      // The other task gone out of reach since it was read, and the store's own holds, read as none to relate to.
      Match.tag("TaskRelationUnreached", "TaskBlockSelf", "TaskBlockAcrossWorkspaces", () =>
        Effect.succeed(CREATE_TASK_REFUSAL.NO_RELATED),
      ),
      // The id is drawn from the member's own key, so a task another holds under it is the store breaking.
      Match.tag("TaskIdTaken", () => Effect.succeed(AGENT_TOOL_REFUSAL.STORE)),
      Match.orElse((store): Effect.Effect<string, StoreFailure> => Effect.fail(store)),
    );
  };

/** A made task as `create_task` answers it. */
function createdAnswer(
  made: Pick<
    TaskSummary,
    "id" | "name" | "repository" | "number" | "status" | "priority" | "assignee"
  >,
  naming: { readonly step: string; readonly name: string },
) {
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    task: {
      id: made.id,
      ...taskStandingOf(made, naming),
      name: made.name,
      repository: made.repository ?? null,
    },
  };
}

/** One call of `create_task`: a task made in the caller's workspace for its member, once under the call's key. */
export function runCreateTask(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  if (namesRetiredPlan(input)) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.RENAMED_DESCRIPTION));
  }

  if (namesRetiredRelation(input)) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.RENAMED_RELATION));
  }

  if (!namesStatus(input)) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.NO_STATUS));
  }

  const asked = readCreateAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.UNREADABLE));
  }

  const { repository } = asked.success;

  // A task in a tree takes the tree's repository, so only a task standing alone must name one.
  const inTree =
    asked.success.parentTaskId !== undefined || (asked.success.subTaskIds ?? []).length > 0;

  if (repository === undefined && !inTree) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.NO_REPOSITORY));
  }

  const { name, brief, description, status, priority, assignee } = asked.success;

  const assigneeId =
    assignee === undefined || assignee === null ? undefined : assigneeIdOf(assignee);

  if (assignee !== undefined && assignee !== null && assigneeId === undefined) {
    return Effect.succeed(agentToolRejected(CREATE_TASK_REFUSAL.NOT_MEMBER));
  }

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);

      if (Option.isNone(workspace)) {
        return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }

      const userId = callerUserId(call.caller);
      const id = calledId(userId, call.clientKey);
      const naming = yield* workspaceNamingOf(userId, workspace.value);

      // The call run again finds the task it made, and makes no second, before the keys it names are read again.
      const before = yield* readTask(userId, id);

      if (Option.isSome(before) && before.value.task.workspaceId === workspace.value) {
        return createdAnswer(before.value.task, naming);
      }

      // The tasks it names, each by its id or a key read in the caller's workspace alone.
      const named = yield* createdTasksById(userId, workspace.value, asked.success);

      if (Result.isFailure(named)) return agentToolRejected(named.failure);
      const { parentTaskId } = named.success;
      const relations = relationsOf(named.success);
      // Note that a description is written only for a caller with Task descriptions on; the schema takes one alike, so the tool's words stay the same.
      const descriptionsOn = yield* callerDescriptionsOn(call.caller);
      const startedAs = yield* startedFor(call);
      // A task named as no one's stays no one's; one naming no assignee takes the starter's default.
      const assigned = assignee === undefined ? startedAs.assignee : assigneeId;

      const made = yield* createTaskAsked(
        startedAs.starter,
        {
          id,
          organizationId: workspace.value,
          name,
          ...(repository === undefined ? undefined : { repository }),
          ...(brief === undefined ? undefined : { brief }),
          status,
          ...(priority === undefined ? undefined : { priority }),
          // Note that a child left without one is no one's, since an agent names who works a task, never the parent.
          assigneeId: assigned ?? null,
          ...(parentTaskId === undefined ? undefined : { parentTaskId }),
          ...originOf(call),
          text: descriptionsOn ? descriptionTextOf(description ?? "") : "",
          writer: revisionWriterOf(call),
          relations,
        },
        SERVER_TASK_SOURCE.AGENT,
      ).pipe(
        Effect.map((created) => created.task.task),
        Effect.catch(madeRefusal(parentTaskId !== undefined)),
      );

      if (Predicate.isString(made)) return agentToolRejected(made);

      return createdAnswer(made, naming);
    }),
  );
}
