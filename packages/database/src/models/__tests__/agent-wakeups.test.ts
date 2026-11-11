import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { archiveAgent, createAgent } from "../agent-store.js";
import {
  bookAgentWakeup,
  cancelAgentWakeup,
  deleteAgentWakeup,
  standingAgentWakeup,
} from "../agent-wakeups.js";

/**
 * The wakeup a coding agent booked, over a real dialect: a booking stands
 * under an id of its own until a newer booking, a cancel, its delivery, or
 * its agent's archive leaves it standing no more, and one user's agent never
 * reads as another's. Synthetic accounts and prompts throughout.
 */

const NOW = new Date("2026-10-21T12:00:00Z");
const LATER = new Date("2026-10-21T12:30:00Z");

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

const openAgent = (userId: string) =>
  Effect.gen(function* () {
    const task = yield* startTask(userId, { name: "Invitations", repository: "acme/relay" });
    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "openai/gpt-5.5",
      effort: "high",
      descriptionSnapshot: "# Invitations\n",
      prompt: null,
      repository: "acme/relay",
      runtime: CONVERSATION_RUNTIME.CODEX,
    });
    return Option.getOrThrow(started).agent.id;
  });

/** The prompt and starter the wakeup under the id still stands with, or none. */
const standing = (id: string) =>
  Effect.map(
    standingAgentWakeup(id),
    Option.map(({ prompt, userId }) => ({ prompt, userId })),
  );

it.layer(getTestDB())("the wakeup a coding agent booked", (it) => {
  it.effect(
    "a booking stands under its own id for its agent's starter until a newer booking replaces it, a cancel, or its delivery",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const agentId = yield* openAgent(owner);
        const othersAgent = yield* openAgent(other);

        const first = yield* bookAgentWakeup(agentId, { at: NOW, prompt: "Old wakeup." });
        const others = yield* bookAgentWakeup(othersAgent, { at: NOW, prompt: "Another's." });
        assert.deepEqual(
          yield* standing(first),
          Option.some({ prompt: "Old wakeup.", userId: owner }),
        );
        const second = yield* bookAgentWakeup(agentId, { at: LATER, prompt: "New wakeup." });
        assert.notEqual(second, first);
        assert.deepEqual(yield* standing(first), Option.none(), "replaced by the newer booking");
        assert.deepEqual(
          yield* standing(second),
          Option.some({ prompt: "New wakeup.", userId: owner }),
        );
        assert.deepEqual(
          yield* standing(others),
          Option.some({ prompt: "Another's.", userId: other }),
        );

        yield* cancelAgentWakeup(agentId);
        assert.deepEqual(yield* standing(second), Option.none(), "canceled");
        yield* deleteAgentWakeup(others);
        assert.deepEqual(yield* standing(others), Option.none(), "delivered");
      }),
  );

  it.effect("an archived agent's wakeup stands no more", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const agentId = yield* openAgent(owner);
      const id = yield* bookAgentWakeup(agentId, { at: NOW, prompt: "Archived since." });
      yield* archiveAgent(owner, agentId, true);
      assert.deepEqual(yield* standing(id), Option.none());
    }),
  );
});
