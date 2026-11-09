import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { TURN_DEADLINE } from "@repo/features/turn-deadline";
import { RUN_EVENT, RUN_STATUS, RUN_TURN_ORIGIN, TURN_TRIGGER } from "@repo/features/turn-run";
import { sessionKey } from "@repo/runtime/vocabulary";
import { TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { asc, eq } from "drizzle-orm";
import { Clock, Duration, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { messages, turns } from "../../schemas/storage.js";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { settleLapsedTurns } from "../abandoned-turns.js";
import { writeAgentRunnerRecord } from "../agent-runner-record.js";
import { createAgent } from "../agent-store.js";
import {
  lapsedAgents,
  lapsedTurnsOf,
  progressTurns,
  runningTurnSandboxes,
  turnAwaitedByLine,
  turnsAwaitingRunner,
} from "../turn-state.js";
import { type ConversationTarget, STORE_WRITE_REFUSAL, storeWriter } from "../writer.js";

/**
 * The turn row as the one record of a coding agent's turn, over a real
 * dialect: a line is written with the turn it awaits, every move of an open
 * turn names the attempt it runs under, and a turn reads lapsed past its
 * state's deadline or its cap. Synthetic accounts, agents, and lines
 * throughout; the test clock starts at the epoch.
 */

/** A coding agent of a new account, and its conversation. */
const openAgent = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* (yield* Database)
    .insert(user)
    .values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    descriptionSnapshot: "# Teammate invitations",
    prompt: null,
    repository: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });
  assert.ok(started._tag === "Some");
  const { agent } = started.value;
  return { agentId: agent.id, target: { userId, conversationId: agent.conversationId } };
});

/** A line of the developer's written to the agent, its hand-over answering as given. */
const sent = (target: ConversationTarget, clientKey: string, taken = true) =>
  Effect.flatMap(storeWriter({ tools: {} }), (writer) =>
    writer.writeAwaitingLine(
      target,
      { text: `The ${clientKey} ask.`, clientKey, sender: { kind: MESSAGE_SENDER.APP } },
      Effect.succeed(taken),
    ),
  );

/** The conversation's turns, oldest first: each one's id, status, deadline in epoch milliseconds, and attempt. */
const turnsOf = (target: ConversationTarget) =>
  Effect.map(
    Effect.flatMap(Database, (db) =>
      db
        .select({
          id: turns.id,
          status: turns.status,
          leaseUntil: turns.leaseUntil,
          attempt: turns.attempt,
        })
        .from(turns)
        .where(eq(turns.conversationId, target.conversationId))
        .orderBy(asc(turns.queuedAt), asc(turns.id)),
    ),
    (rows) => rows.map((row) => ({ ...row, leaseUntil: row.leaseUntil?.getTime() ?? null })),
  );

/** The turn each of the conversation's developer lines awaits, by its client id. */
const awaitedOf = (target: ConversationTarget) =>
  Effect.map(
    Effect.flatMap(Database, (db) =>
      db
        .select({ clientId: messages.clientId, awaits: messages.awaitsTurnId })
        .from(messages)
        .where(eq(messages.conversationId, target.conversationId)),
    ),
    (rows) => new Map(rows.map((row) => [row.clientId, row.awaits])),
  );

/** The turn named started by a runner of the launch given, at the clock's instant. */
const started = (target: ConversationTarget, turnId: string, attempt: number) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: {} });
    return yield* writer.consume(target, {
      kind: RUN_EVENT.TURN_STARTED,
      conversationId: sessionKey(target.conversationId),
      turnId,
      sequence: 1,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at: yield* Clock.currentTimeMillis,
      attempt,
    });
  });

/** The turn named ended as given by a runner of the launch given, at the clock's instant. */
const ended = (
  target: ConversationTarget,
  turnId: string,
  attempt: number,
  status: typeof RUN_STATUS.SUCCEEDED | typeof RUN_STATUS.CANCELED,
) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: {} });
    return yield* writer.consume(target, {
      kind: RUN_EVENT.TURN_ENDED,
      conversationId: sessionKey(target.conversationId),
      turnId,
      sequence: 2,
      status,
      responseIds: [],
      at: yield* Clock.currentTimeMillis,
      attempt,
    });
  });

it.layer(getTestDB())("a turn's one record", (it) => {
  it.effect(
    "a line awaits the turn its send queued with its pickup deadline, a later line joins that open turn, a line written after a Stop queues its own, and a send the runtime did not take drops the turn it queued",
    () =>
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis;
        const { target } = yield* openAgent;
        yield* sent(target, "first");
        yield* TestClock.adjust(Duration.seconds(1));
        yield* sent(target, "second");
        const [queued] = yield* turnsOf(target);
        assert.ok(queued !== undefined);
        const writer = yield* storeWriter({ tools: {} });
        yield* writer.requestTurnCancel(target, { turnId: queued.id, at: new Date(at + 2000) });
        yield* sent(target, "after the Stop");
        yield* sent(target, "refused", false);

        const rows = yield* turnsOf(target);
        const awaited = yield* awaitedOf(target);
        assert.equal(rows.length, 2, "the refused send leaves no turn behind");
        assert.deepEqual(rows[0], {
          id: queued.id,
          status: TURN_STATUS.QUEUED,
          // The Stop pulls the pickup deadline in to its own.
          leaseUntil: at + 2000 + TURN_DEADLINE.STOP_MS,
          attempt: 0,
        });
        assert.equal(rows[1]?.status, TURN_STATUS.QUEUED);
        assert.equal(rows[1]?.leaseUntil, at + 1000 + TURN_DEADLINE.PICKUP_MS);
        assert.equal(awaited.get(sentLineId("first")), queued.id);
        assert.equal(awaited.get(sentLineId("second")), queued.id);
        assert.equal(awaited.get(sentLineId("after the Stop")), rows[1]?.id);
        // A runner that takes the stopped turn's line after all starts it under the Stop's own deadline.
        yield* started(target, queued.id, 1);
        assert.equal((yield* turnsOf(target))[0]?.leaseUntil, at + 2000 + TURN_DEADLINE.STOP_MS);
      }),
  );

  it.effect(
    "a turn that ends well queues a turn for the lines it never took, which goes once another turn takes them, and a turn a Stop was asked of leaves them awaiting nothing",
    () =>
      Effect.gen(function* () {
        const { target } = yield* openAgent;
        const writer = yield* storeWriter({ tools: {} });
        yield* sent(target, "first");
        const [opened] = yield* turnsOf(target);
        assert.ok(opened !== undefined);
        yield* started(target, opened.id, 1);
        yield* writer.takeAwaitingLine(target, {
          clientId: sentLineId("first"),
          turnId: opened.id,
        });
        yield* sent(target, "steer");
        yield* TestClock.adjust(Duration.seconds(1));
        yield* ended(target, opened.id, 1, RUN_STATUS.SUCCEEDED);

        const [, requeued] = yield* turnsOf(target);
        assert.equal(requeued?.status, TURN_STATUS.QUEUED, "the untaken line's turn is queued");
        assert.equal((yield* awaitedOf(target)).get(sentLineId("steer")), requeued?.id);

        // A runner that took the steer into a turn of its own, as one ending a turn and opening the next in one batch does.
        const minted = randomUUID();
        yield* writer.enqueueTurn(target, {
          turnId: minted,
          origin: TURN_ORIGIN.TYPED,
          runtimeTurnId: minted,
        });
        yield* started(target, minted, 1);
        yield* writer.takeAwaitingLine(target, { clientId: sentLineId("steer"), turnId: minted });
        assert.deepEqual(
          (yield* turnsOf(target)).map((turn) => [turn.id, turn.status]),
          [
            [opened.id, TURN_STATUS.SETTLED],
            [minted, TURN_STATUS.RUNNING],
          ],
          "the queued turn awaiting nothing went",
        );

        const stopped = yield* openAgent;
        yield* sent(stopped.target, "first");
        const [stoppedTurn] = yield* turnsOf(stopped.target);
        assert.ok(stoppedTurn !== undefined);
        yield* started(stopped.target, stoppedTurn.id, 1);
        yield* writer.requestTurnCancel(stopped.target, {
          turnId: stoppedTurn.id,
          at: new Date(yield* Clock.currentTimeMillis),
        });
        yield* ended(stopped.target, stoppedTurn.id, 1, RUN_STATUS.SUCCEEDED);

        assert.equal((yield* turnsOf(stopped.target)).length, 1, "no turn is queued after a Stop");
      }),
  );

  it.effect(
    "every move of an open turn names its attempt: a start takes the launch's, an end told by another launch is refused, and progress pushes only a running turn of the launch's with no Stop asked of it",
    () =>
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis;
        const { target } = yield* openAgent;
        yield* sent(target, "first");
        const [turn] = yield* turnsOf(target);
        assert.ok(turn !== undefined);
        assert.equal(
          yield* progressTurns(target.conversationId, 0, at + 60_000),
          0,
          "a queued turn's pickup deadline is not progress's to push",
        );
        yield* started(target, turn.id, 2);
        const stale = yield* ended(target, turn.id, 1, RUN_STATUS.SUCCEEDED);
        const pushedByOther = yield* progressTurns(target.conversationId, 1, at + 10 * 60_000);
        const pushed = yield* progressTurns(target.conversationId, 2, at + 10 * 60_000);

        assert.ok(Result.isFailure(stale));
        assert.equal(stale.failure.refusal, STORE_WRITE_REFUSAL.FENCED);
        assert.equal(pushedByOther, 0);
        assert.equal(pushed, 1);
        assert.deepEqual(yield* turnsOf(target), [
          {
            id: turn.id,
            status: TURN_STATUS.RUNNING,
            leaseUntil: at + 10 * 60_000 + TURN_DEADLINE.PROGRESS_MS,
            attempt: 2,
          },
        ]);

        const writer = yield* storeWriter({ tools: {} });
        yield* writer.requestTurnCancel(target, {
          turnId: turn.id,
          at: new Date(at + 11 * 60_000),
        });
        assert.equal(
          yield* progressTurns(target.conversationId, 2, at + 20 * 60_000),
          0,
          "a Stop's deadline is not progress's to push",
        );
      }),
  );

  it.effect("a line's own turn reads by its client id, and none for a line no send wrote", () =>
    Effect.gen(function* () {
      const { target } = yield* openAgent;
      yield* sent(target, "first");
      const [turn] = yield* turnsOf(target);
      assert.ok(turn !== undefined);

      const awaited = yield* turnAwaitedByLine(target.conversationId, sentLineId("first"));
      const none = yield* turnAwaitedByLine(target.conversationId, sentLineId("never"));

      assert.deepEqual(awaited, Option.some(turn.id));
      assert.deepEqual(none, Option.none());
    }),
  );

  it.effect(
    "a turn reads as awaiting a runner once queued before the instant asked, until its pickup deadline, and one a runner started does not",
    () =>
      Effect.gen(function* () {
        // Note that the clock runs on from the cases before, so every instant is read from where it stands.
        const at = yield* Clock.currentTimeMillis;
        const queuedAgent = yield* openAgent;
        yield* sent(queuedAgent.target, "never taken");
        const runningAgent = yield* openAgent;
        yield* sent(runningAgent.target, "taken");
        const [running] = yield* turnsOf(runningAgent.target);
        assert.ok(running !== undefined);
        yield* started(runningAgent.target, running.id, 1);
        const ours = new Set([
          queuedAgent.target.conversationId,
          runningAgent.target.conversationId,
        ]);
        const awaiting = (before: number, now: number) =>
          Effect.map(turnsAwaitingRunner(new Date(before), new Date(now), 1000), (rows) =>
            rows.filter((row) => ours.has(row.conversationId)).map((row) => row.conversationId),
          );

        const queuedSince = yield* awaiting(at, at);
        const queuedBefore = yield* awaiting(at + 1, at + 1);
        const pastPickup = yield* awaiting(at + 1, at + TURN_DEADLINE.PICKUP_MS + 1);

        assert.deepEqual(queuedSince, []);
        assert.deepEqual(queuedBefore, [queuedAgent.target.conversationId]);
        assert.deepEqual(pastPickup, []);
      }),
  );

  it.effect(
    "a running turn's sandbox is kept up inside its progress deadline and let go past it, and a queued turn's is not",
    () =>
      Effect.gen(function* () {
        // Note that the clock runs on from the cases before, so every instant is read from where it stands.
        const at = yield* Clock.currentTimeMillis;
        const runner = (agentId: string, sandboxName: string) => ({
          agentId,
          sandboxName,
          firstSequence: 1,
          fingerprint: null,
          sandboxSessionId: `sbx-${randomUUID()}`,
          commandId: `cmd-${randomUUID()}`,
        });
        const queuedAgent = yield* openAgent;
        yield* sent(queuedAgent.target, "never taken");
        const queuedSandbox = `agent-sandbox-${randomUUID()}`;
        yield* writeAgentRunnerRecord(
          queuedAgent.target.userId,
          randomUUID(),
          runner(queuedAgent.agentId, queuedSandbox),
        );
        const runningAgent = yield* openAgent;
        yield* sent(runningAgent.target, "taken");
        const [running] = yield* turnsOf(runningAgent.target);
        assert.ok(running !== undefined);
        yield* started(runningAgent.target, running.id, 1);
        const runningSandbox = `agent-sandbox-${randomUUID()}`;
        yield* writeAgentRunnerRecord(
          runningAgent.target.userId,
          randomUUID(),
          runner(runningAgent.agentId, runningSandbox),
        );
        const kept = (now: number) =>
          Effect.map(runningTurnSandboxes(new Date(now), 1000), (names) =>
            names.filter((name) => name === queuedSandbox || name === runningSandbox),
          );

        assert.deepEqual(yield* kept(at + TURN_DEADLINE.PROGRESS_MS - 1), [runningSandbox]);
        assert.deepEqual(yield* kept(at + TURN_DEADLINE.PROGRESS_MS + 1), []);
      }),
  );

  it.effect(
    "a turn reads lapsed past its state's deadline or its cap, and a reap of one its runner moved on since settles nothing",
    () =>
      Effect.gen(function* () {
        // Note that the clock runs on from the cases before, so every instant is read from where it stands.
        const at = yield* Clock.currentTimeMillis;
        const queuedAgent = yield* openAgent;
        yield* sent(queuedAgent.target, "never taken");
        const runningAgent = yield* openAgent;
        yield* sent(runningAgent.target, "taken");
        const [running] = yield* turnsOf(runningAgent.target);
        assert.ok(running !== undefined);
        yield* started(runningAgent.target, running.id, 1);
        const pickupPast = new Date(at + TURN_DEADLINE.PICKUP_MS + 1);

        const lapsedQueued = yield* lapsedTurnsOf(queuedAgent.target.conversationId, pickupPast);
        const lapsedRunning = yield* lapsedTurnsOf(runningAgent.target.conversationId, pickupPast);
        const agents = (yield* lapsedAgents(pickupPast, 1000)).map((agent) => agent.id);

        assert.deepEqual(
          lapsedQueued.map((turn) => turn.status),
          [TURN_STATUS.QUEUED],
        );
        assert.deepEqual(lapsedRunning, [], "a running turn keeps its progress deadline");
        assert.ok(agents.includes(queuedAgent.agentId));
        assert.ok(!agents.includes(runningAgent.agentId));

        // The runner moved the turn on after the reap read it lapsed, so the reap settles nothing.
        const progressPast = new Date(at + TURN_DEADLINE.PROGRESS_MS + 1);
        const [read] = yield* lapsedTurnsOf(runningAgent.target.conversationId, progressPast);
        assert.ok(read !== undefined);
        yield* progressTurns(runningAgent.target.conversationId, 1, at + TURN_DEADLINE.PROGRESS_MS);
        const writer = yield* storeWriter({ tools: {} });
        const reaped = yield* settleLapsedTurns(
          writer,
          runningAgent.target.conversationId,
          [
            {
              turn: { ...runningAgent.target, id: read.id, attempt: read.attempt },
              end: { status: RUN_STATUS.CANCELED },
            },
          ],
          progressPast.getTime(),
          progressPast.getTime(),
        );
        assert.deepEqual(reaped, []);

        const pastCap = new Date(at + TURN_DEADLINE.CAP_MS + 1);
        yield* progressTurns(runningAgent.target.conversationId, 1, at + TURN_DEADLINE.CAP_MS);
        assert.deepEqual(
          (yield* lapsedTurnsOf(runningAgent.target.conversationId, pastCap)).map(
            (turn) => turn.id,
          ),
          [running.id],
          "a turn past its cap lapses whatever its progress",
        );
      }),
  );
});
