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
  agentWakeupStands,
  bookAgentWakeup,
  cancelAgentWakeup,
  claimDueAgentWakeups,
  deleteAgentWakeup,
} from "../agent-wakeups.js";

/**
 * The wakeup a coding agent booked, over a real dialect: a booking replaces
 * the agent's standing one and a cancel deletes it, a claim takes each
 * wakeup once it is due and once only until its next delivery, a delivered
 * one is gone, and one claimed past the bound or of an archived agent is
 * deleted rather than claimed. The claim is the deployment's, so each test
 * reads back only the agents it made. Synthetic accounts and prompts
 * throughout.
 */

const NOW = new Date("2026-10-21T12:00:00Z");
const NEXT = new Date("2026-10-21T12:05:00Z");
const EARLIER = new Date("2026-10-21T11:58:00Z");
const LATER = new Date("2026-10-21T12:30:00Z");
/** Larger than every wakeup the file's tests make, so a claim takes them all. */
const EVERY = 100;
const MAX_ATTEMPTS = 3;

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

/** The prompts a claim at `now` took of the agents named, in the order claimed. */
const claimedOf = (now: Date, agentIds: readonly string[]) =>
  Effect.map(claimDueAgentWakeups(now, NEXT, EVERY, MAX_ATTEMPTS), (claimed) =>
    claimed.filter((each) => agentIds.includes(each.agentId)),
  );

it.layer(getTestDB())("the wakeup a coding agent booked", (it) => {
  it.effect(
    "a claim takes the wakeups due, the longest due first, once until their next delivery",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const first = yield* openAgent(owner);
        const second = yield* openAgent(owner);
        const third = yield* openAgent(owner);
        yield* bookAgentWakeup(first, { at: NOW, prompt: "Check the deploy." });
        yield* bookAgentWakeup(second, { at: EARLIER, prompt: "Check CI on #42." });
        yield* bookAgentWakeup(third, { at: LATER, prompt: "Remind me to push." });
        const agents = [first, second, third];

        const claimed = yield* claimedOf(NOW, agents);
        assert.deepEqual(
          claimed.map(({ prompt, userId }) => ({ prompt, userId })),
          [
            { prompt: "Check CI on #42.", userId: owner },
            { prompt: "Check the deploy.", userId: owner },
          ],
        );
        assert.deepEqual(
          yield* claimedOf(NOW, agents),
          [],
          "a second call in the minute takes none",
        );

        for (const { id } of claimed) yield* deleteAgentWakeup(id);
        assert.deepEqual(yield* claimedOf(NEXT, agents), [], "a delivered wakeup is gone");
        assert.deepEqual(
          (yield* claimedOf(LATER, agents)).map(({ prompt }) => prompt),
          ["Remind me to push."],
        );
      }),
  );

  it.effect(
    "a claimed wakeup stands until it is delivered, so a sweep cut off mid-send claims it again, and a cancel since the claim leaves it standing no more",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const agentId = yield* openAgent(owner);
        yield* bookAgentWakeup(agentId, { at: NOW, prompt: "Check CI on #42." });
        const [claimed] = yield* claimedOf(NOW, [agentId]);
        assert.ok(claimed !== undefined);
        assert.equal(yield* agentWakeupStands(claimed.id), true);

        const [again] = yield* claimedOf(NEXT, [agentId]);
        assert.equal(again?.id, claimed.id, "claimed again past its lease");

        yield* cancelAgentWakeup(agentId);
        assert.equal(yield* agentWakeupStands(claimed.id), false, "a cancel deleted it");
      }),
  );

  it.effect("a booking replaces the agent's standing wakeup, and a cancel deletes it", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const agentId = yield* openAgent(owner);
      const other = yield* openAgent(owner);
      yield* bookAgentWakeup(agentId, { at: EARLIER, prompt: "Old wakeup." });
      yield* bookAgentWakeup(other, { at: EARLIER, prompt: "Another agent's." });
      yield* bookAgentWakeup(agentId, { at: NOW, prompt: "New wakeup." });
      assert.deepEqual(
        (yield* claimedOf(NOW, [agentId, other])).map(({ prompt }) => prompt),
        ["Another agent's.", "New wakeup."],
      );

      yield* bookAgentWakeup(agentId, { at: LATER, prompt: "Canceled before it came." });
      yield* cancelAgentWakeup(agentId);
      assert.deepEqual(yield* claimedOf(LATER, [agentId]), []);
    }),
  );

  it.effect(
    "a wakeup whose deliveries keep failing is given up past the bound, and an archived agent's is never claimed",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const failing = yield* openAgent(owner);
        const archived = yield* openAgent(owner);
        yield* bookAgentWakeup(failing, { at: NOW, prompt: "Keeps failing." });
        yield* bookAgentWakeup(archived, { at: NOW, prompt: "Archived since." });
        yield* archiveAgent(owner, archived, true);

        let now = NOW;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
          assert.deepEqual(
            (yield* claimedOf(now, [failing, archived])).map(({ prompt }) => prompt),
            ["Keeps failing."],
            `attempt ${attempt + 1}`,
          );
          now = NEXT;
        }
        assert.deepEqual(
          yield* claimedOf(new Date("2026-10-22T00:00:00Z"), [failing, archived]),
          [],
        );
      }),
  );
});
