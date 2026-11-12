/**
 * task-following.ts -- the members following a task: a member follows it or stops, switches whether its agents may use their machines, or adds another member; a member's message makes them follow; and the followers an agent's task tools read.
 *
 * Every door of following stands over this one module: the hosted
 * `taskFollowers` procedures, the member words path (`steerMemberWords` and a
 * queued message), and `read_task` and `list_tasks`. What a member sees of it
 * is gated on the task's workspace having Following on
 * (`EXPERIMENT.FOLLOWING`): a write while it is off is refused as no task, and
 * a tool answers no followers. The follows a task's start and its assignment
 * write are the store's own (`task-store.ts`), written in their transaction
 * whatever the experiment, as are a member's message's here, so a workspace
 * that turns Following on finds its followers already there.
 *
 * A member follows by hand with their machines off, and by messaging one of
 * the task's agents with them on where they did not follow it yet; a follower
 * keeps their switch otherwise, which only they flip. Mentioning someone,
 * and anything an agent, an automation, GitHub, or a webhook sends, makes no
 * one follow: none of those reaches this module.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  followTask,
  listTasksFollowersNamed,
  setFollowerMachines,
  type TaskFollower,
  type TaskFollowersWritten,
  unfollowTask,
} from "@repo/database/models/task-follower-store";
import { readTaskHeader } from "@repo/database/models/task-store";
import type { TaskFollowersAnswer } from "@repo/features/task-wire";
import { EXPERIMENT } from "@repo/settings";
import type { TaskFollowerWire } from "@repo/wire";
import { Effect, Option, Result } from "effect";
import { experimentOnIn } from "../agents/workspace-experiment-on.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";

/** What a member's follower write answers, refused as the procedures answer it. */
type FollowingEffect = Effect.Effect<TaskFollowersAnswer, HostedRefusal, DatabaseServices>;

/** A follower as an agent's task tools name them. */
export interface TaskFollowerReading {
  readonly name: string;
  readonly userId: string;
  readonly assignee: boolean;
  /** Whether the task's agents may use their machines. */
  readonly machines: boolean;
}

/** One follower as the wire carries them. */
function followerWireOf(follower: TaskFollower): TaskFollowerWire {
  return { userId: follower.userId, assignee: follower.assignee, machines: follower.machines };
}

/** The followers a write left, as the procedures answer them; none written is answered as no task. */
function answerOf(
  taskId: string,
  written: Option.Option<TaskFollowersWritten>,
): Effect.Effect<TaskFollowersAnswer, HostedRefusal> {
  if (Option.isNone(written)) return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { followers, txid } = written.value;
  const answer = { taskId, followers: followers.map(followerWireOf) };

  return Effect.succeed(txid === undefined ? answer : { ...answer, txid });
}

/** Refused as no task unless the account reaches the task and its workspace has Following on. */
const followingOnFor = Effect.fnUntraced(function* (userId: string, taskId: string) {
  const header = yield* hostedStoreOrUnavailable(readTaskHeader(userId, taskId));

  if (Option.isNone(header)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  if (!(yield* experimentOnIn(header.value.workspaceId, EXPERIMENT.FOLLOWING))) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
});

/** The account follows the task by hand, its machines off; one following already keeps its row. */
export function followTaskAsked(userId: string, taskId: string): FollowingEffect {
  return Effect.gen(function* () {
    yield* followingOnFor(userId, taskId);
    const written = yield* hostedStoreOrUnavailable(
      followTask(userId, { taskId, followerId: userId, machines: false }),
    );

    return yield* answerOf(taskId, written);
  });
}

/** Another member of the task's workspace added as a follower, as the mention dock row's Add asks, their machines off; one following already keeps their row. */
export function addTaskFollowerAsked(
  userId: string,
  taskId: string,
  followerId: string,
): FollowingEffect {
  return Effect.gen(function* () {
    yield* followingOnFor(userId, taskId);
    const written = yield* hostedStoreOrUnavailable(
      followTask(userId, { taskId, followerId, machines: false }),
    );

    return yield* answerOf(taskId, written);
  });
}

/** The account stops following the task; its assignee is refused as not permitted, since they follow it while assigned. */
export function unfollowTaskAsked(userId: string, taskId: string): FollowingEffect {
  return Effect.gen(function* () {
    yield* followingOnFor(userId, taskId);

    const unfollowed = yield* hostedStoreOrUnavailable(
      unfollowTask(userId, taskId).pipe(
        Effect.map((written) => Result.succeed(written)),
        Effect.catchTag("TaskFollowerIsAssignee", (refused) =>
          Effect.succeed(Result.fail(refused)),
        ),
      ),
    );

    if (Result.isFailure(unfollowed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);

    return yield* answerOf(taskId, unfollowed.success);
  });
}

/** The account's own switch: whether the task's agents may use its machines; one not following the task answers as no task. */
export function setFollowerMachinesAsked(
  userId: string,
  taskId: string,
  machines: boolean,
): FollowingEffect {
  return Effect.gen(function* () {
    yield* followingOnFor(userId, taskId);
    const written = yield* hostedStoreOrUnavailable(setFollowerMachines(userId, taskId, machines));

    return yield* answerOf(taskId, written);
  });
}

/**
 * A member's own words to one of the task's agents make them follow it, with
 * their machines on, where they did not follow it yet; a follower's row
 * stands as it is. Whatever the experiment, so the followers are there
 * once it is on. It never fails the message it follows: a write the store
 * could not make is logged for the operator and the message goes on.
 */
export function followAsMessaged(
  userId: string,
  taskId: string,
): Effect.Effect<void, never, DatabaseServices> {
  return followTask(userId, { taskId, followerId: userId, machines: true }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => Option.none()),
    Effect.asVoid,
  );
}

/**
 * The followers of each of the tasks named, as `read_task` and `list_tasks`
 * name them, keyed by the task's id, each by name and id, as every tool
 * names a member; none where the workspace has Following off, when the
 * tools answer no followers.
 */
export function followerReadingsOf(
  userId: string,
  workspaceId: string,
  taskIds: readonly string[],
): Effect.Effect<
  ReadonlyMap<string, readonly TaskFollowerReading[]> | undefined,
  StoreFailure,
  DatabaseServices
> {
  return Effect.gen(function* () {
    if (!(yield* experimentOnIn(workspaceId, EXPERIMENT.FOLLOWING))) return undefined;
    const named = yield* listTasksFollowersNamed(userId, taskIds);

    return new Map(
      [...named].map(([taskId, followers]) => [
        taskId,
        followers.map((follower) => ({
          name: follower.name,
          userId: follower.userId,
          assignee: follower.assignee,
          machines: follower.machines,
        })),
      ]),
    );
  });
}
