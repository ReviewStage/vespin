import { and, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { organization } from "../schemas/auth.js";
import { task, taskNumberForward } from "../schemas/task.js";
import { workspaceIdOfSlug } from "./workspace-slug-store.js";
import {
  isWorkspaceMember,
  taskReachableBy,
  type WorkspaceStoreEffect,
} from "./workspace-store.js";

/**
 * task-number-store.ts -- a task found by its number in a workspace, as a link `/<slug>/task/<number>` names it, and the numbers a task left behind as it moved.
 *
 * A task's number is its workspace's, never handed out again (`task.ts`'s
 * `task_number_counter`), so a workspace and a number name one task for
 * good: the task holding it now, or else the task that held it before it
 * moved to another workspace (`task_number_forward`), written as it moves.
 * Either is answered only to an account that reaches the task where it
 * stands now, and the workspace is found by its slug, current or former
 * (`workspace-slug-store.ts`), or its id, only for a member of it, so a number another account's workspace holds, one
 * naming no task, and a slug naming no workspace of the reader's all
 * answer as nothing. An agent is found the same way, by its task's number and
 * the head of its own id, as a shared preview's host names it.
 */

const TaskNumberSchema = Schema.Struct({
  userId: Schema.String,
  organizationId: Schema.String,
  number: Schema.Number,
});

const TaskIdSchema = Schema.Struct({ id: Schema.String });

/**
 * The workspace a link's step names to the account: by its slug, as the
 * one slug resolver reads it, or else by its id, as a link written before
 * its slug was known spells it; only one it is a member of.
 */
function memberWorkspaceOfStep(
  userId: string,
  step: string,
): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.gen(function* () {
    const bySlug = yield* workspaceIdOfSlug(userId, step);
    if (Option.isSome(bySlug)) return bySlug;
    return (yield* isWorkspaceMember(userId, step)) ? Option.some(step) : Option.none();
  });
}

/** The task holding the number in the workspace now, where the account reaches it. */
const findNumberedTask = SqlSchema.findOneOption({
  Request: TaskNumberSchema,
  Result: TaskIdSchema,
  execute: ({ userId, organizationId, number }) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(task)
        .where(
          and(
            eq(task.organizationId, organizationId),
            eq(task.number, number),
            taskReachableBy(userId),
          ),
        )
        .limit(1),
    ),
});

/** The task that held the number in the workspace before it moved out, where the account reaches it where it stands now. */
const findForwardedTask = SqlSchema.findOneOption({
  Request: TaskNumberSchema,
  Result: TaskIdSchema,
  execute: ({ userId, organizationId, number }) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(taskNumberForward)
        .innerJoin(task, eq(task.id, taskNumberForward.taskId))
        .where(
          and(
            eq(taskNumberForward.organizationId, organizationId),
            eq(taskNumberForward.number, number),
            taskReachableBy(userId),
          ),
        )
        .limit(1),
    ),
});

/** The workspace's slug and the task's number of the agent under this id, where the account reaches its task. */
const findAgentTaskKey = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ slug: Schema.String, number: Schema.Number }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ slug: organization.slug, number: task.number })
        .from(agentTable)
        .innerJoin(task, eq(task.id, agentTable.taskId))
        .innerJoin(organization, eq(organization.id, task.organizationId))
        .where(and(eq(agentTable.id, agentId), taskReachableBy(userId)))
        .limit(1),
    ),
});

/** The ids of the agents on the task. */
const findTaskAgentIds = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (taskId) =>
    Database.use((db) =>
      db.select({ id: agentTable.id }).from(agentTable).where(eq(agentTable.taskId, taskId)),
    ),
});

const insertForward = SqlSchema.void({
  Request: Schema.Struct({
    organizationId: Schema.String,
    number: Schema.Number,
    taskId: Schema.String,
  }),
  execute: (left) =>
    Database.use((db) => db.insert(taskNumberForward).values(left).onConflictDoNothing()),
});

/**
 * The number a task held in the workspace it is moving out of, kept so a
 * link written with it still opens the task; called in the move's own
 * transaction, before or after its row changes.
 */
export function forwardTaskNumber(left: {
  readonly organizationId: string;
  readonly number: number;
  readonly taskId: string;
}): WorkspaceStoreEffect<void> {
  return insertForward(left);
}

/**
 * The id of the task a link's workspace, by slug or id, and number name:
 * the task holding the number in that workspace now, or the one that held
 * it before it moved out; nothing where the account is no member of such a
 * workspace, the number names no task there, or the account does not reach
 * the task where it stands now.
 */
export function taskIdOfNumber(
  userId: string,
  workspaceStep: string,
  number: number,
): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.gen(function* () {
    const workspace = yield* memberWorkspaceOfStep(userId, workspaceStep);
    if (Option.isNone(workspace)) return Option.none();
    const asked = { userId, organizationId: workspace.value, number };
    const held = yield* findNumberedTask(asked);
    const found = Option.isSome(held) ? held : yield* findForwardedTask(asked);
    return Option.map(found, (row) => row.id);
  });
}

/**
 * The workspace slug and task number that name the agent's task in a link,
 * where the account reaches the task; nothing otherwise.
 */
export function taskKeyOfAgent(
  userId: string,
  agentId: string,
): WorkspaceStoreEffect<Option.Option<{ readonly slug: string; readonly number: number }>> {
  return findAgentTaskKey({ userId, agentId });
}

/**
 * The agent on the task a workspace, by slug or id, and number name whose id
 * starts with `idHead`, as `taskIdOfNumber` finds the task; nothing where the
 * account does not reach the task, or where no agent on it, or more than one,
 * has an id with that head.
 */
export function agentIdOfTaskNumber(
  userId: string,
  workspaceStep: string,
  number: number,
  idHead: string,
): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.gen(function* () {
    const taskId = yield* taskIdOfNumber(userId, workspaceStep, number);
    if (Option.isNone(taskId)) return Option.none();
    const head = idHead.toLowerCase();
    const matched = (yield* findTaskAgentIds(taskId.value)).filter((row) =>
      row.id.toLowerCase().startsWith(head),
    );
    const [only] = matched;
    return matched.length === 1 && only !== undefined ? Option.some(only.id) : Option.none();
  });
}
