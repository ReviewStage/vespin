import { and, asc, eq, exists, inArray, sql } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { CURRENT_TXID, TxidRowSchema } from "../core/txid.js";
import { member, user } from "../schemas/auth.js";
import { task } from "../schemas/task.js";
import { taskFollower, taskUnfollow } from "../schemas/task-follower.js";
import { InstantColumnSchema } from "./columns.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * task-follower-store.ts -- the members following a task, and the tasks a member follows, read and written for the account that asks, and the follows a task's start and assignment write.
 *
 * Every statement a member's own call runs names the account it runs for
 * and gates on its reach of the task (`taskReachableBy`), so a task the
 * account does not reach reads as no task, its followers among it. A
 * follower is a member of the task's workspace: one who left reads as no
 * follower, and a member of no other workspace is ever added. Any member who
 * reaches the task may add another member as a follower, as an assignment
 * or a mention does, but `machines`, whether the task's agents may use a
 * follower's machines, is switched by that follower alone, and a member
 * unfollows for themself alone, the task's assignee never while assigned.
 * Following again keeps the row as it stands, its switch among it, but for
 * an assignment, which turns the new assignee's switch on and the previous
 * assignee's off. An unfollow is kept beside the rows (`taskUnfollow`), so a
 * member's message after it makes them follow with their switch off. Each write answers the task's followers as they then
 * stand and the transaction it committed in, none where it changed no row.
 * Every function is an effect over the ambient `SqlClient` and names no
 * database of its own.
 */

/** What a follower store operation answers: an effect over the ambient client, failing as every store does. */
export type TaskFollowerEffect<A, E = never> = Effect.Effect<A, StoreFailure | E, DatabaseServices>;

/** The task's assignee asked to unfollow it, which they follow while assigned; nothing was written. */
export class TaskFollowerIsAssignee extends Data.TaggedError("TaskFollowerIsAssignee") {}

/** One member following a task, as the task's readers read them. */
export interface TaskFollower {
  readonly userId: string;
  /** Whether they are the task's assignee. */
  readonly assignee: boolean;
  /** Whether the task's agents may use this member's machines. */
  readonly machines: boolean;
  /** When they began following, in milliseconds since the epoch. */
  readonly followedAt: number;
}

/** A follower as an agent's tool names them: by the name their account holds now beside their id. */
export interface NamedTaskFollower extends TaskFollower {
  readonly name: string;
}

/** A task's followers as a write left them, and the transaction it committed in; none where it changed no row. */
export interface TaskFollowersWritten {
  readonly followers: readonly TaskFollower[];
  readonly txid?: string;
}

const KeySchema = Schema.Struct({ taskId: Schema.String, userId: Schema.String });

const FollowerRowSchema = Schema.Struct({
  userId: Schema.String,
  assignee: Schema.Boolean,
  machines: Schema.Boolean,
  followedAt: InstantColumnSchema,
});

const IdRowSchema = Schema.Struct({ id: Schema.String });

const ReachedRowSchema = Schema.Struct({
  id: Schema.String,
  assigneeId: Schema.NullOr(Schema.String),
});

/** The condition that the member a statement names is a member of the workspace of the task it reads. */
function memberOfTaskWorkspace(userId: string | typeof taskFollower.userId) {
  return exists(
    queryBuilder
      .select({ one: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, task.organizationId))),
  );
}

/** The task under this id and its assignee, where the account reaches it; any other id reads as no task. */
const findReachableTask = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: ReachedRowSchema,
  execute: ({ taskId, userId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id, assigneeId: task.assigneeId })
        .from(task)
        .where(reachableTask(userId, taskId))
        .limit(1),
    ),
});

/**
 * The task under this id and its assignee, where the account reaches it,
 * its row held for update, so an assignment under way commits first and an
 * unfollow reads the assignee it left.
 */
const lockReachableTask = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: ReachedRowSchema,
  execute: ({ taskId, userId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id, assigneeId: task.assigneeId })
        .from(task)
        .where(reachableTask(userId, taskId))
        .limit(1)
        .for("update"),
    ),
});

/** The task under this id, where the account reaches it and the follower is a member of its workspace. */
const findFollowableTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...KeySchema.fields, followerId: Schema.String }),
  Result: IdRowSchema,
  execute: ({ taskId, userId, followerId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(task)
        .where(and(reachableTask(userId, taskId), memberOfTaskWorkspace(followerId)))
        .limit(1),
    ),
});

/** The task's followers who are members of its workspace, the earliest to follow first. */
const findFollowers = SqlSchema.findAll({
  Request: Schema.String,
  Result: FollowerRowSchema,
  execute: (taskId) =>
    Database.use((db) =>
      db
        .select({
          userId: taskFollower.userId,
          assignee: sql<boolean>`coalesce(${task.assigneeId} = ${taskFollower.userId}, false)`,
          machines: taskFollower.machines,
          followedAt: taskFollower.createdAt,
        })
        .from(taskFollower)
        .innerJoin(task, eq(task.id, taskFollower.taskId))
        .where(and(eq(taskFollower.taskId, taskId), memberOfTaskWorkspace(taskFollower.userId)))
        .orderBy(asc(taskFollower.createdAt), asc(taskFollower.userId)),
    ),
});

/** The followers of the tasks named that the account reaches, each with their name, who are members of the task's workspace, the earliest to follow each first. */
const findNamedFollowers = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    ...FollowerRowSchema.fields,
    taskId: Schema.String,
    name: Schema.String,
  }),
  execute: ({ userId, taskIds }) =>
    Database.use((db) =>
      db
        .select({
          taskId: taskFollower.taskId,
          userId: taskFollower.userId,
          name: user.name,
          assignee: sql<boolean>`coalesce(${task.assigneeId} = ${taskFollower.userId}, false)`,
          machines: taskFollower.machines,
          followedAt: taskFollower.createdAt,
        })
        .from(taskFollower)
        .innerJoin(task, eq(task.id, taskFollower.taskId))
        .innerJoin(user, eq(user.id, taskFollower.userId))
        .where(
          and(
            inArray(taskFollower.taskId, [...taskIds]),
            taskReachableBy(userId),
            memberOfTaskWorkspace(taskFollower.userId),
          ),
        )
        .orderBy(asc(taskFollower.createdAt), asc(taskFollower.userId)),
    ),
});

/** The tasks of the workspace the account follows and reaches, the earliest followed first. */
const findFollowedTasks = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: IdRowSchema,
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ id: taskFollower.taskId })
        .from(taskFollower)
        .innerJoin(task, eq(task.id, taskFollower.taskId))
        .where(
          and(
            eq(taskFollower.userId, userId),
            eq(task.organizationId, organizationId),
            taskReachableBy(userId),
          ),
        )
        .orderBy(asc(taskFollower.createdAt), asc(taskFollower.taskId)),
    ),
});

/** A follower's row written where none stands, and the transaction it was written in; nothing where one stands, which keeps its switch. */
const insertFollower = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...KeySchema.fields, machines: Schema.Boolean, now: Schema.Date }),
  Result: TxidRowSchema,
  execute: ({ taskId, userId, machines, now }) =>
    Database.use((db) =>
      db
        .insert(taskFollower)
        .values({ taskId, userId, machines, createdAt: now })
        .onConflictDoNothing()
        .returning({ txid: CURRENT_TXID }),
    ),
});

/** Whether the member ever unfollowed the task. */
const findUnfollow = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: Schema.Struct({ unfollowedAt: InstantColumnSchema }),
  execute: ({ taskId, userId }) =>
    Database.use((db) =>
      db
        .select({ unfollowedAt: taskUnfollow.unfollowedAt })
        .from(taskUnfollow)
        .where(and(eq(taskUnfollow.taskId, taskId), eq(taskUnfollow.userId, userId)))
        .limit(1),
    ),
});

/** The member's unfollow of the task kept at `now`, an earlier one moved on to it. */
const upsertUnfollow = SqlSchema.void({
  Request: Schema.Struct({ ...KeySchema.fields, now: Schema.Date }),
  execute: ({ taskId, userId, now }) =>
    Database.use((db) =>
      db
        .insert(taskUnfollow)
        .values({ taskId, userId, unfollowedAt: now })
        .onConflictDoUpdate({
          target: [taskUnfollow.taskId, taskUnfollow.userId],
          set: { unfollowedAt: now },
        }),
    ),
});

/** A follower's row written with its switch on, an existing row's switch turned on, as an assignment does. */
const upsertFollowerMachinesOn = SqlSchema.void({
  Request: Schema.Struct({ ...KeySchema.fields, now: Schema.Date }),
  execute: ({ taskId, userId, now }) =>
    Database.use((db) =>
      db
        .insert(taskFollower)
        .values({ taskId, userId, machines: true, createdAt: now })
        .onConflictDoUpdate({
          target: [taskFollower.taskId, taskFollower.userId],
          set: { machines: true },
        }),
    ),
});

/** A follower's switch set as asked, and the transaction it was written in; nothing where they do not follow the task or the switch stood so. */
const updateMachines = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...KeySchema.fields, machines: Schema.Boolean }),
  Result: TxidRowSchema,
  execute: ({ taskId, userId, machines }) =>
    Database.use((db) =>
      db
        .update(taskFollower)
        .set({ machines })
        .where(
          and(
            eq(taskFollower.taskId, taskId),
            eq(taskFollower.userId, userId),
            sql`${taskFollower.machines} is distinct from ${machines}`,
          ),
        )
        .returning({ txid: CURRENT_TXID }),
    ),
});

/** The follower's row taken away, and the transaction it went in; nothing where they did not follow the task. */
const deleteFollower = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: TxidRowSchema,
  execute: ({ taskId, userId }) =>
    Database.use((db) =>
      db
        .delete(taskFollower)
        .where(and(eq(taskFollower.taskId, taskId), eq(taskFollower.userId, userId)))
        .returning({ txid: CURRENT_TXID }),
    ),
});

/** A follower row as its readers read it. */
function followerOf(row: typeof FollowerRowSchema.Type): TaskFollower {
  return {
    userId: row.userId,
    assignee: row.assignee,
    machines: row.machines,
    followedAt: row.followedAt.getTime(),
  };
}

/** The task's followers as they stand after a write, with the transaction it committed in, none where it changed nothing. */
function writtenOf(
  taskId: string,
  written: Option.Option<{ readonly txid: string }>,
): TaskFollowerEffect<TaskFollowersWritten> {
  return Effect.map(findFollowers(taskId), (rows) => {
    const followers = rows.map(followerOf);

    return Option.match(written, {
      onNone: () => ({ followers }),
      onSome: ({ txid }) => ({ followers, txid }),
    });
  });
}

/** The effect run in one transaction of the ambient client. */
function transaction<A, E>(
  effect: Effect.Effect<A, E, DatabaseServices>,
): Effect.Effect<A, E | StoreFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(effect));
}

/**
 * The task's followers, as the account reads them, the earliest to follow
 * first; nothing where the account does not reach the task.
 */
export function listTaskFollowers(
  userId: string,
  taskId: string,
): TaskFollowerEffect<Option.Option<readonly TaskFollower[]>> {
  return Effect.gen(function* () {
    if (Option.isNone(yield* findReachableTask({ taskId, userId }))) return Option.none();

    return Option.some((yield* findFollowers(taskId)).map(followerOf));
  });
}

/**
 * The followers of each of the tasks named that the account reaches, each
 * by the name their account holds now, the earliest to follow first, keyed
 * by the task's id; a task it reaches none of is absent, and one no one
 * follows reads as none.
 */
export function listTasksFollowersNamed(
  userId: string,
  taskIds: readonly string[],
): TaskFollowerEffect<ReadonlyMap<string, readonly NamedTaskFollower[]>> {
  if (taskIds.length === 0) return Effect.succeed(new Map());

  return Effect.map(findNamedFollowers({ userId, taskIds }), (rows) => {
    const followers = new Map<string, NamedTaskFollower[]>();

    for (const row of rows) {
      const named = { ...followerOf(row), name: row.name };
      followers.set(row.taskId, [...(followers.get(row.taskId) ?? []), named]);
    }

    return followers;
  });
}

/** The tasks of the workspace the account follows, by id, each one it reaches, the earliest followed first. */
export function listFollowedTasks(
  userId: string,
  organizationId: string,
): TaskFollowerEffect<readonly string[]> {
  return Effect.map(findFollowedTasks({ userId, organizationId }), (rows) =>
    rows.map((row) => row.id),
  );
}

/**
 * Makes the follower follow the task, with machines as asked, and answers
 * the task's followers as they then stand. A follower already following
 * keeps their row as it was, their switch among it. Nothing where the
 * account does not reach the task, or the follower is no member of its
 * workspace.
 */
export function followTask(
  userId: string,
  write: { readonly taskId: string; readonly followerId: string; readonly machines: boolean },
): TaskFollowerEffect<Option.Option<TaskFollowersWritten>> {
  const { taskId, followerId, machines } = write;

  return transaction(
    Effect.gen(function* () {
      const followable = yield* findFollowableTask({ taskId, userId, followerId });

      if (Option.isNone(followable)) return Option.none();
      const now = yield* DateTime.nowAsDate;
      const written = yield* insertFollower({ taskId, userId: followerId, machines, now });

      return Option.some(yield* writtenOf(taskId, written));
    }),
  );
}

/**
 * Makes the account follow the task as its own message to one of the task's
 * agents does, and answers the task's followers as they then stand: with its
 * machines on, but off where it unfollowed the task before, so a message
 * never turns back on what an unfollow turned off. A follower already
 * following keeps their row as it was. Nothing where the account does not
 * reach the task or is no member of its workspace.
 */
export function followTaskAsMessaged(
  userId: string,
  taskId: string,
): TaskFollowerEffect<Option.Option<TaskFollowersWritten>> {
  return transaction(
    Effect.gen(function* () {
      const followable = yield* findFollowableTask({ taskId, userId, followerId: userId });

      if (Option.isNone(followable)) return Option.none();
      const unfollowed = yield* findUnfollow({ taskId, userId });
      const now = yield* DateTime.nowAsDate;

      const written = yield* insertFollower({
        taskId,
        userId,
        machines: Option.isNone(unfollowed),
        now,
      });

      return Option.some(yield* writtenOf(taskId, written));
    }),
  );
}

/**
 * Stops the account following the task, and answers the task's followers
 * as they then stand; one not following stays so. An unfollow is kept
 * (`taskUnfollow`), so its later messages make it follow with its machines
 * off. Nothing where the account does not reach the task; its assignee is
 * refused with `TaskFollowerIsAssignee`, since they follow it while
 * assigned.
 */
export function unfollowTask(
  userId: string,
  taskId: string,
): TaskFollowerEffect<Option.Option<TaskFollowersWritten>, TaskFollowerIsAssignee> {
  return transaction(
    Effect.gen(function* () {
      const reached = yield* lockReachableTask({ taskId, userId });

      if (Option.isNone(reached)) return Option.none();

      if (reached.value.assigneeId === userId) return yield* new TaskFollowerIsAssignee();
      const written = yield* deleteFollower({ taskId, userId });

      if (Option.isSome(written)) {
        yield* upsertUnfollow({ taskId, userId, now: yield* DateTime.nowAsDate });
      }

      return Option.some(yield* writtenOf(taskId, written));
    }),
  );
}

/**
 * Switches whether the task's agents may use the account's own machines,
 * and answers the task's followers as they then stand; nothing where the
 * account does not reach the task or does not follow it.
 */
export function setFollowerMachines(
  userId: string,
  taskId: string,
  machines: boolean,
): TaskFollowerEffect<Option.Option<TaskFollowersWritten>> {
  return transaction(
    Effect.gen(function* () {
      if (Option.isNone(yield* findReachableTask({ taskId, userId }))) return Option.none();
      const written = yield* updateMachines({ taskId, userId, machines });
      const after = yield* writtenOf(taskId, written);

      if (!after.followers.some((follower) => follower.userId === userId)) return Option.none();

      return Option.some(after);
    }),
  );
}

/**
 * The follows a task's start writes, in the transaction that inserts it:
 * its starter follows it, and so does the assignee it starts with, where it
 * names one, each with their machines on. Note that it takes no account to
 * gate on, because the caller wrote the task in the same transaction and
 * admitted its assignee as a member of its workspace; nothing else may call
 * it.
 */
export function followStartedTask(started: {
  readonly taskId: string;
  readonly starterId: string;
  readonly assigneeId: string | null;
}): TaskFollowerEffect<void> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const followers = new Set([started.starterId, started.assigneeId ?? started.starterId]);

    for (const userId of followers) {
      yield* upsertFollowerMachinesOn({ taskId: started.taskId, userId, now });
    }
  });
}

/**
 * The follows an assignment writes, in the transaction that changes the
 * task's assignee: the new assignee follows the task with their machines
 * on, an existing row's switch turned on, and the previous assignee keeps
 * following with theirs turned off. Note that, as `followStartedTask`, it
 * gates on nothing, because the caller holds the task's row under its lock
 * and admitted the new assignee; nothing else may call it.
 */
export function followReassignedTask(assignment: {
  readonly taskId: string;
  readonly assigneeId: string | null;
  readonly previousAssigneeId: string | null;
}): TaskFollowerEffect<void> {
  const { taskId, assigneeId, previousAssigneeId } = assignment;

  return Effect.gen(function* () {
    if (assigneeId === previousAssigneeId) return;

    if (previousAssigneeId !== null) {
      yield* updateMachines({ taskId, userId: previousAssigneeId, machines: false });
    }

    if (assigneeId !== null) {
      yield* upsertFollowerMachinesOn({
        taskId,
        userId: assigneeId,
        now: yield* DateTime.nowAsDate,
      });
    }
  });
}
