/**
 * turn-state.ts -- the one writer of a turn's state: where it stands, the deadline of that, the attempt it runs under, and how it ended.
 *
 * A turn row is the one record of a turn. Every statement that writes its
 * status, its deadline (`turns.lease_until`), its attempt, its start or its
 * end is here, and the store writer (`./writer.ts`) is their one caller,
 * under the conversation's lock, so the line a send writes and the turn it
 * awaits land in one transaction, and a turn's end and its journal's close
 * in another.
 *
 * A coding agent's line awaits a turn from the moment it is written
 * (`messages.awaits_turn_id`): the open turn it joins, where one stands that
 * no Stop was asked of, or a turn queued for it in the same transaction,
 * with a pickup deadline that runs from its queueing and never moves, however
 * often the agent's runner is launched. A line written past an open turn's
 * deadline joins nothing, since that turn is over by its record, and queues a
 * turn of its own. A runner that takes the line starts that turn under its
 * own launch (`turns.attempt`), and from then every move of the turn
 * names the attempt: a start, its progress (and nothing else) pushing its deadline on, and its
 * end, so a runner a newer launch replaced, or whose turn was failed, moves
 * nothing. A turn that ends well with lines it never took queues a turn for
 * them; a turn that fails keeps them, to be resent; and a Stop pulls the
 * turn's deadline in and leaves the lines written before it awaiting nothing.
 * A running turn its plan's limit cut short, with no other payer to go on
 * with it but a limit whose reset is known, is held open until that reset
 * (`turns.waits_until`), its deadline pushed past it, and the minute sweep
 * releases it once the reset has passed, to go on in a launch then. A queued
 * turn whose launch the limit refused is held the same way, its pickup
 * deadline running from the reset, and the sweep republishes it no more
 * until it is released.
 *
 * A turn still open past its deadline, or past its cap, is lapsed
 * (`@repo/features/turn-deadline`), and only the minute sweep's reconcile
 * reads it so (`lapsedTurnsOf`, `lapsedAgents`): every reap is a
 * compare-and-set on the turn's status and attempt, and on its standing
 * lapsed at the instant the reap read it, so a turn its runner moved on
 * since keeps running. Nothing here reads the clock: each write is handed
 * its instant.
 */

import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { TURN_DEADLINE } from "@repo/features/turn-deadline";
import {
  TURN_OPEN,
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnOrigin,
  type TurnStatus,
  type TurnTerminalStatus,
} from "@repo/wire";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { agentRunnerRecord } from "../schemas/agent-runner-record.js";
import { agentSandboxTable } from "../schemas/agent-sandbox.js";
import { messages, turns } from "../schemas/storage.js";
import { InstantColumnSchema, TurnUsageColumnSchema } from "./columns.js";

type TurnStateEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/**
 * Whether the rewind may settle the turn it keeps from each status. Note that
 * every status may be settled, because the kept turn's work is gone whatever
 * it stood at: a stop the rewind asked may not have landed yet, and a failure
 * or cancel is of work the cut dropped. Declared per status so a status added
 * later is decided here rather than settled unread.
 */
const REWIND_SETTLES = {
  [TURN_STATUS.QUEUED]: true,
  [TURN_STATUS.RUNNING]: true,
  [TURN_STATUS.SETTLED]: true,
  [TURN_STATUS.CANCELED]: true,
  [TURN_STATUS.FAILED]: true,
} as const satisfies Record<TurnStatus, boolean>;

const REWIND_SETTLES_FROM = Object.values(TURN_STATUS).filter((status) => REWIND_SETTLES[status]);

const TurnOriginSchema = Schema.Literals(Object.values(TURN_ORIGIN));

const TurnStatusSchema = Schema.Literals(Object.values(TURN_STATUS));

const IdSchema = Schema.Struct({ id: Schema.String });

/** The agent's checkout as it stood before a turn, as its runner recorded it (`turns.snapshot_*`). */
export interface TurnCheckoutSnapshot {
  readonly commit: string;
  readonly head: string | null;
  readonly branch: string | null;
}

const TurnCheckoutSnapshotSchema = Schema.Struct({
  commit: Schema.String,
  head: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
});

/**
 * That a turn still open stands lapsed at the instant given: past the
 * deadline of the state it stands in, or past its cap from its start.
 */
function lapsedAt(at: Date) {
  return and(
    inArray(turns.status, [...TURN_OPEN]),
    or(
      lt(turns.leaseUntil, at),
      lt(turns.startedAt, new Date(at.getTime() - TURN_DEADLINE.CAP_MS)),
    ),
  );
}

const insertQueued = SqlSchema.void({
  Request: Schema.Struct({
    turnId: Schema.String,
    userId: Schema.String,
    conversationId: Schema.String,
    origin: TurnOriginSchema,
    runtimeTurnId: Schema.NullOr(Schema.String),
    model: Schema.NullOr(Schema.String),
    reasoningEffort: Schema.NullOr(Schema.String),
    promptHash: Schema.NullOr(Schema.String),
    toolSetHash: Schema.NullOr(Schema.String),
    queuedAt: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(turns).values({
        id: row.turnId,
        userId: row.userId,
        conversationId: row.conversationId,
        origin: row.origin,
        status: TURN_STATUS.QUEUED,
        runtimeTurnId: row.runtimeTurnId,
        model: row.model,
        reasoningEffort: row.reasoningEffort,
        promptHash: row.promptHash,
        toolSetHash: row.toolSetHash,
        queuedAt: row.queuedAt,
        leaseUntil: new Date(row.queuedAt.getTime() + TURN_DEADLINE.PICKUP_MS),
      }),
    ),
});

const namedRun = SqlSchema.void({
  Request: Schema.Struct({
    turnId: Schema.String,
    conversationId: Schema.String,
    runtimeTurnId: Schema.NullOr(Schema.String),
    model: Schema.NullOr(Schema.String),
    reasoningEffort: Schema.NullOr(Schema.String),
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({
          runtimeTurnId: row.runtimeTurnId,
          model: row.model,
          reasoningEffort: row.reasoningEffort,
        })
        .where(
          and(
            eq(turns.id, row.turnId),
            eq(turns.conversationId, row.conversationId),
            eq(turns.status, TURN_STATUS.QUEUED),
          ),
        ),
    ),
});

const insertStarted = SqlSchema.void({
  Request: Schema.Struct({
    turnId: Schema.String,
    userId: Schema.String,
    conversationId: Schema.String,
    origin: TurnOriginSchema,
    startedAt: Schema.Date,
    attempt: Schema.Number,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(turns).values({
        id: row.turnId,
        userId: row.userId,
        conversationId: row.conversationId,
        origin: row.origin,
        status: TURN_STATUS.RUNNING,
        queuedAt: row.startedAt,
        startedAt: row.startedAt,
        leaseUntil: new Date(row.startedAt.getTime() + TURN_DEADLINE.PROGRESS_MS),
        attempt: row.attempt,
      }),
    ),
});

const startQueued = SqlSchema.findAll({
  Request: Schema.Struct({
    turnId: Schema.String,
    conversationId: Schema.String,
    startedAt: Schema.Date,
    attempt: Schema.Number,
  }),
  Result: IdSchema,
  execute: (row) => {
    const progressBy = new Date(row.startedAt.getTime() + TURN_DEADLINE.PROGRESS_MS);
    return Database.use((db) =>
      db
        .update(turns)
        .set({
          status: TURN_STATUS.RUNNING,
          startedAt: row.startedAt,
          // A Stop asked while the turn stood queued keeps its own deadline, where that comes sooner.
          leaseUntil: sql`case when ${turns.cancelRequestedAt} is null then ${progressBy} else least(coalesce(${turns.leaseUntil}, ${progressBy}), ${progressBy}) end`,
          attempt: row.attempt,
        })
        .where(
          and(
            eq(turns.id, row.turnId),
            eq(turns.conversationId, row.conversationId),
            eq(turns.status, TURN_STATUS.QUEUED),
          ),
        )
        .returning({ id: turns.id }),
    );
  },
});

/**
 * Note that the response ids no longer need the empty array written as a
 * literal: a driver infers a parameter's Postgres type from the value it is
 * handed and an empty array offers no element to infer one from, but a
 * `text[]` column renders its own value as the array literal it is, so the
 * ordinary case — a turn that called nothing and settles with no response
 * ids — is one more bound parameter.
 */
const endOpen = SqlSchema.findAll({
  Request: Schema.Struct({
    turnId: Schema.String,
    conversationId: Schema.String,
    attempt: Schema.Number,
    lapsedAt: Schema.NullOr(Schema.Date),
    status: TurnStatusSchema,
    settledAt: Schema.Date,
    failure: Schema.NullOr(Schema.String),
    failureDetail: Schema.NullOr(Schema.String),
    usage: Schema.NullOr(TurnUsageColumnSchema),
    responseIds: Schema.Array(Schema.String),
  }),
  Result: IdSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({
          status: row.status,
          settledAt: row.settledAt,
          failure: row.failure,
          failureDetail: row.failureDetail,
          usage: row.usage,
          responseIds: [...row.responseIds],
        })
        .where(
          and(
            eq(turns.id, row.turnId),
            eq(turns.conversationId, row.conversationId),
            inArray(turns.status, [...TURN_OPEN]),
            eq(turns.attempt, row.attempt),
            row.lapsedAt === null ? undefined : lapsedAt(row.lapsedAt),
          ),
        )
        .returning({ id: turns.id }),
    ),
});

const pushDeadlines = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    attempt: Schema.Number,
    until: Schema.Date,
    before: Schema.Date,
  }),
  Result: IdSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({ leaseUntil: request.until })
        .where(
          and(
            eq(turns.conversationId, request.conversationId),
            eq(turns.status, TURN_STATUS.RUNNING),
            eq(turns.attempt, request.attempt),
            // A Stop's deadline is the Stop's: progress after it pushes nothing on.
            isNull(turns.cancelRequestedAt),
            lt(turns.leaseUntil, request.before),
          ),
        )
        .returning({ id: turns.id }),
    ),
});

const writeSnapshot = SqlSchema.void({
  Request: Schema.Struct({
    turnId: Schema.String,
    conversationId: Schema.String,
    snapshot: TurnCheckoutSnapshotSchema,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({
          snapshotCommit: row.snapshot.commit,
          snapshotHead: row.snapshot.head,
          snapshotBranch: row.snapshot.branch,
        })
        .where(and(eq(turns.id, row.turnId), eq(turns.conversationId, row.conversationId))),
    ),
});

const stampStop = SqlSchema.findAll({
  Request: Schema.Struct({
    turnId: Schema.String,
    conversationId: Schema.String,
    at: Schema.Date,
    key: Schema.NullOr(Schema.String),
    by: Schema.NullOr(Schema.String),
  }),
  Result: IdSchema,
  execute: (row) => {
    const stopBy = new Date(row.at.getTime() + TURN_DEADLINE.STOP_MS);
    return Database.use((db) =>
      db
        .update(turns)
        .set({
          cancelRequestedAt: row.at,
          cancelRequestKey: row.key,
          cancelRequestedBy: row.by,
          // Note that a turn still open past the Stop's own deadline is canceled by the sweep.
          leaseUntil: sql`least(coalesce(${turns.leaseUntil}, ${stopBy}), ${stopBy})`,
        })
        .where(
          and(
            eq(turns.id, row.turnId),
            eq(turns.conversationId, row.conversationId),
            isNull(turns.cancelRequestedAt),
          ),
        )
        .returning({ id: turns.id }),
    );
  },
});

const deleteQueued = SqlSchema.void({
  Request: Schema.Struct({ turnId: Schema.String, conversationId: Schema.String }),
  execute: (row) =>
    Database.use((db) =>
      db
        .delete(turns)
        .where(
          and(
            eq(turns.id, row.turnId),
            eq(turns.conversationId, row.conversationId),
            eq(turns.status, TURN_STATUS.QUEUED),
          ),
        ),
    ),
});

const settleKept = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, turnId: Schema.String }),
  execute: ({ conversationId, turnId }) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({
          status: TURN_STATUS.SETTLED,
          settledAt: sql`now()`,
          cancelRequestedAt: null,
          cancelRequestKey: null,
          cancelRequestedBy: null,
          failure: null,
          failureDetail: null,
        })
        .where(
          and(
            eq(turns.conversationId, conversationId),
            eq(turns.id, turnId),
            inArray(turns.status, REWIND_SETTLES_FROM),
          ),
        ),
    ),
});

/** The newest open turn of the conversation, still inside its deadline at `at`, no Stop was asked of: the one a line written then joins. */
const findJoinable = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, at: Schema.Date }),
  Result: IdSchema,
  execute: ({ conversationId, at }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(
          and(
            eq(turns.conversationId, conversationId),
            inArray(turns.status, [...TURN_OPEN]),
            isNull(turns.cancelRequestedAt),
            // Not lapsed at `at`, as `lapsedAt` reads it: a turn with no deadline, or not started, is not.
            or(isNull(turns.leaseUntil), gte(turns.leaseUntil, at)),
            or(
              isNull(turns.startedAt),
              gte(turns.startedAt, new Date(at.getTime() - TURN_DEADLINE.CAP_MS)),
            ),
          ),
        )
        .orderBy(desc(turns.queuedAt), desc(turns.id))
        .limit(1),
    ),
});

/** The conversation's oldest queued turn: the one a runner opening a turn takes. */
const findOpen = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: IdSchema,
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), inArray(turns.status, [...TURN_OPEN])))
        .limit(1),
    ),
});

const findQueued = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: IdSchema,
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), eq(turns.status, TURN_STATUS.QUEUED)))
        .orderBy(asc(turns.queuedAt), asc(turns.id))
        .limit(1),
    ),
});

/** The conversation's open turn no Stop was asked of that waits on a limit's reset, the soonest reset first. */
const findWaiting = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, waitsUntil: InstantColumnSchema }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id, waitsUntil: turns.waitsUntil })
        .from(turns)
        .where(
          and(
            eq(turns.userId, userId),
            eq(turns.conversationId, conversationId),
            inArray(turns.status, [...TURN_OPEN]),
            isNull(turns.cancelRequestedAt),
            isNotNull(turns.waitsUntil),
          ),
        )
        .orderBy(asc(turns.waitsUntil), asc(turns.id))
        .limit(1),
    ),
});

const findStatus = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, turnId: Schema.String }),
  Result: Schema.Struct({ status: TurnStatusSchema }),
  execute: ({ conversationId, turnId }) =>
    Database.use((db) =>
      db
        .select({ status: turns.status })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), eq(turns.id, turnId))),
    ),
});

const AwaitingRunnerSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  turnId: Schema.String,
});

/** A coding agent's turns still queued that were queued before the instant given and stand inside their pickup deadline at the other, waiting on no limit's reset, oldest first. */
const findAwaitingRunner = SqlSchema.findAll({
  Request: Schema.Struct({ before: Schema.Date, at: Schema.Date, limit: Schema.Int }),
  Result: AwaitingRunnerSchema,
  execute: ({ before, at, limit }) =>
    Database.use((db) =>
      db
        .select({
          userId: turns.userId,
          conversationId: turns.conversationId,
          turnId: turns.id,
        })
        .from(turns)
        .innerJoin(agentTable, eq(agentTable.conversationId, turns.conversationId))
        .where(
          and(
            eq(turns.status, TURN_STATUS.QUEUED),
            lt(turns.queuedAt, before),
            gte(turns.leaseUntil, at),
            isNull(turns.waitsUntil),
          ),
        )
        .orderBy(asc(turns.queuedAt), asc(turns.id))
        .limit(limit),
    ),
});

/** The turn the conversation's line under the client id given awaits. */
const findAwaitedByLine = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, clientId: Schema.String }),
  Result: Schema.Struct({ turnId: Schema.String }),
  execute: ({ conversationId, clientId }) =>
    Database.use((db) =>
      db
        .select({ turnId: sql<string>`${messages.awaitsTurnId}` })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.clientId, clientId),
            isNotNull(messages.awaitsTurnId),
          ),
        ),
    ),
});

/** The developer's lines awaiting the turn that no turn took and no hand-over withdrew. */
const findUntaken = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, turnId: Schema.String }),
  Result: IdSchema,
  execute: ({ conversationId, turnId }) =>
    Database.use((db) =>
      db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.awaitsTurnId, turnId),
            isNull(messages.turnId),
            isNull(messages.withdrawnAt),
          ),
        ),
    ),
});

const pointLines = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    ids: Schema.Array(Schema.String),
    turnId: Schema.NullOr(Schema.String),
  }),
  execute: ({ conversationId, ids, turnId }) =>
    Database.use((db) =>
      db
        .update(messages)
        .set({ awaitsTurnId: turnId })
        .where(and(eq(messages.conversationId, conversationId), inArray(messages.id, [...ids]))),
    ),
});

/** A running turn moved onto the newer attempt named, its progress deadline running from `at`, where it still runs under an older one. */
const moveRunning = SqlSchema.findAll({
  Request: Schema.Struct({
    turnId: Schema.String,
    conversationId: Schema.String,
    attempt: Schema.Number,
    at: Schema.Date,
  }),
  Result: IdSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({
          attempt: row.attempt,
          leaseUntil: new Date(row.at.getTime() + TURN_DEADLINE.PROGRESS_MS),
        })
        .where(
          and(
            eq(turns.id, row.turnId),
            eq(turns.conversationId, row.conversationId),
            eq(turns.status, TURN_STATUS.RUNNING),
            lt(turns.attempt, row.attempt),
          ),
        )
        .returning({ id: turns.id }),
    ),
});

/** A running turn no Stop was asked of held until the reset given, its progress deadline running from it. */
const holdRunning = SqlSchema.findAll({
  Request: Schema.Struct({
    turnId: Schema.String,
    conversationId: Schema.String,
    until: Schema.Date,
  }),
  Result: IdSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({
          waitsUntil: row.until,
          leaseUntil: new Date(row.until.getTime() + TURN_DEADLINE.PROGRESS_MS),
        })
        .where(
          and(
            eq(turns.id, row.turnId),
            eq(turns.conversationId, row.conversationId),
            eq(turns.status, TURN_STATUS.RUNNING),
            isNull(turns.cancelRequestedAt),
          ),
        )
        .returning({ id: turns.id }),
    ),
});

/** The conversation's queued turns no Stop was asked of held until the reset given, their pickup deadline running from it. */
const holdQueued = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, until: Schema.Date }),
  Result: IdSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({
          waitsUntil: row.until,
          leaseUntil: new Date(row.until.getTime() + TURN_DEADLINE.PICKUP_MS),
        })
        .where(
          and(
            eq(turns.conversationId, row.conversationId),
            eq(turns.status, TURN_STATUS.QUEUED),
            isNull(turns.cancelRequestedAt),
          ),
        )
        .returning({ id: turns.id }),
    ),
});

const WaitedTurnSchema = Schema.Struct({
  ...AwaitingRunnerSchema.fields,
  status: TurnStatusSchema,
});

/** The running and queued turns no Stop was asked of whose wait has passed at the instant given, their wait cleared, soonest reset first, at most `limit` of them. */
const releaseWaited = SqlSchema.findAll({
  Request: Schema.Struct({ at: Schema.Date, limit: Schema.Int }),
  Result: WaitedTurnSchema,
  execute: ({ at, limit }) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({ waitsUntil: null })
        .where(
          inArray(
            turns.id,
            db
              .select({ id: turns.id })
              .from(turns)
              .where(
                and(
                  inArray(turns.status, [TURN_STATUS.RUNNING, TURN_STATUS.QUEUED]),
                  isNull(turns.cancelRequestedAt),
                  lte(turns.waitsUntil, at),
                ),
              )
              .orderBy(asc(turns.waitsUntil), asc(turns.id))
              .limit(limit),
          ),
        )
        .returning({
          userId: turns.userId,
          conversationId: turns.conversationId,
          turnId: turns.id,
          status: turns.status,
        }),
    ),
});

/** The conversation's running and queued turns no Stop was asked of that wait on the reset given, their wait cleared now. */
const releaseConversationWaits = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    until: Schema.Date,
  }),
  Result: WaitedTurnSchema,
  execute: ({ userId, conversationId, until }) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({ waitsUntil: null })
        .where(
          and(
            eq(turns.userId, userId),
            eq(turns.conversationId, conversationId),
            inArray(turns.status, [TURN_STATUS.RUNNING, TURN_STATUS.QUEUED]),
            isNull(turns.cancelRequestedAt),
            eq(turns.waitsUntil, until),
          ),
        )
        .returning({
          userId: turns.userId,
          conversationId: turns.conversationId,
          turnId: turns.id,
          status: turns.status,
        }),
    ),
});

/** The conversation's running turns under an attempt older than the launch named, whose runner that launch replaced. */
const findSuperseded = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, launch: Schema.Number }),
  Result: IdSchema,
  execute: ({ conversationId, launch }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(
          and(
            eq(turns.conversationId, conversationId),
            eq(turns.status, TURN_STATUS.RUNNING),
            lt(turns.attempt, launch),
          ),
        ),
    ),
});

const LapsedTurnSchema = Schema.Struct({
  id: Schema.String,
  status: TurnStatusSchema,
  attempt: Schema.Number,
  startedAt: Schema.NullOr(Schema.Date),
  cancelRequestedAt: Schema.NullOr(Schema.Date),
});

const findLapsed = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, at: Schema.Date }),
  Result: LapsedTurnSchema,
  execute: ({ conversationId, at }) =>
    Database.use((db) =>
      db
        .select({
          id: turns.id,
          status: turns.status,
          attempt: turns.attempt,
          startedAt: turns.startedAt,
          cancelRequestedAt: turns.cancelRequestedAt,
        })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), lapsedAt(at)))
        .orderBy(asc(turns.queuedAt), asc(turns.id)),
    ),
});

const LapsedAgentSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  conversationId: Schema.String,
  machine: Schema.Literals(Object.values(AGENT_MACHINE)),
  deviceId: Schema.NullOr(Schema.String),
});

const findLapsedAgents = SqlSchema.findAll({
  Request: Schema.Struct({ at: Schema.Date, limit: Schema.Int }),
  Result: LapsedAgentSchema,
  execute: ({ at, limit }) =>
    Database.use((db) =>
      db
        .select({
          id: agentTable.id,
          userId: agentTable.userId,
          conversationId: agentTable.conversationId,
          machine: agentTable.machine,
          deviceId: agentTable.deviceId,
        })
        .from(turns)
        .innerJoin(agentTable, eq(agentTable.conversationId, turns.conversationId))
        .where(lapsedAt(at))
        .groupBy(
          agentTable.id,
          agentTable.userId,
          agentTable.conversationId,
          agentTable.machine,
          agentTable.deviceId,
        )
        // Note that the order is drawn afresh each sweep, so agents one sweep could not reap never hold back every other.
        .orderBy(sql`random()`)
        .limit(limit),
    ),
});

const findRunningSandboxes = SqlSchema.findAll({
  Request: Schema.Struct({ at: Schema.Date, limit: Schema.Int }),
  Result: Schema.Struct({ sandboxName: Schema.String }),
  execute: ({ at, limit }) =>
    Database.use((db) =>
      db
        .select({ sandboxName: agentRunnerRecord.sandboxName })
        .from(turns)
        .innerJoin(agentTable, eq(agentTable.conversationId, turns.conversationId))
        .innerJoin(
          agentRunnerRecord,
          and(
            eq(agentRunnerRecord.userId, agentTable.userId),
            eq(agentRunnerRecord.agentId, agentTable.id),
          ),
        )
        .where(
          and(
            eq(turns.status, TURN_STATUS.RUNNING),
            gt(turns.leaseUntil, at),
            eq(agentTable.machine, AGENT_MACHINE.VERCEL),
            isNotNull(agentRunnerRecord.sandboxSessionId),
          ),
        )
        .groupBy(agentRunnerRecord.sandboxName)
        // Note that the order is drawn afresh each sweep, so past the limit no sandbox is left out every minute.
        .orderBy(sql`random()`)
        .limit(limit),
    ),
});

/** A turn of the conversation as a write names it: its id, and the conversation and account it stands in. */
export interface TurnTarget {
  readonly userId: string;
  readonly conversationId: string;
}

/** The turn a line written now awaits, and whether it was queued for it here. */
export interface AwaitedTurn {
  readonly turnId: string;
  readonly queued: boolean;
}

/**
 * The turn a coding agent's line written at `now` awaits: the newest open
 * turn no Stop was asked of, which takes it as a steer or as its next line,
 * or a turn queued for it here, its id minted by `mint`, with its pickup
 * deadline. Note that a turn a Stop was asked of, or one past its deadline,
 * is joined by nothing, because the Stop ends what it was doing and the
 * deadline says it is over, so a line written after either opens a turn of
 * its own. Its caller writes the line in the same transaction.
 */
export function awaitedTurn(
  target: TurnTarget,
  now: Date,
  mint: () => string,
): TurnStateEffect<AwaitedTurn> {
  return Effect.gen(function* () {
    const open = yield* findJoinable({ conversationId: target.conversationId, at: now });
    if (Option.isSome(open)) return { turnId: open.value.id, queued: false };
    const turnId = mint();
    yield* insertQueued({
      turnId,
      userId: target.userId,
      conversationId: target.conversationId,
      origin: TURN_ORIGIN.TYPED,
      // Note that the turn is named to its harness only once a runner opens it (`queueTurn`), so a Stop names no turn nothing runs yet.
      runtimeTurnId: null,
      model: null,
      reasoningEffort: null,
      promptHash: null,
      toolSetHash: null,
      queuedAt: now,
    });
    return { turnId, queued: true };
  });
}

/** What a turn is queued with, ahead of its start. */
export interface TurnQueueing {
  readonly turnId: string;
  readonly origin: TurnOrigin;
  readonly runtimeTurnId: string | null;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly promptHash: string | null;
  readonly toolSetHash: string | null;
}

/**
 * Queues the turn at `now`, or, where it already stands queued, as a turn
 * its line queued does until a runner takes it, records what its runner
 * names it runs on. A turn past its queueing is left as it stands.
 */
export function queueTurn(
  target: TurnTarget,
  queueing: TurnQueueing,
  now: Date,
  standing: boolean,
): TurnStateEffect<void> {
  if (standing) {
    return namedRun({
      turnId: queueing.turnId,
      conversationId: target.conversationId,
      runtimeTurnId: queueing.runtimeTurnId,
      model: queueing.model,
      reasoningEffort: queueing.reasoningEffort,
    });
  }
  return insertQueued({ ...queueing, ...target, queuedAt: now });
}

/**
 * Starts the turn under the attempt given at `at`: a turn queued for it is
 * moved to running with its progress deadline, and a turn no row stands for
 * is written running; answers whether this call started it, a turn already
 * past its queueing being left as it stands.
 */
export function startTurn(
  target: TurnTarget,
  start: {
    readonly turnId: string;
    readonly origin: TurnOrigin;
    readonly attempt: number;
    readonly at: Date;
  },
  standing: Option.Option<{ readonly status: string }>,
): TurnStateEffect<boolean> {
  return Effect.gen(function* () {
    if (Option.isNone(standing)) {
      yield* insertStarted({
        turnId: start.turnId,
        userId: target.userId,
        conversationId: target.conversationId,
        origin: start.origin,
        startedAt: start.at,
        attempt: start.attempt,
      });
      return true;
    }
    if (standing.value.status !== TURN_STATUS.QUEUED) return false;
    const started = yield* startQueued({
      turnId: start.turnId,
      conversationId: target.conversationId,
      startedAt: start.at,
      attempt: start.attempt,
    });
    return started.length > 0;
  });
}

/** How a turn ends, and what fences its end. */
export interface TurnEnd {
  readonly turnId: string;
  /** The attempt the end is told by, which must be the turn's. */
  readonly attempt: number;
  /** Where the end is a reap, the instant the turn was read lapsed at, at which it must still stand lapsed. */
  readonly lapsedAt: Date | null;
  readonly status: TurnTerminalStatus;
  readonly settledAt: Date;
  readonly failure: string | null;
  readonly failureDetail: string | null;
  readonly usage: typeof TurnUsageColumnSchema.Type | null;
  readonly responseIds: readonly string[];
}

/**
 * Ends the turn as `end` says, where it still stands open under the
 * attempt the end names, and, for a reap, still stands lapsed at the
 * instant it was read; answers whether this call ended it.
 */
export function endTurn(target: TurnTarget, end: TurnEnd): TurnStateEffect<boolean> {
  return Effect.map(
    endOpen({ ...end, conversationId: target.conversationId }),
    (ended) => ended.length > 0,
  );
}

/**
 * Queues a turn for the lines the turn named awaited and never took, where
 * it ended well with none of them withdrawn: they go to the open turn they
 * may join, or a turn queued for them at `now`, as a line written then
 * would. Answers the turn they await now, none where none was left.
 */
export function requeueUntaken(
  target: TurnTarget,
  endedTurnId: string,
  now: Date,
  mint: () => string,
): TurnStateEffect<Option.Option<string>> {
  return Effect.gen(function* () {
    const left = yield* findUntaken({ conversationId: target.conversationId, turnId: endedTurnId });
    if (left.length === 0) return Option.none();
    const awaited = yield* awaitedTurn(target, now, mint);
    yield* pointLines({
      conversationId: target.conversationId,
      ids: left.map((line) => line.id),
      turnId: awaited.turnId,
    });
    return Option.some(awaited.turnId);
  });
}

/** Points the lines named at the turn they now await, or at none. */
export function awaitTurn(
  conversationId: string,
  lineIds: readonly string[],
  turnId: string | null,
): TurnStateEffect<void> {
  return lineIds.length === 0 ? Effect.void : pointLines({ conversationId, ids: lineIds, turnId });
}

/**
 * Deletes, among the turns named, each still queued that no line awaits any
 * more, its lines having been taken into another turn, or its one line's
 * hand-over having answered that its runtime did not take it: a turn queued
 * stands only while a line awaits it.
 */
export function dropAwaitingNothing(
  target: TurnTarget,
  turnIds: readonly string[],
): TurnStateEffect<void> {
  return Effect.forEach(
    turnIds,
    (turnId) =>
      Effect.gen(function* () {
        const left = yield* findUntaken({ conversationId: target.conversationId, turnId });
        if (left.length === 0)
          yield* deleteQueued({ turnId, conversationId: target.conversationId });
      }),
    { discard: true },
  );
}

/** The snapshot columns cleared, as a turn whose runner recorded none holds them. */
const NO_SNAPSHOT = { snapshotCommit: null, snapshotHead: null, snapshotBranch: null } as const;

const forgetSnapshotsOfSandbox = SqlSchema.void({
  Request: Schema.Struct({ sandboxName: Schema.String }),
  execute: ({ sandboxName }) =>
    Database.use((db) =>
      db
        .update(turns)
        .set(NO_SNAPSHOT)
        .where(
          inArray(
            turns.conversationId,
            db
              .select({ conversationId: agentTable.conversationId })
              .from(agentSandboxTable)
              .innerJoin(agentTable, eq(agentTable.id, agentSandboxTable.agentId))
              .where(eq(agentSandboxTable.sandboxName, sandboxName)),
          ),
        ),
    ),
});

const forgetSnapshotsOfAgent = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .update(turns)
        .set(NO_SNAPSHOT)
        .where(
          inArray(
            turns.conversationId,
            db
              .select({ conversationId: agentTable.conversationId })
              .from(agentTable)
              .where(eq(agentTable.id, agentId)),
          ),
        ),
    ),
});

/**
 * The snapshots the turns of the sandbox's agent hold forgotten, since a
 * snapshot stands only while the sandbox it was taken in does: written as
 * the sandbox is released, discarded, or made anew under its name
 * (`agent-sandboxes.ts`), so no turn claims a checkout no sandbox holds.
 */
export function forgetTurnSnapshotsOfSandbox(sandboxName: string): TurnStateEffect<void> {
  return forgetSnapshotsOfSandbox({ sandboxName });
}

/** The snapshots the agent's turns hold forgotten, as `forgetTurnSnapshotsOfSandbox` forgets them, for a sandbox the agent opens anew. */
export function forgetTurnSnapshotsOfAgent(agentId: string): TurnStateEffect<void> {
  return forgetSnapshotsOfAgent({ agentId });
}

/**
 * Records on the turn the checkout as it stood before it, as the runner
 * reported it with the turn's first line; a later report of the same turn
 * writes over it, as a line resent to a fresh launch is recorded afresh.
 */
export function recordTurnSnapshot(
  target: TurnTarget,
  turnId: string,
  snapshot: TurnCheckoutSnapshot,
): TurnStateEffect<void> {
  return writeSnapshot({ turnId, conversationId: target.conversationId, snapshot });
}

/**
 * Stamps a Stop on the turn at `at`, once, and pulls its deadline in to the
 * Stop's own (`TURN_DEADLINE.STOP_MS`); answers whether this call stamped it.
 */
export function stopTurn(
  target: TurnTarget,
  stop: {
    readonly turnId: string;
    readonly at: Date;
    readonly key: string | null;
    readonly by: string | null;
  },
): TurnStateEffect<boolean> {
  return Effect.map(
    stampStop({ ...stop, conversationId: target.conversationId }),
    (stamped) => stamped.length > 0,
  );
}

/**
 * Pushes on the progress deadline of the conversation's running turns under
 * the attempt given, as its progress at `now` does; answers how many it
 * wrote. A deadline with more than its renewal's worth still to run is left
 * as it stands, so most posts write nothing, and a turn a Stop was asked of
 * keeps the Stop's.
 */
export function progressTurns(
  conversationId: string,
  attempt: number,
  now: number,
): TurnStateEffect<number> {
  return Effect.map(
    pushDeadlines({
      conversationId,
      attempt,
      until: new Date(now + TURN_DEADLINE.PROGRESS_MS),
      before: new Date(now + TURN_DEADLINE.PROGRESS_MS - TURN_DEADLINE.RENEW_AFTER_MS),
    }),
    (rows) => rows.length,
  );
}

/** Whether the conversation holds a turn still open, queued for its runner or running. */
export function hasOpenTurn(conversationId: string): TurnStateEffect<boolean> {
  return Effect.map(findOpen({ conversationId }), Option.isSome);
}

/** The conversation's queued turn a runner opening a turn takes, oldest first; none where none is queued. */
export function queuedTurnOf(conversationId: string): TurnStateEffect<Option.Option<string>> {
  return Effect.map(
    findQueued({ conversationId }),
    Option.map((row) => row.id),
  );
}

/** The turn the conversation's line under the client id given awaits, as its send wrote it; none for a line no turn is awaited by. */
export function turnAwaitedByLine(
  conversationId: string,
  clientId: string,
): TurnStateEffect<Option.Option<string>> {
  return Effect.map(
    findAwaitedByLine({ conversationId, clientId }),
    Option.map((row) => row.turnId),
  );
}

/** The conversation's open turn, no Stop asked of, that waits on a usage limit's reset, and when that reset is; none where no turn waits. */
export function waitingTurnOf(
  target: TurnTarget,
): TurnStateEffect<Option.Option<{ readonly turnId: string; readonly waitsUntil: Date }>> {
  return Effect.map(
    findWaiting({ userId: target.userId, conversationId: target.conversationId }),
    Option.map((row) => ({ turnId: row.id, waitsUntil: row.waitsUntil })),
  );
}

/** Where the conversation's turn named stands; none where no such turn does. */
export function turnStatusOf(
  conversationId: string,
  turnId: string,
): TurnStateEffect<Option.Option<TurnStatus>> {
  return Effect.map(
    findStatus({ conversationId, turnId }),
    Option.map((row) => row.status),
  );
}

/** A coding agent's turn still awaiting a runner: the account, the conversation, and the turn. */
export type AwaitingRunner = typeof AwaitingRunnerSchema.Type;

/**
 * The coding agents' turns, among every account's, still queued for a
 * runner that were queued before `before` and stand inside their pickup
 * deadline at `at`, oldest first, at most `limit` of them.
 */
export function turnsAwaitingRunner(
  before: Date,
  at: Date,
  limit: number,
): TurnStateEffect<readonly AwaitingRunner[]> {
  return findAwaitingRunner({ before, at, limit });
}

/**
 * The ids of the conversation's turns running under an attempt older than
 * the launch named: their runner was replaced by that launch, so their end
 * is not coming, and the launch's first post fails them so.
 */
export function supersededTurnsOf(
  conversationId: string,
  launch: number,
): TurnStateEffect<readonly string[]> {
  return Effect.map(findSuperseded({ conversationId, launch }), (rows) =>
    rows.map((row) => row.id),
  );
}

/**
 * Moves the running turn named onto the newer launch given at `at`, as a
 * launch that goes on with a turn its plan's limit cut short takes it up,
 * its progress deadline running from then; answers whether it moved, a
 * turn ended or already under that launch or a newer one being left as it
 * stands.
 */
export function carryTurn(
  target: TurnTarget,
  carry: { readonly turnId: string; readonly attempt: number; readonly at: Date },
): TurnStateEffect<boolean> {
  return Effect.map(
    moveRunning({ ...carry, conversationId: target.conversationId }),
    (moved) => moved.length > 0,
  );
}

/**
 * Holds the running turn named, no Stop asked of, open until the usage
 * limit that cut it short resets at `until`, its progress deadline running
 * from then, so the sweep reaps it only once a launch past the reset has
 * had its time; answers whether it was held.
 */
export function holdTurn(
  target: TurnTarget,
  hold: { readonly turnId: string; readonly until: Date },
): TurnStateEffect<boolean> {
  return Effect.map(
    holdRunning({ ...hold, conversationId: target.conversationId }),
    (held) => held.length > 0,
  );
}

/**
 * Holds the conversation's queued turns, no Stop asked of, until the usage
 * limit that refused their launch resets at `until`, their pickup deadline
 * running from then, so neither the sweep's republish nor its reap reaches
 * them before a launch past the reset has had its time; answers the turns
 * held.
 */
export function holdQueuedTurns(
  target: TurnTarget,
  until: Date,
): TurnStateEffect<readonly string[]> {
  return Effect.map(holdQueued({ conversationId: target.conversationId, until }), (held) =>
    held.map((row) => row.id),
  );
}

/** A turn whose wait for a limit's reset the sweep released: the account, the conversation, the turn, and whether it stood running or queued. */
export type WaitedTurn = typeof WaitedTurnSchema.Type;

/**
 * The coding agents' running and queued turns, among every account's, no
 * Stop asked of, whose wait for a limit's reset has passed at `at`, their
 * wait cleared, soonest reset first, at most `limit` of them: the minute
 * sweep has each go on in a launch.
 */
export function releaseWaitedTurns(
  at: Date,
  limit: number,
): TurnStateEffect<readonly WaitedTurn[]> {
  return releaseWaited({ at, limit });
}

/**
 * The conversation's running and queued turns, no Stop asked of, that wait
 * on the limit whose reset is `until`, their wait cleared before it, as a
 * reset credit spent on that limit clears it: answers them, for a launch now
 * as the sweep's release has, and none where no turn waits on it any longer,
 * so of two releases at once only one hands a turn on, and a release late for
 * its limit leaves a later wait standing.
 */
export function releaseConversationWaitedTurns(
  target: TurnTarget,
  until: Date,
): TurnStateEffect<readonly WaitedTurn[]> {
  return releaseConversationWaits({
    userId: target.userId,
    conversationId: target.conversationId,
    until,
  });
}

/** Settles the turn a rewind keeps as its conversation's first, its work dropped, with no Stop or failure on it. */
export function settleKeptTurn(conversationId: string, turnId: string): TurnStateEffect<void> {
  return settleKept({ conversationId, turnId });
}

/** A turn read lapsed: its id, where it stood, the attempt it ran under, when it started, and when a Stop was asked of it. */
export type LapsedTurn = typeof LapsedTurnSchema.Type;

/** The conversation's turns still open that stand lapsed at `at`, oldest first. */
export function lapsedTurnsOf(
  conversationId: string,
  at: Date,
): TurnStateEffect<readonly LapsedTurn[]> {
  return findLapsed({ conversationId, at });
}

/** Whether the lapsed turn ran past its cap rather than its state's deadline. */
export function pastCap(turn: Pick<LapsedTurn, "startedAt">, at: Date): boolean {
  return turn.startedAt !== null && at.getTime() - turn.startedAt.getTime() > TURN_DEADLINE.CAP_MS;
}

/**
 * The sandboxes, among every account's, whose runner runs a cloud agent's
 * turn still inside its progress deadline at `at`, at most `limit` of them:
 * the ones the minute sweep keeps up while their turn runs, whatever their
 * runner posts, since a sandbox stops its idle window after its last touch
 * and a turn's deadline runs longer.
 */
export function runningTurnSandboxes(at: Date, limit: number): TurnStateEffect<readonly string[]> {
  return Effect.map(findRunningSandboxes({ at, limit }), (rows) =>
    rows.map((row) => row.sandboxName),
  );
}

/** A coding agent with a turn lapsed: its ids, and where its runner lives. */
export type LapsedAgent = typeof LapsedAgentSchema.Type;

/**
 * The coding agents, among every account's, with a turn still open that
 * stands lapsed at `at`, at most `limit` of them, drawn in an order of their
 * own each read: so agents a sweep could not reap, their runner lease held
 * by another call or their reap failed, are read again by a later sweep
 * without keeping every other lapsed agent waiting behind them.
 */
export function lapsedAgents(at: Date, limit: number): TurnStateEffect<readonly LapsedAgent[]> {
  return findLapsedAgents({ at, limit });
}
