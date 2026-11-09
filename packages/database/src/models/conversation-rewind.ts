import { MESSAGE_ROLE, TURN_STATUS } from "@repo/wire";
import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import {
  DISPATCH_CLAIM,
  DispatchClaimHeld,
  dispatchClaimStands,
  waitingOutDispatchClaim,
} from "./dispatch-claim.js";
import { withdrawUnhandedLines } from "./runner-line-store.js";
import { settleKeptTurn } from "./turn-state.js";
import type { ConversationTarget } from "./writer.js";

/**
 * conversation-rewind.ts -- a coding agent's conversation cut back to just before one of the developer's lines.
 *
 * A rewind drops the line named and everything after it: the turn it
 * opened and every later turn, with every row they wrote, and every row no
 * turn owns from the line on. A cut at the first line keeps the first
 * turn's row, its rows gone and settled, since an agent with no turn at all
 * reads as one that never started. It counts the journal revision up and marks
 * the conversation rewound at it, so a reader holding an older cursor
 * reads the transcript afresh rather than joining what it holds, and
 * keeps the line's client id for the next launch of a Claude Code or
 * Codex runner to cut the harness's own session before, and clears what
 * that session's turns' messages handed it (`native_handed`), since the
 * cut may drop the turns that handed it, so the next message hands the
 * call's words and the task again. A line no turn
 * took yet never reached the harness's session, so a cut at one leaves a
 * cut still waiting for a launch as it stands, since that one is earlier.
 *
 * Only a line that opened its turn, or awaits one, can be cut at: a line
 * a turn under way took in after its first step sits inside that turn's
 * work, which no harness can cut through.
 *
 * A cut may be asked to drop only what no runner heard (`rewindUnheard`):
 * every line it drops still queued for the agent's runner and never handed
 * to one, and every turn it drops still queued. Its lines are withdrawn from
 * the runner's queue in the cut's own transaction (`withdrawUnhandedLines`),
 * so nothing the cut drops reaches a runner, and its caller has nothing to
 * stop: a launch under way, as a Start's while its sandbox opens, goes on
 * and reads whatever is sent in their place. Where anything it would drop
 * may have been heard, it cuts nothing and answers so.
 */

/** Why a line cannot be cut at. */
export const REWIND_REFUSAL = {
  /** No developer's line of that id stands in the conversation. */
  NOT_FOUND: "not_found",
  /** The line was taken into a turn already under way, or shares its turn with an earlier line. */
  INSIDE_TURN: "inside_turn",
  /** A hand-over to the agent stayed under way for as long as the cut waits for it to end; nothing was cut. */
  BUSY: "busy",
} as const;

export type RewindRefusal = (typeof REWIND_REFUSAL)[keyof typeof REWIND_REFUSAL];

/** Why a cut asked to drop only what no runner heard cuts nothing, beside why any cut is refused. */
export const UNHEARD_REFUSAL = {
  ...REWIND_REFUSAL,
  /** Something the cut would drop may have reached a runner; nothing was cut. */
  HEARD: "heard",
} as const;

export type UnheardRefusal = (typeof UNHEARD_REFUSAL)[keyof typeof UNHEARD_REFUSAL];

/** What a rewind cut: the line's client id and words' place, and the turns it dropped. */
export interface ConversationRewound {
  readonly clientId: string;
  readonly turnIds: readonly string[];
}

const lockConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
        .for("update"),
    ),
});

const findLine = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, messageId: Schema.String }),
  Result: Schema.Struct({
    seq: Schema.Number,
    clientId: Schema.String,
    turnId: Schema.NullOr(Schema.String),
    takenAfterStep: Schema.NullOr(Schema.Number),
    createdAt: Schema.Date,
  }),
  execute: ({ conversationId, messageId }) =>
    Database.use((db) =>
      db
        .select({
          seq: messages.seq,
          clientId: messages.clientId,
          turnId: messages.turnId,
          takenAfterStep: messages.takenAfterStep,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.id, messageId),
            eq(messages.role, MESSAGE_ROLE.USER),
          ),
        ),
    ),
});

/** The developer's lines a turn took, oldest first, which tells the line that opened it. */
const findTurnLines = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, turnId: Schema.String }),
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: ({ conversationId, turnId }) =>
    Database.use((db) =>
      db
        .select({ seq: messages.seq })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.turnId, turnId),
            eq(messages.role, MESSAGE_ROLE.USER),
          ),
        )
        .orderBy(messages.seq),
    ),
});

const findTurnQueuedAt = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, turnId: Schema.String }),
  Result: Schema.Struct({ queuedAt: Schema.Date }),
  execute: ({ conversationId, turnId }) =>
    Database.use((db) =>
      db
        .select({ queuedAt: turns.queuedAt })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), eq(turns.id, turnId))),
    ),
});

const findTurnsFrom = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, from: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, from }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), gte(turns.queuedAt, from)))
        .orderBy(asc(turns.queuedAt), asc(turns.id)),
    ),
});

const findTurnBefore = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, from: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, from }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), lt(turns.queuedAt, from)))
        .limit(1),
    ),
});

/** The developer's lines a cut drops, as `deleteMessagesFrom` drops them: each one's client id and the turn that took it. */
const findDroppedLines = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    seq: Schema.Number,
    turnIds: Schema.Array(Schema.String),
  }),
  Result: Schema.Struct({ clientId: Schema.String, turnId: Schema.NullOr(Schema.String) }),
  execute: ({ conversationId, seq, turnIds }) =>
    Database.use((db) =>
      db
        .select({ clientId: messages.clientId, turnId: messages.turnId })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.role, MESSAGE_ROLE.USER),
            or(
              and(isNull(messages.turnId), gte(messages.seq, seq)),
              turnIds.length === 0 ? sql`false` : inArray(messages.turnId, [...turnIds]),
            ),
          ),
        ),
    ),
});

/** The turns named that have left the queue: started, or ended. */
const findTurnsBegun = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, turnIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, turnIds }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(
          and(
            eq(turns.conversationId, conversationId),
            inArray(turns.id, [...turnIds]),
            ne(turns.status, TURN_STATUS.QUEUED),
          ),
        ),
    ),
});

const deleteMessagesFrom = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    seq: Schema.Number,
    turnIds: Schema.Array(Schema.String),
  }),
  execute: ({ conversationId, seq, turnIds }) =>
    Database.use((db) =>
      db
        .delete(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            or(
              and(isNull(messages.turnId), gte(messages.seq, seq)),
              turnIds.length === 0 ? sql`false` : inArray(messages.turnId, [...turnIds]),
            ),
          ),
        ),
    ),
});

const deleteTurns = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, turnIds: Schema.Array(Schema.String) }),
  execute: ({ conversationId, turnIds }) =>
    Database.use((db) =>
      db
        .delete(turns)
        .where(and(eq(turns.conversationId, conversationId), inArray(turns.id, [...turnIds]))),
    ),
});

/** The journal counted up and the conversation marked rewound at it, the harness's cut set unless the line was never heard and an earlier cut waits, what its turns' messages handed cleared, and a dropped turn the projection held let go. */
const markRewound = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    clientId: Schema.String,
    heard: Schema.Boolean,
    turnIds: Schema.Array(Schema.String),
  }),
  execute: ({ conversationId, clientId, heard, turnIds }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({
          journalRevision: sql`${conversations.journalRevision} + 1`,
          rewoundRevision: sql`${conversations.journalRevision} + 1`,
          nativeRewind: heard
            ? clientId
            : sql`coalesce(${conversations.nativeRewind}, ${clientId})`,
          nativeHanded: null,
          nativeProjection:
            turnIds.length === 0
              ? sql`${conversations.nativeProjection}`
              : sql`case when ${conversations.nativeProjection}->'turn'->>'id' in (${sql.join(
                  turnIds.map((id) => sql`${id}`),
                  sql`, `,
                )}) then ${conversations.nativeProjection} - 'turn' else ${conversations.nativeProjection} end`,
        })
        .where(eq(conversations.id, conversationId)),
    ),
});

const deleteWorkersFrom = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, from: Schema.Date }),
  execute: ({ conversationId, from }) =>
    Database.use((db) =>
      db
        .delete(conversations)
        .where(
          and(
            eq(conversations.parentConversationId, conversationId),
            gte(conversations.createdAt, from),
          ),
        ),
    ),
});

const clearNativeRewind = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, clientId: Schema.String }),
  execute: ({ conversationId, clientId }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ nativeRewind: null })
        .where(and(eq(conversations.id, conversationId), eq(conversations.nativeRewind, clientId))),
    ),
});

const findRewoundRevision = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ rewoundRevision: Schema.NullOr(Schema.Number) }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ rewoundRevision: conversations.rewoundRevision })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))),
    ),
});

const findNativeRewind = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ nativeRewind: Schema.NullOr(Schema.String) }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ nativeRewind: conversations.nativeRewind })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))),
    ),
});

/** Where a cut at the line named starts: its row and the instant the turns it drops were queued from; refused where it stands inside a turn. */
const cutPoint = (conversationId: string, messageId: string) =>
  Effect.gen(function* () {
    const line = yield* findLine({ conversationId, messageId });
    if (Option.isNone(line)) return Result.fail(REWIND_REFUSAL.NOT_FOUND);
    const { seq, clientId, turnId, takenAfterStep, createdAt } = line.value;
    if (takenAfterStep !== null) return Result.fail(REWIND_REFUSAL.INSIDE_TURN);
    let from = createdAt;
    if (turnId !== null) {
      const [opening] = yield* findTurnLines({ conversationId, turnId });
      if (opening !== undefined && opening.seq !== seq) {
        return Result.fail(REWIND_REFUSAL.INSIDE_TURN);
      }
      const turn = yield* findTurnQueuedAt({ conversationId, turnId });
      if (Option.isSome(turn)) from = turn.value.queuedAt;
    }
    return Result.succeed({ seq, clientId, heard: turnId !== null, from });
  });

/**
 * Whether nothing a cut from the line at `seq` drops was heard: the line
 * itself untaken, every turn it drops still queued, and every line it drops
 * withdrawn from the runner's queue unhanded, which the withdrawal does here
 * where they all were.
 */
const withdrawnUnheard = (
  target: ConversationTarget,
  seq: number,
  heard: boolean,
  turnIds: readonly string[],
) =>
  Effect.gen(function* () {
    const { conversationId } = target;
    if (heard) return false;
    if (turnIds.length > 0 && (yield* findTurnsBegun({ conversationId, turnIds })).length > 0) {
      return false;
    }
    const lines = yield* findDroppedLines({ conversationId, seq, turnIds });
    if (lines.some((line) => line.turnId !== null)) return false;
    return yield* withdrawUnhandedLines(
      target,
      lines.map((line) => line.clientId),
    );
  });

/** The cut, under the conversation's row lock and with no hand-over under way, answering what it cut or why it could not; one asked to drop only what no runner heard (`unheard`) cuts nothing where anything was. */
const cut = (target: ConversationTarget, messageId: string, place: number, unheard: boolean) =>
  Effect.gen(function* () {
    const { conversationId } = target;
    const held = yield* lockConversation(target);
    if (Option.isNone(held)) return Result.fail(REWIND_REFUSAL.NOT_FOUND);
    // A hand-over under way ends first, so the line it hands is cut with the rest after the runtime heard it,
    // and the stop that follows the cut stops whatever it started (`coder-host/rewind.ts`).
    if (yield* dispatchClaimStands(conversationId, place)) return yield* new DispatchClaimHeld();
    const point = yield* cutPoint(conversationId, messageId);
    if (Result.isFailure(point)) return Result.fail(point.failure);
    const { seq, clientId, heard, from } = point.success;
    const turnIds = (yield* findTurnsFrom({ conversationId, from })).map((turn) => turn.id);
    if (unheard && !(yield* withdrawnUnheard(target, seq, heard, turnIds))) {
      return Result.fail(UNHEARD_REFUSAL.HEARD);
    }
    yield* deleteMessagesFrom({ conversationId, seq, turnIds });
    // Note that a cut dropping every turn keeps the first one's row, its work gone and settled, because
    // an agent with no turn at all reads as one that never started, and fails past its grace.
    const [first, ...later] = turnIds;
    const keepsFirst =
      first !== undefined && (yield* findTurnBefore({ conversationId, from })).length === 0;
    const dropped = keepsFirst ? later : turnIds;
    if (keepsFirst) yield* settleKeptTurn(conversationId, first);
    if (dropped.length > 0) yield* deleteTurns({ conversationId, turnIds: dropped });
    // Note that a worker a dropped turn delegated is deleted with it, its own workers by the cascade.
    yield* deleteWorkersFrom({ conversationId, from });
    yield* markRewound({ conversationId, clientId, heard, turnIds });
    return Result.succeed<ConversationRewound>({ clientId, turnIds });
  });

/** The cut, in one transaction, once no hand-over is under way, waiting for one as long as a claim can stand; refused as heard only where asked to drop nothing heard. */
function rewound(
  target: ConversationTarget,
  messageId: string,
  unheard: true,
): Effect.Effect<
  Result.Result<ConversationRewound, UnheardRefusal>,
  StoreFailure,
  DatabaseServices
>;
function rewound(
  target: ConversationTarget,
  messageId: string,
  unheard: false,
): Effect.Effect<Result.Result<ConversationRewound, RewindRefusal>, StoreFailure, DatabaseServices>;
function rewound(
  target: ConversationTarget,
  messageId: string,
  unheard: boolean,
): Effect.Effect<
  Result.Result<ConversationRewound, UnheardRefusal>,
  StoreFailure,
  DatabaseServices
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    waitingOutDispatchClaim(
      target.conversationId,
      (place) => client.withTransaction(cut(target, messageId, place, unheard)),
      DISPATCH_CLAIM.EXPIRY,
    ),
  ).pipe(
    Effect.catchTag("DispatchClaimHeld", () =>
      Effect.succeed(Result.fail<UnheardRefusal>(REWIND_REFUSAL.BUSY)),
    ),
  );
}

/**
 * Cuts the conversation back to just before the developer's line named, as
 * above, in one transaction, once no hand-over to the agent is under way
 * (`dispatch-claim.ts`), waiting for one as long as a claim can stand, since
 * its caller has already stopped the agent for the cut; refused where the
 * account holds no such line, where the line sits inside a turn, or where
 * hand-overs kept the conversation claimed past that wait.
 */
export function rewindConversation(
  target: ConversationTarget,
  messageId: string,
): Effect.Effect<
  Result.Result<ConversationRewound, RewindRefusal>,
  StoreFailure,
  DatabaseServices
> {
  return rewound(target, messageId, false);
}

/**
 * Cuts the conversation back to just before the developer's line named, as
 * `rewindConversation` does, where nothing the cut drops was heard, its
 * lines withdrawn from the runner's queue in the same transaction, so its
 * caller stops nothing; refused as that is, and as heard, cutting nothing,
 * where anything it would drop may have reached a runner.
 */
export function rewindUnheard(
  target: ConversationTarget,
  messageId: string,
): Effect.Effect<
  Result.Result<ConversationRewound, UnheardRefusal>,
  StoreFailure,
  DatabaseServices
> {
  return rewound(target, messageId, true);
}

/** The client id of the line a harness's session is still to be cut before, where a rewind left one; none otherwise. */
export function readNativeRewind(
  target: ConversationTarget,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return Effect.map(findNativeRewind(target), (row) =>
    Option.flatMap(row, ({ nativeRewind }) => Option.fromNullishOr(nativeRewind)),
  );
}

/** Lets the harness's cut go once a launch has handed it over, unless a newer rewind replaced it meanwhile. */
export function clearNativeRewindHanded(
  conversationId: string,
  clientId: string,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return clearNativeRewind({ conversationId, clientId });
}

/** The journal revision the conversation was last rewound at, which a cursor read before it is stale past; none for one never rewound. */
export function readRewoundRevision(
  target: ConversationTarget,
): Effect.Effect<number | undefined, StoreFailure, DatabaseServices> {
  return Effect.map(findRewoundRevision(target), (row) =>
    Option.getOrUndefined(
      Option.flatMap(row, ({ rewoundRevision }) => Option.fromNullishOr(rewoundRevision)),
    ),
  );
}
