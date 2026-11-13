import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readAgent } from "@repo/database/models/agent-store";
import { agentTable } from "@repo/database/schemas/agent";
import { messages } from "@repo/database/schemas/storage";
import { getTestDB } from "@repo/database/testing";
import { RUN_STATUS } from "@repo/features/turn-run";
import { LIVE_CLIENT_EVENT, LIVE_SERVER_EVENT } from "@repo/features/voice-delegation";
import { memorySandbox } from "@repo/sandbox/testing";
import { asc, eq } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer, Option, Queue } from "effect";
import {
  SESSION_CANCEL_OUTCOME,
  SESSION_RESET_OUTCOME,
  SESSION_SEND_OUTCOME,
} from "../agents/sessions/agent-sessions.js";
import { HostedEnvironment } from "../environment.js";
import { Sync, type SyncService } from "../sync/watch.js";
import { endedAt } from "../testing/agent-turns.js";
import { githubReaching } from "../testing/github-app-fake.js";
import { scriptedHarnessLayer } from "../testing/native-harness-fake.js";
import {
  fakeLiveSession,
  openVoiceCall,
  VOICE_CALLER_ENVIRONMENT,
} from "../testing/voice-callers.js";
import { voiceCallDelegations } from "./voice-call-delegations.js";
import { holdVoiceCall, VOICE_CALL_HELD, type VoiceCallObserver } from "./voice-call-lease.js";

/**
 * A voice call's delegations run by the lease holding it, over a fake
 * GPT-Live session and a harness that writes down what the agent is sent,
 * on a real dialect: each line of the call is stored once, in the order it
 * was said, with its span on the session's clock; a delegation starts one
 * turn on the caller's lines; and a lease that takes the call over mid-line
 * and between replies grows the line in place and tells each reply once.
 *
 * Synthetic accounts, sessions, and words throughout.
 */

/** The agent's harness, each launch and message it takes handed to the test. */
function takingHarness(taken: Queue.Queue<string>) {
  return scriptedHarnessLayer(() => ({
    open: () =>
      Effect.as(Queue.offer(taken, "open"), {
        outcome: SESSION_SEND_OUTCOME.ACCEPTED,
        sessionId: `claude-code:${randomUUID()}`,
      } as const),
    send: (sessionId) =>
      Effect.as(Queue.offer(taken, "send"), {
        outcome: SESSION_SEND_OUTCOME.ACCEPTED,
        sessionId,
        deliveryId: randomUUID(),
      } as const),
    cancel: () => Effect.succeed({ outcome: SESSION_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: SESSION_RESET_OUTCOME.RESET }),
  }));
}

/** Sync as the test drives it: every watch woken by `wake`, and by nothing else. */
function wakeableSync() {
  const watches = new Set<Queue.Queue<void>>();

  const sync: SyncService = {
    watch: () =>
      Effect.gen(function* () {
        const woken = yield* Queue.unbounded<void>();
        watches.add(woken);
        yield* Effect.addFinalizer(() => Effect.sync(() => watches.delete(woken)));

        return { next: Effect.as(Queue.take(woken), []), heardAt: Effect.succeed(Option.none()) };
      }),
  };

  const wake = Effect.suspend(() =>
    Effect.forEach([...watches], (woken) => Queue.offer(woken, undefined), { discard: true }),
  );

  return { layer: Layer.succeed(Sync, sync), wake };
}

/** The call's delegations, the test told once the holder has claimed the call and set out. */
const settingOut = (ready: Deferred.Deferred<void>) =>
  ((holder) =>
    Effect.tap(voiceCallDelegations(holder), () =>
      Deferred.succeed(ready, undefined),
    )) satisfies VoiceCallObserver<unknown>;

/** A call opened on an agent with no repository, so a send to it asks GitHub nothing. */
const openCall = Effect.gen(function* () {
  const opened = yield* openVoiceCall;
  const db = yield* Database;
  yield* db.update(agentTable).set({ repository: null }).where(eq(agentTable.id, opened.agentId));

  return opened;
});

/** The call's lines as the conversation stores them, in its order: who said them, their words, and their span. */
const storedLines = (agentId: string, callId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const [agent] = yield* db
      .select({ conversationId: agentTable.conversationId })
      .from(agentTable)
      .where(eq(agentTable.id, agentId));

    assert.ok(agent);

    const rows = yield* db
      .select({ role: messages.role, parts: messages.parts, metadata: messages.metadata })
      .from(messages)
      .where(eq(messages.conversationId, agent.conversationId))
      .orderBy(asc(messages.seq));

    return rows.flatMap(({ role, parts, metadata }) => {
      if (metadata === null || !("voice_session_id" in metadata)) return [];

      if (metadata.voice_session_id !== callId) return [];
      const [part] = parts;
      const words = part !== undefined && "text" in part ? part.text : "";
      const span = "to_ms" in metadata ? [metadata.from_ms, metadata.to_ms] : [];

      return [{ role, words, span }];
    });
  });

/** A fragment of the transcript, over the span given. */
const fragment = (delta: string, startMs: number, endMs: number) => ({
  delta,
  start_ms: startMs,
  end_ms: endMs,
});

/** The next commentary the voice is told, skipping quiet thinking. */
const nextCommentary = (told: Queue.Queue<{ readonly type: string }>) =>
  Effect.gen(function* () {
    while (true) {
      const event = yield* Queue.take(told);

      if (event.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND && "content" in event) {
        return event.content;
      }
    }
  });

/** A test's world: the caller's key opened. */
const world = Layer.succeed(HostedEnvironment, VOICE_CALLER_ENVIRONMENT);

const SUITE = Layer.mergeAll(getTestDB(), githubReaching([]).layer, memorySandbox().layer);

it.layer(SUITE)("a voice call's delegations, run by the lease holding it", (it) => {
  it.effect(
    "each line is stored once, in the order it was said, with its span, and a delegation starts one turn on the caller's lines",
    () =>
      Effect.gen(function* () {
        const { call, callerId, agentId } = yield* openCall;
        const session = fakeLiveSession(undefined);
        const taken = yield* Queue.unbounded<string>();
        const sync = wakeableSync();
        const ready = yield* Deferred.make<void>();

        const caller = LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA;
        const voice = LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA;

        const run = Effect.gen(function* () {
          const holder = yield* Effect.forkChild(
            holdVoiceCall(
              { callId: call.id, callerId, epoch: 1, redelivered: false },
              settingOut(ready),
            ),
          );

          yield* Deferred.await(ready);
          yield* session.say(caller, fragment("What's left", 0, 400));
          yield* session.say(caller, fragment(" on the task?", 400, 900));
          yield* session.say(voice, fragment("Only the docs.", 1200, 1800));
          yield* session.say(caller, fragment("Then write them.", 2400, 3000));
          yield* session.say(LIVE_SERVER_EVENT.DELEGATION_CREATED, {
            delegation: { id: "item_1" },
          });

          assert.equal(yield* Queue.take(taken), "open");
          yield* Fiber.interrupt(holder);
        });

        yield* run.pipe(
          Effect.provide(Layer.mergeAll(sync.layer, takingHarness(taken), session.layer)),
        );

        assert.equal(yield* Queue.size(taken), 0);

        assert.deepEqual(yield* storedLines(agentId, call.id), [
          { role: "user", words: "What's left on the task?", span: [0, 900] },
          { role: "assistant", words: "Only the docs.", span: [1200, 1800] },
          { role: "user", words: "Then write them.", span: [2400, 3000] },
        ]);
      }).pipe(Effect.provide(world)),
  );

  it.effect(
    "a lease that takes the call over mid-line and between replies grows the line in place, tells each reply once, and starts one turn",
    () =>
      Effect.gen(function* () {
        const { call, callerId, agentId } = yield* openCall;
        const told = yield* Queue.unbounded<{ readonly type: string }>();
        const session = fakeLiveSession(undefined, told);
        const taken = yield* Queue.unbounded<string>();
        const sync = wakeableSync();
        const firstReady = yield* Deferred.make<void>();
        const nextReady = yield* Deferred.make<void>();
        const agent = Option.getOrThrow(yield* readAgent(callerId, agentId));
        const caller = LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA;

        const run = Effect.gen(function* () {
          const first = yield* Effect.forkChild(
            holdVoiceCall(
              { callId: call.id, callerId, epoch: 1, redelivered: false },
              settingOut(firstReady),
            ),
          );

          yield* Deferred.await(firstReady);
          yield* session.say(caller, fragment("Run the", 0, 500));

          // The agent answers a turn while the first lease holds the call.
          yield* endedAt(agent, RUN_STATUS.SUCCEEDED, 1_000, "The build is green.");
          yield* sync.wake;
          assert.equal(yield* nextCommentary(told), "The build is green.");

          // The next lease attaches, hearing the session's last events again, and claims the call.
          const next = yield* Effect.forkChild(
            holdVoiceCall(
              { callId: call.id, callerId, epoch: 2, redelivered: false },
              settingOut(nextReady),
            ),
          );

          yield* Deferred.await(nextReady);
          yield* session.say(caller, fragment(" tests.", 500, 900));
          assert.equal(yield* Fiber.join(first), VOICE_CALL_HELD.STALE);

          yield* endedAt(agent, RUN_STATUS.SUCCEEDED, 2_000, "Two tests failed.");
          yield* sync.wake;
          assert.equal(yield* nextCommentary(told), "Two tests failed.");

          yield* session.say(LIVE_SERVER_EVENT.DELEGATION_CREATED, {
            delegation: { id: "item_1" },
          });
          assert.equal(yield* Queue.take(taken), "open");
          yield* Fiber.interrupt(next);
        });

        yield* run.pipe(
          Effect.provide(Layer.mergeAll(sync.layer, takingHarness(taken), session.layer)),
        );

        assert.equal(yield* Queue.size(taken), 0);
        assert.deepEqual(yield* storedLines(agentId, call.id), [
          { role: "user", words: "Run the tests.", span: [0, 900] },
        ]);

        // Nothing more was told, so neither reply was told twice.
        assert.equal(yield* Queue.size(told), 0);
      }).pipe(Effect.provide(world)),
  );
});
