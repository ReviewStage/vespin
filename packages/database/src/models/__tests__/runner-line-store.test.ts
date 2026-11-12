import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { sentLineId } from "@repo/wire/host-ids";
import { Clock, Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { settleRunnerLostTurns } from "../abandoned-turns.js";
import { createAgent } from "../agent-store.js";
import {
  acceptRunnerLine,
  clearRunnerLines,
  pendingRunnerHanded,
  queueRunnerLine,
  runnerLinesPast,
  waitingRunnerFiles,
} from "../runner-line-store.js";
import { storeWriter } from "../writer.js";

/**
 * The lines queued for a cloud agent's runner, over a real dialect: a launch
 * reads its own lines past its cursor in the order they were queued, however
 * old, and a message queued again under its id is queued once; a later launch is handed
 * the message lines an earlier one never acknowledged while the turn each
 * awaits still waits on it, and nothing else of that launch's, even under the same first event
 * number once the new launch dropped them; and no account queues for,
 * reads, or acknowledges another's agent. Synthetic accounts and agents
 * throughout.
 */

const LAUNCH = { FIRST: 1, NEXT: 40 } as const;

const LIMIT = 50;

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

  const { agent } = Option.getOrThrow(started);

  return { userId, agentId: agent.id, conversationId: agent.conversationId };
});

/** A developer's line to the agent written as its send writes it, with the turn it awaits, under the line id it is queued for the runner by. */
const lineSent = (account: { userId: string; conversationId: string }, clientKey: string) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: {} });
    yield* writer.writeAwaitingLine(
      { userId: account.userId, conversationId: account.conversationId },
      { text: clientKey, clientKey, sender: { kind: MESSAGE_SENDER.APP } },
      Effect.succeed(true),
    );

    return sentLineId(clientKey);
  });

/** The texts a launch reads past its cursor. */
const textsPast = (userId: string, agentId: string, launch: number, after = 0) =>
  Effect.map(runnerLinesPast(userId, agentId, { launch, after, limit: LIMIT }), (lines) =>
    lines.map((line) => line.text),
  );

it.layer(getTestDB())("the runner line store", (it) => {
  it.effect("a launch reads its lines past its cursor, a message queued again once", () =>
    Effect.gen(function* () {
      const { userId, agentId } = yield* openAccount;
      const lineId = randomUUID();

      const first = yield* queueRunnerLine(userId, {
        agentId,
        launch: LAUNCH.FIRST,
        text: '{"type":"message","n":1}',
        lineId,
      });

      const again = yield* queueRunnerLine(userId, {
        agentId,
        launch: LAUNCH.FIRST,
        text: '{"type":"message","n":1}',
        lineId,
      });

      assert.deepEqual(again, first);

      const model = yield* queueRunnerLine(userId, {
        agentId,
        launch: LAUNCH.FIRST,
        text: '{"type":"model"}',
      });

      // Note that a launch's own lines stand past the window an earlier launch's are handed in.
      yield* TestClock.adjust(Duration.hours(2));
      assert.deepEqual(yield* textsPast(userId, agentId, LAUNCH.FIRST), [
        '{"type":"message","n":1}',
        '{"type":"model"}',
      ]);
      assert.deepEqual(yield* textsPast(userId, agentId, LAUNCH.FIRST, Option.getOrThrow(first)), [
        '{"type":"model"}',
      ]);
      assert.deepEqual(
        yield* textsPast(userId, agentId, LAUNCH.FIRST, Option.getOrThrow(model)),
        [],
      );
    }),
  );

  it.effect(
    "a later launch is handed the messages an earlier one never took while their turn waits on them, and nothing else of it",
    () =>
      Effect.gen(function* () {
        const account = yield* openAccount;
        const { userId, agentId, conversationId } = account;

        const queue = (launch: number, text: string, lineId?: string) =>
          queueRunnerLine(userId, { agentId, launch, text, ...(lineId && { lineId }) });

        // A line whose turn failed, which the developer resends themselves rather than a launch behind their back.
        const failed = yield* lineSent(account, "failed");
        const writer = yield* storeWriter({ tools: {} });
        yield* settleRunnerLostTurns(writer, conversationId, yield* Clock.currentTimeMillis);
        const taken = yield* lineSent(account, "taken");
        const untaken = yield* lineSent(account, "untaken");
        yield* queue(LAUNCH.FIRST, "failed", failed);
        yield* queue(LAUNCH.FIRST, "taken", taken);
        yield* queue(LAUNCH.FIRST, "stop");
        yield* queue(LAUNCH.FIRST, "untaken", untaken);
        yield* acceptRunnerLine(userId, agentId, taken);
        yield* queue(LAUNCH.NEXT, "next");
        assert.deepEqual(yield* textsPast(userId, agentId, LAUNCH.NEXT), ["untaken", "next"]);
      }),
  );

  it.effect(
    "a launch that dropped its predecessor's lines reads only its untaken messages whose turn waits on them under the same number",
    () =>
      Effect.gen(function* () {
        const account = yield* openAccount;
        const { userId, agentId, conversationId } = account;

        const queue = (text: string, lineId?: string) =>
          queueRunnerLine(userId, {
            agentId,
            launch: LAUNCH.FIRST,
            text,
            ...(lineId && { lineId }),
          });

        const failed = yield* lineSent(account, "failed");
        const writer = yield* storeWriter({ tools: {} });
        yield* settleRunnerLostTurns(writer, conversationId, yield* Clock.currentTimeMillis);
        const taken = yield* lineSent(account, "taken");
        const untaken = yield* lineSent(account, "untaken");
        yield* queue("failed", failed);
        yield* queue("taken", taken);
        yield* queue("stop");
        yield* queue("untaken", untaken);
        yield* acceptRunnerLine(userId, agentId, taken);
        yield* clearRunnerLines(userId, agentId);
        yield* queue("first of the next");
        assert.deepEqual(yield* textsPast(userId, agentId, LAUNCH.FIRST), [
          "untaken",
          "first of the next",
        ]);
      }),
  );

  it.effect(
    "a message line carries its files and what its words hand to the launch that takes it: its files written while its turn waits, the newest still waiting's handed state composed against, and that state answered as its runner accepts it",
    () =>
      Effect.gen(function* () {
        const account = yield* openAccount;
        const { userId, agentId, conversationId } = account;
        const file = (path: string) => ({ path, contents: "JVBERi0=", mode: 0o644 });
        const failed = yield* lineSent(account, "failed");
        yield* queueRunnerLine(userId, {
          agentId,
          launch: LAUNCH.FIRST,
          text: "failed",
          lineId: failed,
          files: [file("/attachments/failed.pdf")],
          handed: { task: "failed" },
        });
        const writer = yield* storeWriter({ tools: {} });
        yield* settleRunnerLostTurns(writer, conversationId, yield* Clock.currentTimeMillis);
        const first = yield* lineSent(account, "first");
        const second = yield* lineSent(account, "second");

        for (const [lineId, handed] of [
          [first, { task: "first" }],
          [second, { task: "second" }],
        ] as const) {
          yield* queueRunnerLine(userId, {
            agentId,
            launch: LAUNCH.FIRST,
            text: lineId,
            lineId,
            files: [file(`/attachments/${lineId}.pdf`)],
            handed,
          });
        }

        const waitingFiles = (yield* waitingRunnerFiles(userId, agentId)).map((each) => each.path);
        const pending = yield* pendingRunnerHanded(userId, agentId);
        const accepted = yield* acceptRunnerLine(userId, agentId, first);
        const acceptedAgain = yield* acceptRunnerLine(userId, agentId, first);
        const stillPending = yield* pendingRunnerHanded(userId, agentId);

        assert.deepEqual(waitingFiles, [`/attachments/${first}.pdf`, `/attachments/${second}.pdf`]);
        assert.deepEqual(pending, Option.some({ task: "second" }));
        assert.deepEqual(accepted, Option.some({ task: "first" }));
        assert.deepEqual(acceptedAgain, Option.none());
        assert.deepEqual(stillPending, Option.some({ task: "second" }));
      }),
  );

  it.effect("no account queues for, reads, or acknowledges another's agent", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const other = yield* openAccount;
      const lineId = yield* lineSent(owner, "theirs");
      yield* queueRunnerLine(owner.userId, {
        agentId: owner.agentId,
        launch: LAUNCH.FIRST,
        text: "theirs",
        lineId,
      });

      const foreign = yield* queueRunnerLine(other.userId, {
        agentId: owner.agentId,
        launch: LAUNCH.FIRST,
        text: "intruder",
      });

      assert.ok(Option.isNone(foreign));
      assert.deepEqual(yield* textsPast(other.userId, owner.agentId, LAUNCH.FIRST), []);
      yield* acceptRunnerLine(other.userId, owner.agentId, lineId);
      assert.deepEqual(yield* textsPast(owner.userId, owner.agentId, LAUNCH.NEXT), ["theirs"]);
    }),
  );
});
