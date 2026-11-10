import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { BOOT_BOUNDS, BOOT_FAILURE, BOOT_PHASE } from "@repo/features/agent-boot";
import { QUEUE_PAUSE } from "@repo/features/agent-queue-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import {
  agentBootHandedOff,
  agentBootOf,
  agentBootRunnerUp,
  agentBootScriptsEnded,
  agentBootScriptsStarted,
  beginAgentBoot,
  endAgentBoot,
  failAgentBoot,
  lapsedAgentBoots,
  rebootAgent,
} from "../agent-boot-store.js";
import {
  agentQueueNow,
  claimQueueHead,
  pauseAgentQueue,
  queueWhileBooting,
} from "../agent-queue-store.js";
import { createAgent } from "../agent-store.js";

/**
 * An agent's first launch over a real dialect: begun with its first message
 * queued, moved through its phases, failed with its queue paused and its
 * messages kept, booted again with only its own pause lifted, read by the
 * minute sweep once past its deadline, and gone once its first message
 * went; and every line sent while it boots queued as it was sent, once
 * under its key, its head held until the machine is up. Synthetic accounts
 * and agents throughout.
 */

const AT = new Date(Date.UTC(2026, 10, 10, 12));

/** An instant `ms` past `AT`. */
const past = (ms: number) => new Date(AT.getTime() + ms);

/** An account holding one agent. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  const task = yield* startTask(userId, { name: "Invitations" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });
  return { userId, agentId: Option.getOrThrow(started).agent.id };
});

/** A first message as a Start queues it. */
const firstLine = (userId: string) => ({
  userId,
  id: randomUUID(),
  sendKey: randomUUID(),
  text: "Invite by link.",
  line: { sender: { kind: MESSAGE_SENDER.MEMBER, userId } },
});

it.layer(getTestDB())("an agent's first launch", (it) => {
  it.effect(
    "boots with its first message queued and held, runs its scripts, and hands off once its runner is up",
    () =>
      Effect.gen(function* () {
        const { userId, agentId } = yield* openAccount;
        yield* beginAgentBoot(agentId, AT, firstLine(userId));
        const heldWhileStarting = yield* claimQueueHead(agentId);
        yield* agentBootScriptsStarted(agentId, past(1_000));
        yield* agentBootScriptsEnded(agentId, 2);
        const up = yield* agentBootRunnerUp(agentId, past(2_000), undefined, 1);
        const handedOn = yield* claimQueueHead(agentId);
        yield* agentBootHandedOff(agentId, past(3_000));
        const ready = yield* agentBootOf(agentId);
        yield* endAgentBoot(agentId);

        assert.ok(Option.isNone(heldWhileStarting), "nothing goes while the machine boots");
        assert.deepEqual(
          Option.map(up, (boot) => [boot.phase, boot.setupExit]),
          Option.some([BOOT_PHASE.HANDING_OFF, 2]),
        );
        assert.deepEqual(
          Option.map(handedOn, (message) => message.text),
          Option.some("Invite by link."),
        );
        assert.deepEqual(
          Option.map(ready, (boot) => boot.phase),
          Option.some(BOOT_PHASE.READY),
        );
        assert.ok(Option.isNone(yield* agentBootOf(agentId)), "gone once its turn settled");
      }),
  );

  it.effect("goes straight to ready where its runner comes up with nothing queued", () =>
    Effect.gen(function* () {
      const { agentId } = yield* openAccount;
      yield* beginAgentBoot(agentId, AT, undefined);

      const up = yield* agentBootRunnerUp(agentId, past(1_000), undefined, 1);

      assert.deepEqual(
        Option.map(up, (boot) => boot.phase),
        Option.some(BOOT_PHASE.READY),
      );
    }),
  );

  it.effect(
    "fails with its queue paused and its messages kept, and boots again with only its own pause lifted",
    () =>
      Effect.gen(function* () {
        const { userId, agentId } = yield* openAccount;
        yield* beginAgentBoot(agentId, AT, firstLine(userId));
        yield* agentBootScriptsStarted(agentId, past(500));
        yield* agentBootScriptsEnded(agentId, 1);

        const failed = yield* failAgentBoot(agentId, BOOT_FAILURE.CHECKOUT_FAILED, past(1_000));
        const pausedBy = (yield* agentQueueNow(agentId)).paused?.because;
        const failedAgain = yield* failAgentBoot(agentId, BOOT_FAILURE.NO_RESPONSE, past(2_000));
        const rebooted = yield* rebootAgent(agentId, past(3_000));
        const afterReboot = yield* agentQueueNow(agentId);

        assert.equal(failed, true);
        assert.equal(pausedBy, QUEUE_PAUSE.BOOT_FAILED);
        assert.equal(failedAgain, false, "a failed boot fails no second time");
        assert.deepEqual(
          Option.map(rebooted, (boot) => [boot.phase, boot.attempt, boot.failure, boot.setupExit]),
          Option.some([BOOT_PHASE.STARTING, 2, undefined, undefined]),
        );
        assert.equal(afterReboot.paused, undefined);
        assert.deepEqual(
          afterReboot.messages.map((message) => message.text),
          ["Invite by link."],
        );

        // A Stop's pause is no boot's, so a Retry leaves it standing.
        yield* pauseAgentQueue(agentId, QUEUE_PAUSE.STOPPED);
        yield* failAgentBoot(agentId, BOOT_FAILURE.NO_RESPONSE, past(4_000));
        yield* rebootAgent(agentId, past(5_000));
        const stillPaused = (yield* agentQueueNow(agentId)).paused?.because;
        assert.equal(stillPaused, QUEUE_PAUSE.STOPPED);
      }),
  );

  it.effect("pauses its queue once a line is held after it failed with nothing queued", () =>
    Effect.gen(function* () {
      const { userId, agentId } = yield* openAccount;
      yield* beginAgentBoot(agentId, AT, undefined);
      yield* failAgentBoot(agentId, BOOT_FAILURE.MACHINE_UNAVAILABLE, past(1_000));

      yield* queueWhileBooting(agentId, userId, firstLine(userId));

      assert.equal((yield* agentQueueNow(agentId)).paused?.because, QUEUE_PAUSE.BOOT_FAILED);
    }),
  );

  it.effect("moves nothing for a runner up under an attempt Retry has since replaced", () =>
    Effect.gen(function* () {
      const { userId, agentId } = yield* openAccount;
      yield* beginAgentBoot(agentId, AT, firstLine(userId));
      yield* failAgentBoot(agentId, BOOT_FAILURE.NO_RESPONSE, past(1_000), 1);
      yield* rebootAgent(agentId, past(2_000));

      const staleUp = yield* agentBootRunnerUp(agentId, past(3_000), undefined, 1);
      const staleFailed = yield* failAgentBoot(agentId, BOOT_FAILURE.NO_RESPONSE, past(3_000), 1);

      assert.ok(Option.isNone(staleUp), "the first attempt's machine moves the second's not");
      assert.equal(staleFailed, false, "nor does its failure");
      assert.deepEqual(
        Option.map(yield* agentBootOf(agentId), (boot) => [boot.phase, boot.attempt]),
        Option.some([BOOT_PHASE.STARTING, 2]),
      );
      assert.ok(Option.isNone(yield* claimQueueHead(agentId)), "its first message stays held");
    }),
  );

  it.effect("is read past its deadline only while under way, and never once failed or ready", () =>
    Effect.gen(function* () {
      const starting = yield* openAccount;
      const failed = yield* openAccount;
      const ready = yield* openAccount;
      yield* beginAgentBoot(starting.agentId, AT, undefined);
      yield* beginAgentBoot(failed.agentId, AT, undefined);
      yield* beginAgentBoot(ready.agentId, AT, undefined);
      yield* failAgentBoot(failed.agentId, BOOT_FAILURE.MACHINE_UNAVAILABLE, AT);
      yield* agentBootRunnerUp(ready.agentId, AT, undefined, 1);

      const before = yield* lapsedAgentBoots(past(BOOT_BOUNDS.DEADLINE_MS - 1), 100);
      const after = yield* lapsedAgentBoots(past(BOOT_BOUNDS.DEADLINE_MS), 100);

      const mine = (boots: readonly { readonly agentId: string }[]) =>
        boots
          .map((boot) => boot.agentId)
          .filter((id) => [starting.agentId, failed.agentId, ready.agentId].includes(id));
      assert.deepEqual(mine(before), []);
      assert.deepEqual(mine(after), [starting.agentId]);
    }),
  );

  it.effect(
    "queues every line sent while it boots as it was sent, once under its key, and none once it is over",
    () =>
      Effect.gen(function* () {
        const { userId, agentId } = yield* openAccount;
        const automation = {
          id: randomUUID(),
          sendKey: JSON.stringify({ run: "run-1" }),
          text: "Triage the inbox.",
          line: {
            sender: {
              kind: MESSAGE_SENDER.AUTOMATION,
              automationId: randomUUID(),
              name: "Nightly",
            },
            serverWords: "Triage the inbox.",
          },
        };
        const beforeBoot = yield* queueWhileBooting(agentId, userId, automation);
        yield* beginAgentBoot(agentId, AT, undefined);
        const queued = yield* queueWhileBooting(agentId, userId, automation);
        const repeated = yield* queueWhileBooting(agentId, userId, {
          ...automation,
          id: randomUUID(),
        });
        const read = yield* agentQueueNow(agentId);
        yield* agentBootRunnerUp(agentId, past(1_000), undefined, 1);
        yield* agentBootHandedOff(agentId, past(2_000));
        const afterBoot = yield* queueWhileBooting(agentId, userId, {
          ...automation,
          sendKey: randomUUID(),
        });

        assert.ok(Option.isNone(beforeBoot), "no boot holds a line before it begins");
        assert.ok(Option.isSome(queued) && Option.isSome(repeated));
        assert.deepEqual(
          read.messages.map((message) => [message.text, message.sendKey, message.line]),
          [["Triage the inbox.", automation.sendKey, automation.line]],
        );
        assert.ok(Option.isNone(afterBoot), "a boot that handed off holds nothing");
      }),
  );
});
