import { RUN_EVENT, RUN_STATUS, TURN_FAILURE } from "@repo/features/turn-run";
import { sessionKey } from "@repo/runtime/vocabulary";
import { TURN_STATUS } from "@repo/wire";
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
 * as a coding agent's turn whose session the runtime says no longer runs is
 * (`settleEndedSessionTurn`, `settleEndedSession`). Each settle goes through
 * the store writer's own end, naming the attempt the turn was read under, so
 * its journal is finished and its unanswered parts settled exactly as a
 * failed turn's are, a turn a newer launch took since is left to it, and an
 * end that lands later finds the row terminal and is repeated, not written.
 */

const LOST_TURNS = {
  /** The most turns one read of an ended session takes; reads go on until none is left. */
  LIMIT: 50,
} as const;

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

/**
 * The turns still queued or running of the standing coding agent's
 * conversation that records the runtime session, oldest first, each with
 * when a Stop was asked of it. A
 * conversation that has since recorded a newer session no longer names this
 * one, so its turns, which are the newer session's, are never read here.
 */
const endedSessionTurns = SqlSchema.findAll({
  Request: Schema.Struct({ runtimeSessionId: Schema.String, limit: Schema.Int }),
  Result: AbandonedTurnRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select(ABANDONED_TURN_COLUMNS)
        .from(turns)
        .innerJoin(conversations, TURN_CONVERSATION)
        .where(
          and(
            eq(conversations.runtimeSessionId, request.runtimeSessionId),
            eq(conversations.kind, CONVERSATION_KIND.AGENT),
            inArray(turns.status, [TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]),
          ),
        )
        .orderBy(asc(turns.queuedAt), asc(turns.id))
        .limit(request.limit),
    ),
});

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

/** The words a turn whose runner went away fails with: lost, past its deadline as its state, as a run its launch said failed, or as one its plan's limit cut short that no launch took up again. */
export type LostRunnerFailure =
  | typeof TURN_FAILURE.MODEL
  | typeof TURN_FAILURE.LINE_UNTAKEN
  | typeof TURN_FAILURE.NO_PROGRESS
  | typeof TURN_FAILURE.RUNNER_LOST
  | typeof TURN_FAILURE.DEADLINE
  | typeof TURN_FAILURE.PLAN_LIMIT;

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
            inArray(turns.status, [TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]),
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
 * for good, as eve answered a message to it, at `now`; answers whether this
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

export interface EndedSessionOptions {
  readonly now: number;
  /** Why eve said the session failed, redacted and bounded, kept on each turn failed for it; nothing for a session that only expired. */
  readonly failureDetail?: string | undefined;
  /** The most turns one read takes; `LOST_TURNS.LIMIT` otherwise. Reads go on until none is left. */
  readonly limit?: number | undefined;
}

/**
 * Settles every turn still queued or running of the coding agent's
 * conversation that records the runtime session eve said ended; answers how
 * many this call settled. A turn a Stop was asked of is settled canceled,
 * as the developer asked and as the sweep would settle it, and every other
 * one failed for its session's end, keeping why eve said it failed where it
 * said, and logged with its ids. A session no standing coding agent's
 * conversation records, such as an unknown one or one its conversation
 * rotated away from, settles nothing. Each turn is settled through the
 * relay's own end, so a turn that ended between the read and the write
 * keeps its own end and a repeat of the same end settles nothing again.
 * The turns are read a bounded batch at a time until a batch comes back
 * short: a turn that ended meanwhile, by this call or another writer, drops
 * out of the next read. A batch holding only turns already read, which a
 * write the writer refused leaves open, ends the reads too, so they never
 * go round for ever.
 */
export const settleEndedSession = /* @__PURE__ */ Effect.fn("web/settleEndedSession")(function* (
  writer: Pick<StoreWriter, "consume">,
  runtimeSessionId: string,
  options: EndedSessionOptions,
): Effect.fn.Return<number, StoreFailure, DatabaseServices> {
  const limit = options.limit ?? LOST_TURNS.LIMIT;
  let settled = 0;
  const read = new Set<string>();
  for (;;) {
    const lost = yield* endedSessionTurns({ runtimeSessionId, limit });
    if (lost.every((turn) => read.has(turn.id))) return settled;
    for (const { cancelRequestedAt, status: _status, ...turn } of lost) {
      read.add(turn.id);
      const { failureDetail } = options;
      const written = yield* settledLost(
        writer,
        turn,
        cancelRequestedAt === null
          ? {
              status: RUN_STATUS.FAILED,
              failure: TURN_FAILURE.SESSION_ENDED,
              ...(failureDetail !== undefined ? { failureDetail } : undefined),
            }
          : { status: RUN_STATUS.CANCELED },
        options.now,
      );
      if (!written) continue;
      settled += 1;
      if (cancelRequestedAt !== null) continue;
      yield* Effect.logError(
        `a turn was settled failed for its session's end: ${failureDetail ?? "the session expired"}`,
      ).pipe(
        Effect.annotateLogs({
          conversationId: turn.conversationId,
          turnId: turn.id,
          failure: TURN_FAILURE.SESSION_ENDED,
        }),
      );
    }
    if (lost.length < limit) return settled;
  }
});

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
