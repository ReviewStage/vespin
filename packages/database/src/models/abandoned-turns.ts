import { RUN_EVENT, RUN_STATUS, TURN_FAILURE } from "@repo/features/turn-run";
import { sessionKey } from "@repo/runtime/vocabulary";
import { TURN_OPEN } from "@repo/wire";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { conversations, turns } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import { dropNativeProjectionTurns } from "./native-projection-store.js";
import { STORE_WRITE_EFFECT, type StoreWriter } from "./writer.js";

/**
 * abandoned-turns.ts -- the turns whose end is not coming, settled through the write the runner's own end takes.
 *
 * A turn moves to running when its runner opens it and settles when its
 * runner's end lands; a runner gone without its end (its sandbox stopped, its
 * Mac asleep or gone, a post refused for good) leaves the row open and its
 * journal open. The minute sweep's reconcile settles such a turn once it
 * stands past its deadline (`./turn-state.ts`), failed with the word for
 * why, or canceled where a Stop was asked of it (`settleLapsedTurns`); a
 * runner whose end the service knows of first, a launch that failed or a Mac
 * that settled its run, settles its turns at once (`settleRunnerLostTurns`),
 * as a coding agent's turn whose session its harness says no longer runs is
 * (`settleEndedSessionTurn`). Each settle goes through
 * the store writer's own end, naming the attempt the turn was read under, so
 * its journal is finished and its unanswered parts settled exactly as a
 * failed turn's are, a turn a newer launch took since is left to it, and an
 * end that lands later finds the row terminal and is repeated, not written.
 */

const LostTurnSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  conversationId: Schema.String,
  attempt: Schema.Number,
});

const AbandonedTurnRowSchema = Schema.Struct({
  ...LostTurnSchema.fields,
  status: Schema.String,
  cancelRequestedAt: Schema.NullOr(Schema.Date),
});

/** What every read of turns to settle selects: a lost turn and the attempt it runs under, where it stands, and when a Stop was asked of it. */
const ABANDONED_TURN_COLUMNS = {
  id: turns.id,
  userId: turns.userId,
  conversationId: turns.conversationId,
  attempt: turns.attempt,
  status: turns.status,
  cancelRequestedAt: turns.cancelRequestedAt,
};

/** A turn joined to the conversation it stands in. */
const TURN_CONVERSATION = eq(conversations.id, turns.conversationId);

/** A turn whose end is not coming: its id, the conversation and account it stands in, and the attempt it was read under. */
export type LostTurn = typeof LostTurnSchema.Type;

/** How a lost turn ends: canceled where its Stop went unconfirmed, failed for the reason given otherwise. */
export type LostTurnEnd =
  | { readonly status: typeof RUN_STATUS.CANCELED }
  | {
      readonly status: typeof RUN_STATUS.FAILED;
      readonly failure: typeof TURN_FAILURE.SESSION_ENDED;
      readonly failureDetail?: string;
    }
  | {
      readonly status: typeof RUN_STATUS.FAILED;
      readonly failure: LostRunnerFailure;
      readonly failureDetail: string;
    };

/** The words a turn whose runner went away fails with: lost, past its deadline as its state, as a run its launch said failed, as one its plan's limit cut short that no launch took up again, or as one whose runner the service cut off by refusing its events as too large. */
export type LostRunnerFailure =
  | typeof TURN_FAILURE.MODEL
  | typeof TURN_FAILURE.LINE_UNTAKEN
  | typeof TURN_FAILURE.NO_PROGRESS
  | typeof TURN_FAILURE.RUNNER_LOST
  | typeof TURN_FAILURE.DEADLINE
  | typeof TURN_FAILURE.PLAN_LIMIT
  | typeof TURN_FAILURE.EVENTS_TOO_LARGE;

/** What a native agent's turn whose runner went away says it failed of, as a runner's own failed end says why; a caller that knows how the runner ended appends that after it. */
export const RUNNER_LOST_DETAIL = "the agent's runner stopped before its turn ended";

/** The turns still queued or running of the standing coding agent's conversation named, oldest first. */
const agentRunningTurns = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: AbandonedTurnRowSchema,
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select(ABANDONED_TURN_COLUMNS)
        .from(turns)
        .innerJoin(conversations, TURN_CONVERSATION)
        .where(
          and(
            eq(turns.conversationId, conversationId),
            eq(conversations.kind, CONVERSATION_KIND.AGENT),
            inArray(turns.status, [...TURN_OPEN]),
          ),
        )
        .orderBy(asc(turns.queuedAt), asc(turns.id)),
    ),
});

/**
 * The turn settled as the end given, through the write the
 * relay's own end takes, under the attempt it was read under, and, for a
 * reap, only while it still stands lapsed at the instant it was read so;
 * whether this write settled it, a turn already ended, or moved on since,
 * being a repeat. The end stands alone in the turn's sequence: the relay's
 * count of what it told is not known here, and the writer settles the row by
 * the turn's id. A write the writer refused is logged by its word, since the
 * turn it leaves running would otherwise say nothing of why.
 */
const settledLost = (
  writer: Pick<StoreWriter, "consume">,
  turn: LostTurn,
  end: LostTurnEnd,
  now: number,
  lapsedAt?: number,
) =>
  Effect.gen(function* () {
    const written = yield* writer.consume(
      { userId: turn.userId, conversationId: turn.conversationId },
      {
        kind: RUN_EVENT.TURN_ENDED,
        conversationId: sessionKey(turn.conversationId),
        turnId: turn.id,
        sequence: 1,
        ...end,
        responseIds: [],
        at: now,
        attempt: turn.attempt,
        ...(lapsedAt === undefined ? undefined : { lapsedAt }),
      },
    );

    if (Result.isFailure(written)) {
      yield* Effect.logWarning(`a lost turn's settle was refused: ${written.failure.refusal}`).pipe(
        Effect.annotateLogs({ conversationId: turn.conversationId, turnId: turn.id }),
      );

      return false;
    }

    return written.success === STORE_WRITE_EFFECT.WRITTEN;
  });

/**
 * Settles the coding agent's turn named as failed because its session ended
 * for good, as its harness answered a message to it, at `now`; answers whether this
 * call settled it. Only the turn named is settled, and only while it still
 * stands queued or running, under the attempt it is read under now, so a
 * turn that ended meanwhile keeps its own end and a newer turn is never
 * touched.
 */
export const settleEndedSessionTurn = /* @__PURE__ */ Effect.fn("web/settleEndedSessionTurn")(
  function* (
    writer: Pick<StoreWriter, "consume">,
    named: Omit<LostTurn, "attempt">,
    now: number,
  ): Effect.fn.Return<boolean, StoreFailure, DatabaseServices> {
    const open = (yield* agentRunningTurns({ conversationId: named.conversationId })).find(
      (turn) => turn.id === named.id,
    );

    if (open === undefined) return false;

    return yield* settledLost(
      writer,
      { ...named, attempt: open.attempt },
      { status: RUN_STATUS.FAILED, failure: TURN_FAILURE.SESSION_ENDED },
      now,
    );
  },
);

/**
 * Settles every turn still queued or running of the native coding agent's
 * conversation as failed, its runner gone with no end told, as a runner's
 * own failed end settles one, or as canceled where a Stop was asked of it, so the agent reads failed and offers Continue
 * rather than running for a day; answers the ids of the turns this call
 * settled as failed, so a caller logs and reports those and no canceled
 * one or one the writer refused. The
 * turn the native projection holds is dropped with them, so the next
 * launch's events open a turn of their own rather than one already ended.
 * A launch that failed before its runner ran names why in `detail`. Where
 * `only` is given, just the turns it names are settled, so a caller that
 * read which turns were lost at one instant (`runningTurnIds`) leaves alone
 * a turn begun since. Where the runner can never be reached again, as for
 * an agent its device will not start, the turns fail as a session that
 * ended (`failure`), which leaves nothing awaiting a turn and offers only a
 * new agent.
 */
export const settleRunnerLostTurns = /* @__PURE__ */ Effect.fn("web/settleRunnerLostTurns")(
  function* (
    writer: Pick<StoreWriter, "consume">,
    conversationId: string,
    now: number,
    detail: string = RUNNER_LOST_DETAIL,
    only?: ReadonlySet<string>,
    failure: LostRunnerFailure | typeof TURN_FAILURE.SESSION_ENDED = TURN_FAILURE.MODEL,
  ): Effect.fn.Return<readonly string[], StoreFailure, DatabaseServices> {
    const running = yield* agentRunningTurns({ conversationId });
    const lost = only === undefined ? running : running.filter((turn) => only.has(turn.id));
    const failed: string[] = [];

    for (const { cancelRequestedAt, status: _status, ...turn } of lost) {
      const written = yield* settledLost(
        writer,
        turn,
        cancelRequestedAt === null
          ? { status: RUN_STATUS.FAILED, failure, failureDetail: detail }
          : { status: RUN_STATUS.CANCELED },
        now,
      );

      if (written && cancelRequestedAt === null) failed.push(turn.id);
    }

    yield* dropNativeProjectionTurns(
      conversationId,
      lost.map((turn) => turn.id),
    );

    return failed;
  },
);

/** A turn read lapsed at an instant, and how it ends. */
export interface LapsedTurnEnd {
  readonly turn: LostTurn;
  readonly end: LostTurnEnd;
}

/**
 * Settles the conversation's turns read lapsed at `lapsedAt`, each as its
 * end says, at `now`: a compare-and-set on each turn's status, its attempt,
 * and its standing lapsed at that instant still, so a turn its runner moved
 * on since, or a newer launch took, keeps running. The turn the native
 * projection holds is dropped with each one settled, so the next launch's
 * events open a turn of their own. Answers the ids of the turns this call
 * settled.
 */
export const settleLapsedTurns = /* @__PURE__ */ Effect.fn("web/settleLapsedTurns")(function* (
  writer: Pick<StoreWriter, "consume">,
  conversationId: string,
  lapsed: readonly LapsedTurnEnd[],
  lapsedAt: number,
  now: number,
): Effect.fn.Return<readonly string[], StoreFailure, DatabaseServices> {
  const settled: string[] = [];

  for (const { turn, end } of lapsed) {
    if (yield* settledLost(writer, turn, end, now, lapsedAt)) settled.push(turn.id);
  }

  yield* dropNativeProjectionTurns(conversationId, settled);

  return settled;
});

/** The ids of the turns still queued or running of the coding agent's conversation named, for a later settle of just those (`settleRunnerLostTurns`'s `only`). */
export function runningTurnIds(
  conversationId: string,
): Effect.Effect<readonly string[], StoreFailure, DatabaseServices> {
  return Effect.map(agentRunningTurns({ conversationId }), (rows) => rows.map((row) => row.id));
}
