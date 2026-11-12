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
} from "../task-follower-store.js";
import { createTask } from "../task-store.js";

/**
 * The members following a task, read and written through the store's public
 * functions over a real dialect: following again keeps a follower's switch,
 * and a task's followers are read and written only by a member of its
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

/** Who follows the task, and whether each lends their machines, as the account reads it, which the test expects it to reach. */
const followersOf = (userId: string, taskId: string) =>
  Effect.map(listTaskFollowers(userId, taskId), (read) =>
    Option.getOrElse(read, () => assert.fail("the task was not reached")).map((follower) => ({
      userId: follower.userId,
      machines: follower.machines,
    })),
  );

it.layer(getTestDB())("the members following a task", (it) => {
  it.effect("following again keeps the follower's switch, which only they flip", () =>
    Effect.gen(function* () {
      const { dean, charles, taskId } = yield* openWorkspaces;

      yield* followTask(dean, { taskId, followerId: charles, machines: false });
      yield* followTask(dean, { taskId, followerId: charles, machines: true });
      assert.deepEqual(yield* followersOf(dean, taskId), [{ userId: charles, machines: false }]);

      yield* setFollowerMachines(charles, taskId, true);
      yield* followTask(dean, { taskId, followerId: charles, machines: false });
      assert.deepEqual(yield* followersOf(dean, taskId), [{ userId: charles, machines: true }]);
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
        assert.deepEqual(yield* followersOf(dean, taskId), []);
        assert.deepEqual(yield* listFollowedTasks(charles, workspace), []);
      }),
  );
});
