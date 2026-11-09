import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { MESSAGE_ROLE, TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { and, asc, eq } from "drizzle-orm";
import { Duration, Effect, Fiber, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { conversations, messages, turns } from "../../schemas/storage.js";
import {
  CONVERSATION_KIND,
  CONVERSATION_RUNTIME,
  MESSAGE_SENDER,
} from "../../storage-vocabulary.js";
import { getTestDB, startTask } from "../../testing/index.js";
import { createAgent, readNativeHanded, recordNativeHanded } from "../agent-store.js";
import {
  clearNativeRewindHanded,
  REWIND_REFUSAL,
  readNativeRewind,
  rewindConversation,
  rewindUnheard,
  UNHEARD_REFUSAL,
} from "../conversation-rewind.js";
import { ANY_LAUNCH, queueRunnerLine, runnerLinesPast } from "../runner-line-store.js";
import { storeWriter } from "../writer.js";

/**
 * A coding agent's conversation cut back to just before one of the
 * developer's lines, over a real dialect: the line and everything after it
 * go, what came before stays, the harness's cut is kept for the next launch,
 * a line no runner was handed is withdrawn from its queue with the cut, and
 * a line inside a turn, or another account's, is never cut at.
 * Synthetic accounts and conversations throughout.
 */

const openConversation = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
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
  const agent = Option.getOrThrow(started).agent;
  return { userId, conversationId: agent.conversationId };
});

type Target = Effect.Success<typeof openConversation>;

/** A turn queued at the instant given, settled. */
const turnAt = (target: Target, at: number) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(turns).values({
      id,
      ...target,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: new Date(at),
    });
    return id;
  });

/** A row of the conversation at the sequence given, by the role and turn given; answers its id. */
const rowAt = (
  target: Target,
  seq: number,
  role: typeof MESSAGE_ROLE.USER | typeof MESSAGE_ROLE.ASSISTANT,
  turnId: string | null,
  at: number,
  takenAfterStep: number | null = null,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(messages).values({
      id,
      ...target,
      seq,
      turnId,
      clientId: `client-${seq}`,
      role,
      parts: [{ type: "text", text: `row ${seq}` }],
      placedAt: new Date(at),
      createdAt: new Date(at),
      takenAfterStep,
    });
    return id;
  });

/** Two answered lines and a third awaiting its turn. */
const threeLines = (target: Target) =>
  Effect.gen(function* () {
    const first = yield* turnAt(target, 1_000);
    const firstLine = yield* rowAt(target, 1, MESSAGE_ROLE.USER, first, 1_000);
    yield* rowAt(target, 2, MESSAGE_ROLE.ASSISTANT, first, 1_001);
    const second = yield* turnAt(target, 2_000);
    const secondLine = yield* rowAt(target, 3, MESSAGE_ROLE.USER, second, 2_000);
    const answer = yield* rowAt(target, 4, MESSAGE_ROLE.ASSISTANT, second, 2_001);
    yield* rowAt(target, 5, MESSAGE_ROLE.USER, null, 3_000);
    return { first, firstLine, second, secondLine, answer };
  });

/** What stands of the conversation: its rows' sequences, its turns, and how it is marked. */
const standing = (target: Target) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({ seq: messages.seq })
      .from(messages)
      .where(eq(messages.conversationId, target.conversationId))
      .orderBy(asc(messages.seq));
    const turnRows = yield* db
      .select({ id: turns.id, status: turns.status })
      .from(turns)
      .where(eq(turns.conversationId, target.conversationId));
    const [conversation] = yield* db
      .select({
        journalRevision: conversations.journalRevision,
        rewoundRevision: conversations.rewoundRevision,
      })
      .from(conversations)
      .where(eq(conversations.id, target.conversationId));
    return {
      seqs: rows.map((row) => row.seq),
      turns: turnRows.map((row) => row.id),
      statuses: turnRows.map((row) => row.status),
      conversation,
    };
  });

/**
 * A Start's first line, written as its send writes it, with the turn it
 * awaits, and queued for whichever launch of the agent's runner reads first;
 * answers the line's row and what the runner's first launch reads.
 */
const firstLineQueued = (target: Target) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const clientKey = randomUUID();
    const writer = yield* storeWriter({ tools: {} });
    const written = yield* writer.writeAwaitingLine(
      target,
      { text: "Expire invitations after a week.", clientKey, sender: { kind: MESSAGE_SENDER.APP } },
      Effect.succeed(true),
    );
    const lineId = Option.getOrThrow(Result.getOrThrow(written)).id;
    const [agent] = yield* db
      .select({ id: agentTable.id })
      .from(agentTable)
      .where(eq(agentTable.conversationId, target.conversationId));
    const agentId = agent?.id ?? "";
    yield* queueRunnerLine(target.userId, {
      agentId,
      launch: ANY_LAUNCH,
      text: '{"type":"message"}',
      lineId: sentLineId(clientKey),
    });
    const read = Effect.map(
      runnerLinesPast(target.userId, agentId, { launch: 1, after: 0, limit: 10 }),
      (lines) => lines.length,
    );
    return { lineId, read };
  });

it.layer(getTestDB())("rewinding a coding agent's conversation", (it) => {
  it.effect("drops the line named and everything after it, and keeps what came before", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const { first, second, secondLine } = yield* threeLines(target);

      const rewound = yield* rewindConversation(target, secondLine);
      const after = yield* standing(target);

      assert.deepEqual(Result.getOrThrow(rewound), { clientId: "client-3", turnIds: [second] });
      assert.deepEqual(after.seqs, [1, 2]);
      assert.deepEqual(after.turns, [first]);
      assert.deepEqual(after.conversation, { journalRevision: 1, rewoundRevision: 1 });
    }),
  );

  it.effect(
    "cuts at the first line, leaving the conversation empty for the words sent in its place",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const { first, firstLine } = yield* threeLines(target);

        const rewound = yield* rewindConversation(target, firstLine);
        const after = yield* standing(target);

        assert.equal(Result.getOrThrow(rewound).clientId, "client-1");
        assert.deepEqual(after.seqs, []);
        // The first turn's row stands, settled and empty, so the agent reads as one that ran rather than one that never started.
        assert.deepEqual(after.turns, [first]);
        assert.deepEqual(after.statuses, [TURN_STATUS.SETTLED]);
        assert.deepEqual(yield* readNativeRewind(target), Option.some("client-1"));
      }),
  );

  it.effect(
    "waits for a hand-over under way to end however long its runtime takes, cutting nothing meanwhile, and cuts once it has",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const db = yield* Database;
        const { first, secondLine } = yield* threeLines(target);
        const before = yield* standing(target);
        // A hand-over's claim taken now, which its holder clears once its runtime answers.
        yield* db
          .update(conversations)
          .set({ dispatchClaim: randomUUID(), dispatchClaimedAt: new Date(0) })
          .where(eq(conversations.id, target.conversationId));

        const cutting = yield* Effect.forkChild(rewindConversation(target, secondLine));
        // The clock moves a step at a time, a round trip apart, so the wait passes on a real Postgres too.
        const passing = (until: () => boolean) =>
          Effect.gen(function* () {
            while (!until()) {
              yield* TestClock.adjust(Duration.millis(100));
              yield* standing(target);
            }
          });
        let steps = 0;
        // Twenty seconds on, longer than a send waits for a claim, the cut is still waiting.
        yield* passing(() => cutting.pollUnsafe() !== undefined || ++steps > 200);
        const pendingMeanwhile = cutting.pollUnsafe() === undefined;
        const meanwhile = yield* standing(target);
        yield* db
          .update(conversations)
          .set({ dispatchClaim: null, dispatchClaimedAt: null })
          .where(eq(conversations.id, target.conversationId));
        yield* passing(() => cutting.pollUnsafe() !== undefined);

        assert.ok(pendingMeanwhile);
        assert.deepEqual(meanwhile, before);
        assert.ok(Result.isSuccess(yield* Fiber.join(cutting)));
        assert.deepEqual((yield* standing(target)).turns, [first]);
      }),
  );

  it.effect(
    "keeps the line's id for the next launch until it is handed over, and clears what the turns' messages handed",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const { secondLine } = yield* threeLines(target);
        yield* recordNativeHanded(target, { spoken: true, task: "task-key" });

        yield* rewindConversation(target, secondLine);
        const waiting = yield* readNativeRewind(target);
        const turnsHanded = yield* readNativeHanded(target);
        yield* clearNativeRewindHanded(target.conversationId, "client-3");
        const handed = yield* readNativeRewind(target);

        assert.deepEqual(waiting, Option.some("client-3"));
        assert.equal(turnsHanded, null);
        assert.deepEqual(handed, Option.none());
      }),
  );

  it.effect("cuts the harness at the earliest heard line, never at one it did not hear", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const { firstLine, secondLine } = yield* threeLines(target);

      yield* rewindConversation(target, secondLine);
      yield* rewindConversation(target, firstLine);
      const unheard = yield* rowAt(target, 6, MESSAGE_ROLE.USER, null, 4_000);
      yield* rewindConversation(target, unheard);

      assert.deepEqual(yield* readNativeRewind(target), Option.some("client-1"));
      assert.deepEqual((yield* standing(target)).seqs, []);
    }),
  );

  it.effect("cuts an awaiting line alone, leaving every turn", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const { first, second } = yield* threeLines(target);
      const [awaiting] = yield* (yield* Database)
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, target.conversationId),
            eq(messages.clientId, "client-5"),
          ),
        );

      const rewound = yield* rewindConversation(target, awaiting?.id ?? "");
      const after = yield* standing(target);

      assert.deepEqual(Result.getOrThrow(rewound).turnIds, []);
      assert.deepEqual(after.seqs, [1, 2, 3, 4]);
      assert.deepEqual(after.turns.toSorted(), [first, second].toSorted());
    }),
  );

  it.effect(
    "cuts a first line no runner was handed with nothing heard, withdrawing it from the runner's queue",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const { lineId, read } = yield* firstLineQueued(target);

        const rewound = yield* rewindUnheard(target, lineId);

        assert.ok(Result.isSuccess(rewound));
        assert.deepEqual((yield* standing(target)).seqs, []);
        assert.equal(yield* read, 0);
      }),
  );

  it.effect("cuts nothing with nothing heard once a runner's read was handed the line", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const { lineId, read } = yield* firstLineQueued(target);
      const before = yield* standing(target);
      assert.equal(yield* read, 1);

      const refused = yield* rewindUnheard(target, lineId);

      assert.deepEqual(refused, Result.fail(UNHEARD_REFUSAL.HEARD));
      assert.deepEqual(yield* standing(target), before);
    }),
  );

  it.effect("refuses a line a turn under way took in, and an agent's answer", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const { second, answer } = yield* threeLines(target);
      const steered = yield* rowAt(target, 6, MESSAGE_ROLE.USER, second, 2_002, 1);

      const inside = yield* rewindConversation(target, steered);
      const notALine = yield* rewindConversation(target, answer);

      assert.deepEqual(inside, Result.fail(REWIND_REFUSAL.INSIDE_TURN));
      assert.deepEqual(notALine, Result.fail(REWIND_REFUSAL.NOT_FOUND));
      assert.deepEqual((yield* standing(target)).seqs, [1, 2, 3, 4, 5, 6]);
    }),
  );

  it.effect(
    "deletes the workers a dropped turn delegated, and keeps those delegated before it",
    () =>
      Effect.gen(function* () {
        const target = yield* openConversation;
        const { secondLine } = yield* threeLines(target);
        const db = yield* Database;
        const worker = (at: number) =>
          Effect.gen(function* () {
            const id = randomUUID();
            yield* db.insert(conversations).values({
              id,
              userId: target.userId,
              kind: CONVERSATION_KIND.CHILD,
              parentConversationId: target.conversationId,
              createdAt: new Date(at),
            });
            return id;
          });
        const kept = yield* worker(1_500);
        yield* worker(2_500);

        yield* rewindConversation(target, secondLine);
        const rows = yield* db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.parentConversationId, target.conversationId));

        assert.deepEqual(
          rows.map((row) => row.id),
          [kept],
        );
      }),
  );

  it.effect("never cuts another account's conversation", () =>
    Effect.gen(function* () {
      const target = yield* openConversation;
      const stranger = yield* openConversation;
      const { secondLine } = yield* threeLines(target);

      const refused = yield* rewindConversation(
        { userId: stranger.userId, conversationId: target.conversationId },
        secondLine,
      );

      assert.deepEqual(refused, Result.fail(REWIND_REFUSAL.NOT_FOUND));
      assert.deepEqual((yield* standing(target)).seqs, [1, 2, 3, 4, 5]);
    }),
  );
});
