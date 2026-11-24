import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, leaveWorkspace, startTask } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import { managerAssigneeOf } from "../manager-assignee.js";
import { updateTask } from "../task-store.js";

/**
 * Who a Manager's agent works for, over a real dialect: its task's
 * assignee, and nothing where no Manager started it, the task is the
 * owner's own, the assignee left the workspace, or another account reads
 * it. Synthetic accounts.
 */

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@app.test` });

    return id;
  });

/** An agent of the owner's on the task, started by the agent given where one is. */
const openAgentOn = (
  ownerId: string,
  taskId: string,
  kind: (typeof AGENT_KIND)[keyof typeof AGENT_KIND],
  startedByAgentId?: string,
) =>
  Effect.gen(function* () {
    const started = yield* createAgent(ownerId, {
      taskId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      descriptionSnapshot: null,
      prompt: "Expire teammate invitations.",
      repository: "acme/relay",
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      kind,
      ...(startedByAgentId === undefined ? undefined : { startedByAgentId }),
    });

    return Option.getOrThrow(started).agent;
  });

it.layer(getTestDB())("who a Manager's agent works for", (it) => {
  it.effect(
    "a Manager's agent reads its task's assignee, and nothing is read for an agent no Manager started, another account, an assignee who left the workspace, or a task assigned to the owner",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount("Dana Owner");
        const assignee = yield* openAccount("Avery Assignee");
        const stranger = yield* openAccount("Sam Stranger");
        const task = yield* startTask(owner, { name: "Invitations", repository: "acme/relay" });
        yield* joinWorkspace(task.workspaceId, assignee);
        yield* updateTask(owner, task.id, { assigneeId: assignee });

        const manager = yield* openAgentOn(owner, task.id, AGENT_KIND.MANAGER);
        const agent = yield* openAgentOn(owner, task.id, AGENT_KIND.CODER, manager.id);
        const coder = yield* openAgentOn(owner, task.id, AGENT_KIND.CODER);
        const coderStarted = yield* openAgentOn(owner, task.id, AGENT_KIND.CODER, coder.id);

        assert.deepEqual(
          yield* managerAssigneeOf(owner, agent.id),
          Option.some({ userId: assignee, name: "Avery Assignee" }),
        );
        assert.ok(Option.isNone(yield* managerAssigneeOf(owner, coderStarted.id)));
        assert.ok(Option.isNone(yield* managerAssigneeOf(stranger, agent.id)));

        yield* leaveWorkspace(task.workspaceId, assignee);
        assert.ok(Option.isNone(yield* managerAssigneeOf(owner, agent.id)));

        yield* updateTask(owner, task.id, { assigneeId: owner });
        assert.ok(Option.isNone(yield* managerAssigneeOf(owner, agent.id)));
      }),
  );
});
