import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import {
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openTaskAgent,
  openWorkspace,
} from "../../testing/index.js";
import {
  AgentFollowerIsOwner,
  followAgent,
  listAgentFollowers,
  setAgentFollowerMachines,
  unfollowAgent,
} from "../agent-follower-store.js";
import { createAgent } from "../agent-store.js";
import { createTask } from "../task-store.js";

/**
 * The members following a Manager, read and written through the store's
 * public functions over a real dialect: its owner always follows with their
 * machines on, following again keeps a follower's switch, a member takes
 * another follower away but never the owner, and a Manager's followers are
 * read and written only by a member of its workspace, and only ever name its
 * members.
 *
 * Synthetic accounts, workspaces, and agents throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** Charles's workspace with Dean a member of it and a Manager Charles started there, and Mallory's workspace beside it. */
const openWorkspaces = Effect.gen(function* () {
  const charles = yield* openAccount;
  const dean = yield* openAccount;
  const mallory = yield* openAccount;
  const workspace = yield* openWorkspace(charles);
  yield* openWorkspace(mallory);
  yield* joinWorkspace(workspace, dean);

  const started = yield* createAgent(charles, {
    taskId: null,
    workspaceId: workspace,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: null,
    descriptionSnapshot: null,
    prompt: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    kind: AGENT_KIND.MANAGER,
  });

  const managerId = Option.getOrThrow(started).agent.id;

  return { charles, dean, mallory, workspace, managerId };
});

/**
 * Who follows the Manager, each by their id to whether they lend their
 * machines, as the account reads it, which the test expects it to reach.
 * Note that it is no list, because the test clock stands still, so every
 * follower follows at one instant and their order says nothing.
 */
const followersOf = (userId: string, agentId: string) =>
  Effect.map(listAgentFollowers(userId, agentId), (read) =>
    Object.fromEntries(
      Option.getOrElse(read, () => assert.fail("the Manager was not reached")).map((follower) => [
        follower.userId,
        follower.machines,
      ]),
    ),
  );

it.layer(getTestDB())("the members following a Manager", (it) => {
  it.effect(
    "its owner always follows with their machines on, and is refused an unfollow or a switch",
    () =>
      Effect.gen(function* () {
        const { charles, dean, managerId } = yield* openWorkspaces;

        yield* followAgent(dean, { agentId: managerId, followerId: charles, machines: false });
        const unfollowed = yield* Effect.flip(unfollowAgent(dean, managerId, charles));
        const switched = yield* Effect.flip(setAgentFollowerMachines(charles, managerId, false));

        assert.ok(unfollowed instanceof AgentFollowerIsOwner);
        assert.ok(switched instanceof AgentFollowerIsOwner);
        assert.deepEqual(yield* followersOf(dean, managerId), { [charles]: true });
      }),
  );

  it.effect("following again keeps the follower's switch, which only they flip", () =>
    Effect.gen(function* () {
      const { charles, dean, managerId } = yield* openWorkspaces;

      yield* followAgent(charles, { agentId: managerId, followerId: dean, machines: false });
      yield* followAgent(charles, { agentId: managerId, followerId: dean, machines: true });
      assert.deepEqual(yield* followersOf(charles, managerId), { [charles]: true, [dean]: false });

      yield* setAgentFollowerMachines(dean, managerId, true);
      yield* followAgent(charles, { agentId: managerId, followerId: dean, machines: false });
      assert.deepEqual(yield* followersOf(charles, managerId), { [charles]: true, [dean]: true });

      yield* unfollowAgent(charles, managerId, dean);
      assert.deepEqual(yield* followersOf(charles, managerId), { [charles]: true });
    }),
  );

  it.effect(
    "an account outside the Manager's workspace reads no followers and writes none, and no outsider follows",
    () =>
      Effect.gen(function* () {
        const { charles, dean, mallory, workspace, managerId } = yield* openWorkspaces;
        yield* followAgent(charles, { agentId: managerId, followerId: dean, machines: true });

        const outsiderAdds = yield* followAgent(mallory, {
          agentId: managerId,
          followerId: mallory,
          machines: true,
        });

        const outsiderAdded = yield* followAgent(charles, {
          agentId: managerId,
          followerId: mallory,
          machines: true,
        });

        assert.deepEqual(yield* listAgentFollowers(mallory, managerId), Option.none());
        assert.deepEqual([outsiderAdds, outsiderAdded], [Option.none(), Option.none()]);
        assert.deepEqual(yield* unfollowAgent(mallory, managerId, dean), Option.none());
        assert.deepEqual(yield* setAgentFollowerMachines(mallory, managerId, true), Option.none());

        yield* leaveWorkspace(workspace, dean);
        assert.deepEqual(yield* followersOf(charles, managerId), { [charles]: true });
      }),
  );

  it.effect("an agent on a task reads as no agent, since its task holds its followers", () =>
    Effect.gen(function* () {
      const { charles, dean, workspace } = yield* openWorkspaces;

      const { id: taskId } = yield* createTask(charles, {
        name: "Schema",
        organizationId: workspace,
      });

      const agentId = yield* openTaskAgent(charles, workspace, taskId);

      const followed = yield* followAgent(charles, { agentId, followerId: dean, machines: true });

      assert.deepEqual(followed, Option.none());
      assert.deepEqual(yield* listAgentFollowers(charles, agentId), Option.none());
    }),
  );
});
