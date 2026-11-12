import { and, asc, eq, exists } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { member } from "../schemas/auth.js";
import { task } from "../schemas/task.js";
import { taskFollower } from "../schemas/task-follower.js";
import { InstantColumnSchema } from "./columns.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * task-follower-store.ts -- the members following a task, and the tasks a member follows, read and written for the account that asks.
 *
 * Every statement names the account it runs for and gates on its reach of
 * the task (`taskReachableBy`), so a task the account does not reach reads
 * as no task, its followers among it. A follower is a member of the task's
 * workspace: one who left reads as no follower, and a member of no other
 * workspace is ever added. Any member who reaches the task may add another
 * member as a follower, as an assignment or a mention does, but `machines`,
 * whether the task's agents may use a follower's machines, is switched by
 * that follower alone, and a member unfollows for themself alone. Following
 * again keeps the row as it stands, its switch among it. Every function is an
 * effect over the ambient `SqlClient` and names no database of its own.
 */

/** What a follower store operation answers: an effect over the ambient client, failing as every store does. */
export type TaskFollowerEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One member following a task, as the task's readers read them. */
export interface TaskFollower {
  readonly userId: string;
  /** Whether the task's agents may use this member's machines. */
  readonly machines: boolean;
  /** When they began following, in milliseconds since the epoch. */
  readonly followedAt: number;
}

const KeySchema = Schema.Struct({ taskId: Schema.String, userId: Schema.String });

const FollowerRowSchema = Schema.Struct({
  userId: Schema.String,
  machines: Schema.Boolean,
  followedAt: InstantColumnSchema,
});

const IdRowSchema = Schema.Struct({ id: Schema.String });

/** The condition that the member a statement names is a member of the workspace of the task it reads. */
function memberOfTaskWorkspace(userId: string | typeof taskFollower.userId) {
  return exists(
    queryBuilder
      .select({ one: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, task.organizationId))),
  );
}

/** The task under this id, where the account reaches it; any other id reads as no task. */
const findReachableTask = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: IdRowSchema,
  execute: ({ taskId, userId }) =>
    Database.use((db) =>
      db.select({ id: task.id }).from(task).where(reachableTask(userId, taskId)).limit(1),
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
          machines: taskFollower.machines,
          followedAt: taskFollower.createdAt,
        })
        .from(taskFollower)
        .innerJoin(task, eq(task.id, taskFollower.taskId))
        .where(and(eq(taskFollower.taskId, taskId), memberOfTaskWorkspace(taskFollower.userId)))
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

const findFollower = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: FollowerRowSchema,
  execute: ({ taskId, userId }) =>
    Database.use((db) =>
      db
        .select({
          userId: taskFollower.userId,
          machines: taskFollower.machines,
          followedAt: taskFollower.createdAt,
        })
        .from(taskFollower)
        .where(and(eq(taskFollower.taskId, taskId), eq(taskFollower.userId, userId))),
    ),
});

const insertFollower = SqlSchema.void({
  Request: Schema.Struct({ ...KeySchema.fields, machines: Schema.Boolean, now: Schema.Date }),
  execute: ({ taskId, userId, machines, now }) =>
    Database.use((db) =>
      db
        .insert(taskFollower)
        .values({ taskId, userId, machines, createdAt: now })
        .onConflictDoNothing(),
    ),
});

const updateMachines = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...KeySchema.fields, machines: Schema.Boolean }),
  Result: FollowerRowSchema,
  execute: ({ taskId, userId, machines }) =>
    Database.use((db) =>
      db
        .update(taskFollower)
        .set({ machines })
        .where(and(eq(taskFollower.taskId, taskId), eq(taskFollower.userId, userId)))
        .returning({
          userId: taskFollower.userId,
          machines: taskFollower.machines,
          followedAt: taskFollower.createdAt,
        }),
    ),
});

const deleteFollower = SqlSchema.void({
  Request: KeySchema,
  execute: ({ taskId, userId }) =>
    Database.use((db) =>
      db
        .delete(taskFollower)
        .where(and(eq(taskFollower.taskId, taskId), eq(taskFollower.userId, userId))),
    ),
});

/** A follower row as its readers read it. */
function followerOf(row: typeof FollowerRowSchema.Type): TaskFollower {
  return { userId: row.userId, machines: row.machines, followedAt: row.followedAt.getTime() };
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
 * their row as it then stands. A follower already following keeps their row
 * as it was, their switch among it. Nothing where the account does not reach
 * the task, or the follower is no member of its workspace.
 */
export function followTask(
  userId: string,
  write: { readonly taskId: string; readonly followerId: string; readonly machines: boolean },
): TaskFollowerEffect<Option.Option<TaskFollower>> {
  const { taskId, followerId, machines } = write;

  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const followable = yield* findFollowableTask({ taskId, userId, followerId });

        if (Option.isNone(followable)) return Option.none();
        const now = yield* DateTime.nowAsDate;
        yield* insertFollower({ taskId, userId: followerId, machines, now });

        return Option.map(yield* findFollower({ taskId, userId: followerId }), followerOf);
      }),
    ),
  );
}

/**
 * Stops the account following the task; one not following stays so. Answers
 * whether the account reaches the task.
 */
export function unfollowTask(userId: string, taskId: string): TaskFollowerEffect<boolean> {
  return Effect.gen(function* () {
    if (Option.isNone(yield* findReachableTask({ taskId, userId }))) return false;
    yield* deleteFollower({ taskId, userId });

    return true;
  });
}

/**
 * Switches whether the task's agents may use the account's own machines,
 * and answers its row as it then stands; nothing where the account does not
 * reach the task or does not follow it.
 */
export function setFollowerMachines(
  userId: string,
  taskId: string,
  machines: boolean,
): TaskFollowerEffect<Option.Option<TaskFollower>> {
  return Effect.gen(function* () {
    if (Option.isNone(yield* findReachableTask({ taskId, userId }))) return Option.none();

    return Option.map(yield* updateMachines({ taskId, userId, machines }), followerOf);
  });
}
