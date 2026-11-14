import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, leaveWorkspace, openWorkspace } from "../../testing/index.js";
import {
  followTask,
  listFollowedTasks,
  listTaskFollowers,
  setFollowerMachines,
  TaskFollowerIsAssignee,
  unfollowTask,
} from "../task-follower-store.js";
import { createTask, updateTask } from "../task-store.js";

/**
 * The members following a task, read and written through the store's public
 * functions over a real dialect: following again keeps a follower's switch,
 * a member takes another follower away but never the assignee, and a task's
 * followers are read and written only by a member of its
 * workspace, and only ever name its members.
 *
 * Synthetic accounts, workspaces, and tasks throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** Dean's workspace with Charles a member of it and a task Dean started there, and Mallory's workspace beside it. */
const openWorkspaces = Effect.gen(function* () {
  const dean = yield* openAccount;
  const charles = yield* openAccount;
  const mallory = yield* openAccount;
  const workspace = yield* openWorkspace(dean);
  const elsewhere = yield* openWorkspace(mallory);
  yield* joinWorkspace(workspace, charles);
  const { id: taskId } = yield* createTask(dean, { name: "Schema", organizationId: workspace });

  return { dean, charles, mallory, workspace, elsewhere, taskId };
});

/**
 * Who follows the task, each by their id to whether they lend their
 * machines, as the account reads it, which the test expects it to reach.
 * Note that it is no list, because the test clock stands still, so every
 * follower follows at one instant and their order says nothing.
 */
const followersOf = (userId: string, taskId: string) =>
  Effect.map(listTaskFollowers(userId, taskId), (read) =>
    Object.fromEntries(
      Option.getOrElse(read, () => assert.fail("the task was not reached")).map((follower) => [
        follower.userId,
        follower.machines,
      ]),
    ),
  );

it.layer(getTestDB())("the members following a task", (it) => {
  it.effect("following again keeps the follower's switch, which only they flip", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId } = yield* openWorkspaces;

      yield* followTask(dean, { taskId, followerId: charles, machines: false });
      yield* followTask(dean, { taskId, followerId: charles, machines: true });
      assert.deepEqual(yield* followersOf(dean, taskId), { [dean]: true, [charles]: false });

      yield* setFollowerMachines(charles, taskId, true);
      yield* followTask(dean, { taskId, followerId: charles, machines: false });
      assert.deepEqual(yield* followersOf(dean, taskId), { [dean]: true, [charles]: true });
    }),
  );

  it.effect(
    "reassigning a task keeps the previous assignee following with their machines off, and the new one follows with theirs on",
    () =>
      Effect.gen(function* () {
        const { dean, charles, taskId } = yield* openWorkspaces;

        yield* updateTask(dean, taskId, { assigneeId: dean });
        yield* updateTask(dean, taskId, { assigneeId: charles });

        assert.deepEqual(yield* followersOf(dean, taskId), { [dean]: false, [charles]: true });
      }),
  );

  it.effect("a member takes another follower away, but never the task's assignee", () =>
    Effect.gen(function* () {
      const { dean, charles, mallory, taskId } = yield* openWorkspaces;
      yield* updateTask(dean, taskId, { assigneeId: dean });
      yield* followTask(dean, { taskId, followerId: charles, machines: true });

      assert.deepEqual(yield* unfollowTask(mallory, taskId, charles), Option.none());
      const refused = yield* Effect.flip(unfollowTask(charles, taskId, dean));
      assert.ok(refused instanceof TaskFollowerIsAssignee);

      yield* unfollowTask(dean, taskId, charles);
      assert.deepEqual(yield* followersOf(dean, taskId), { [dean]: true });
    }),
  );

  it.effect(
    "an account outside the task's workspace reads no followers and adds none, and no outsider follows",
    () =>
      Effect.gen(function* () {
        const { dean, charles, mallory, workspace, elsewhere, taskId } = yield* openWorkspaces;
        yield* followTask(dean, { taskId, followerId: charles, machines: true });

        const outsiderAdds = yield* followTask(mallory, {
          taskId,
          followerId: mallory,
          machines: true,
        });

        const outsiderAdded = yield* followTask(dean, {
          taskId,
          followerId: mallory,
          machines: true,
        });

        assert.deepEqual(yield* listTaskFollowers(mallory, taskId), Option.none());
        assert.deepEqual([outsiderAdds, outsiderAdded], [Option.none(), Option.none()]);
        assert.deepEqual(yield* setFollowerMachines(mallory, taskId, true), Option.none());
        assert.deepEqual(yield* listFollowedTasks(charles, elsewhere), []);
        assert.deepEqual(yield* listFollowedTasks(charles, workspace), [taskId]);

        yield* leaveWorkspace(workspace, charles);
        assert.deepEqual(yield* followersOf(dean, taskId), { [dean]: true });
        assert.deepEqual(yield* listFollowedTasks(charles, workspace), []);
      }),
  );
});
