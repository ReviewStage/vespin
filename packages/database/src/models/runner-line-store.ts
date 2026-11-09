/**
 * runner-line-store.ts -- the lines the service queues for a cloud agent's runner, read past the runner's cursor and acknowledged as it takes them.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account queues for, reads, or acknowledges another's
 * agent. A line is queued only for an agent of the account, in a
 * transaction that holds the agent's own advisory lock from before its
 * place is drawn until it commits: the sequence is shared by every agent and
 * holds no lock, so the lock is what keeps one agent's lines committed in
 * their order, whoever writes them and whether or not they hold the agent's
 * runner lease, and a runner that read up to one never passes over a line
 * below it (`../schemas/runner-line.ts`).
 *
 * A launch reads its own lines past its cursor, and beside them the
 * agent's message lines an earlier launch was written but never said it
 * took, so a launch that ended before it took a message hands it to the
 * next, while the turn the message awaits still waits on it. A line acknowledged is never
 * handed again; what an earlier launch was written of any other kind (a
 * stop, a model change, a retire) was that launch's alone, and the next
 * launch drops it as it starts, with the messages none took and none will
 * be handed. A launch's own lines stand whatever their age. A queue drops
 * the agent's lines past their expiry, which no launch would be handed any
 * more.
 */

import { TURN_STATUS, type WireValue, WireValueSchema } from "@repo/wire";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  not,
  or,
  sql,
} from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { type RunnerLineFile, runnerLine } from "../schemas/runner-line.js";
import { messages, turns } from "../schemas/storage.js";

type RunnerLineEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/**
 * How long a line stands before a queue drops it: well past the longest a
 * launch runs and the window an unacknowledged message is handed on in, so
 * nothing a launch could still be handed goes.
 */
const RUNNER_LINE_EXPIRY = Duration.days(1);

/**
 * The launch a message queued before any launch reads it is written for:
 * one below every launch's first event number, or that number itself for an
 * agent's first launch, so whichever launch runs next is handed it while no
 * launch took it, and takes it over as it queues it again (`queueRunnerLine`).
 */
export const ANY_LAUNCH = 0;

/** A message line's id as the column holds it: a UUID. */
const LINE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One line as a runner reads it: its place in the order, and the line itself. */
const RunnerLineSchema = Schema.Struct({ seq: Schema.Number, text: Schema.String });
export type RunnerLine = typeof RunnerLineSchema.Type;

const RunnerLineFileSchema = Schema.Struct({
  path: Schema.String,
  contents: Schema.String,
  mode: Schema.Number,
});

const insertLine = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    launch: Schema.Number,
    text: Schema.String,
    lineId: Schema.NullOr(Schema.String),
    files: Schema.NullOr(Schema.Array(RunnerLineFileSchema)),
    handed: Schema.NullOr(WireValueSchema),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: ({ userId, agentId, launch, text, lineId, files, handed, now }) =>
    Database.use((db) =>
      db
        .insert(runnerLine)
        .select((qb) =>
          qb
            .select({
              id: sql<string>`gen_random_uuid()`.as("id"),
              agentId: sql<string>`${agentTable.id}`.as("agent_id"),
              userId: sql<string>`${agentTable.userId}`.as("user_id"),
              launch: sql<number>`${launch}::bigint`.as("launch"),
              text: sql<string>`${text}::text`.as("text"),
              lineId: sql<string | null>`${lineId}::uuid`.as("line_id"),
              createdAt: sql<Date>`${now}::timestamptz`.as("created_at"),
              acceptedAt: sql<Date | null>`null::timestamptz`.as("accepted_at"),
              files: sql<
                readonly RunnerLineFile[] | null
              >`${files === null ? null : JSON.stringify(files)}::jsonb`.as("files"),
              handed:
                sql<WireValue | null>`${handed === null ? null : JSON.stringify(handed)}::jsonb`.as(
                  "handed",
                ),
            })
            .from(agentTable)
            .where(and(eq(agentTable.id, agentId), eq(agentTable.userId, userId))),
        )
        // Note that a send repeated under its key is answered the line it queued first, in its
        // place. A message queued for whichever launch runs next (launch 0) is taken over by the
        // launch that queues it again, as a Start's launch does its first message, as that launch
        // writes it, as a line resent to a session that holds it is (`requeueRunnerLine`); any
        // other line keeps its launch and text, so a repeat rewrites nothing the capture watches
        // and notifies nothing.
        .onConflictDoUpdate({
          target: [runnerLine.agentId, runnerLine.lineId],
          targetWhere: isNotNull(runnerLine.lineId),
          set: {
            launch: sql`case when ${runnerLine.launch} = ${ANY_LAUNCH} then excluded.launch else ${runnerLine.launch} end`,
            text: sql`case when ${runnerLine.launch} = ${ANY_LAUNCH} then excluded.text else ${runnerLine.text} end`,
          },
        })
        .returning({ seq: runnerLine.seq }),
    ),
});

const deleteExpired = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, before: Schema.Date }),
  execute: ({ userId, agentId, before }) =>
    Database.use((db) =>
      db
        .delete(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            lt(runnerLine.createdAt, before),
          ),
        ),
    ),
});

/**
 * That a message line's developer row still awaits a turn that is open: the
 * turn its send queued or joined, which no failure, end, or Stop has closed
 * (`turn-state.ts`), or, for a line put back untaken (`requeueRunnerLine`),
 * the turn that took it, which a limit cut short and a launch on the next
 * payer goes on with. So a launch is handed a message an earlier launch never
 * took only while its turn still waits on it, and never one whose turn
 * failed, which the developer was told of and resends themselves. Note that
 * a line is stamped taken in the batch that gives its row its turn, so a row
 * with a turn and its line untaken is only ever one put back.
 */
function awaitsOpenTurn() {
  return exists(
    queryBuilder
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(agentTable, eq(agentTable.conversationId, messages.conversationId))
      .innerJoin(turns, eq(turns.id, sql`coalesce(${messages.turnId}, ${messages.awaitsTurnId})`))
      .where(
        and(
          eq(agentTable.id, runnerLine.agentId),
          // Note that a line's id is the uuid its message's client id spells as text.
          sql`${messages.clientId} = ${runnerLine.lineId}::text`,
          inArray(turns.status, [TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]),
        ),
      ),
  );
}

const findLinesPast = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    launch: Schema.Number,
    after: Schema.Number,
    limit: Schema.Number,
  }),
  Result: RunnerLineSchema,
  execute: ({ userId, agentId, launch, after, limit }) =>
    Database.use((db) =>
      db
        .select({ seq: runnerLine.seq, text: runnerLine.text })
        .from(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            gt(runnerLine.seq, after),
            // Note that a message line a launch took is never handed again, whichever launch it was written for.
            or(isNull(runnerLine.lineId), isNull(runnerLine.acceptedAt)),
            or(
              eq(runnerLine.launch, launch),
              and(lt(runnerLine.launch, launch), isNotNull(runnerLine.lineId), awaitsOpenTurn()),
            ),
          ),
        )
        .orderBy(asc(runnerLine.seq))
        .limit(limit),
    ),
});

const findWaiting = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ createdAt: Schema.Date }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ createdAt: runnerLine.createdAt })
        .from(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            isNotNull(runnerLine.lineId),
            isNull(runnerLine.acceptedAt),
            awaitsOpenTurn(),
          ),
        )
        .orderBy(asc(runnerLine.createdAt))
        .limit(1),
    ),
});

const deleteHandedOn = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .delete(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            or(
              isNull(runnerLine.lineId),
              and(isNull(runnerLine.acceptedAt), not(awaitsOpenTurn())),
            ),
          ),
        ),
    ),
});

const deleteLine = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, lineId: Schema.String }),
  execute: ({ userId, agentId, lineId }) =>
    Database.use((db) =>
      db
        .delete(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            eq(runnerLine.lineId, lineId),
            isNull(runnerLine.acceptedAt),
          ),
        ),
    ),
});

const writeAccepted = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    lineId: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ handed: Schema.NullOr(WireValueSchema) }),
  execute: ({ userId, agentId, lineId, now }) =>
    Database.use((db) =>
      db
        .update(runnerLine)
        .set({ acceptedAt: now })
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            eq(runnerLine.lineId, lineId),
            isNull(runnerLine.acceptedAt),
          ),
        )
        .returning({ handed: runnerLine.handed }),
    ),
});

const writeRequeued = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, lineId: Schema.String }),
  execute: ({ userId, agentId, lineId }) =>
    Database.use((db) =>
      db
        .update(runnerLine)
        .set({ acceptedAt: null, launch: ANY_LAUNCH })
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            eq(runnerLine.lineId, lineId),
          ),
        ),
    ),
});

/** The files of the agent's message lines no launch took whose turn still waits on them, in the order they were queued. */
const findWaitingFiles = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ files: Schema.Array(RunnerLineFileSchema) }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ files: sql<readonly RunnerLineFile[]>`${runnerLine.files}` })
        .from(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            isNotNull(runnerLine.lineId),
            isNull(runnerLine.acceptedAt),
            isNotNull(runnerLine.files),
            awaitsOpenTurn(),
          ),
        )
        .orderBy(asc(runnerLine.seq)),
    ),
});

/** The handed state of the agent's newest message line no launch took whose turn still waits on it. */
const findPendingHanded = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ handed: WireValueSchema }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ handed: sql<WireValue>`${runnerLine.handed}` })
        .from(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            isNotNull(runnerLine.lineId),
            isNull(runnerLine.acceptedAt),
            isNotNull(runnerLine.handed),
            awaitsOpenTurn(),
          ),
        )
        .orderBy(desc(runnerLine.seq))
        .limit(1),
    ),
});

/**
 * Queues one line for the account's agent's runner, written for the launch
 * named by its first event number, under the agent's advisory lock, and
 * drops the agent's lines past their expiry; answers the line's
 * place, the place it was queued at first for a message line queued again
 * under its id, or none where the account holds no such agent.
 */
export function queueRunnerLine(
  userId: string,
  line: {
    readonly agentId: string;
    readonly launch: number;
    readonly text: string;
    /** A message line's own id, the send's key; none for any other kind. */
    readonly lineId?: string;
    /** The files a message line names, which a launch writes before its runner reads it; none where it names none. */
    readonly files?: readonly RunnerLineFile[];
    /** What the session will have been handed once its runner takes the message line, which its ACCEPTED writes (`acceptRunnerLine`). */
    readonly handed?: WireValue;
  },
): RunnerLineEffect<Option.Option<number>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        // Note that the lock is taken before the insert draws its place, so the agent's next line draws a later one.
        yield* client`select pg_advisory_xact_lock(hashtextextended(${line.agentId}, 0))`;
        const now = yield* DateTime.nowAsDate;
        const before = new Date(now.getTime() - Duration.toMillis(RUNNER_LINE_EXPIRY));
        yield* deleteExpired({ userId, agentId: line.agentId, before });
        const rows = yield* insertLine({
          userId,
          agentId: line.agentId,
          launch: line.launch,
          text: line.text,
          lineId: line.lineId ?? null,
          files: line.files === undefined || line.files.length === 0 ? null : line.files,
          handed: line.handed ?? null,
          now,
        });
        return Option.map(Option.fromNullishOr(rows[0]), (row) => row.seq);
      }),
    ),
  );
}

/**
 * The account's agent's lines the launch named is handed past its cursor,
 * in order, at most `limit`: those written for the launch, and the message
 * lines an earlier launch was written and never acknowledged whose turn
 * still waits on them (`awaitsOpenTurn`).
 */
export function runnerLinesPast(
  userId: string,
  agentId: string,
  read: { readonly launch: number; readonly after: number; readonly limit: number },
): RunnerLineEffect<readonly RunnerLine[]> {
  return findLinesPast({ userId, agentId, ...read });
}

/** When the oldest message line of the account's agent was queued that no launch acknowledged and whose turn still waits on it, which a launch would be handed; none where none stands. */
export function runnerLineWaitingSince(
  userId: string,
  agentId: string,
): RunnerLineEffect<Option.Option<Date>> {
  return Effect.map(
    findWaiting({ userId, agentId }),
    Option.map((row) => row.createdAt),
  );
}

/**
 * The account's agent's lines dropped as a new launch starts, its caller
 * holding the agent's runner lease: every line an earlier launch was
 * written that is no message (a stop, a model change, a retire), which was
 * that launch's alone, and every message no launch took whose turn no longer
 * waits on it, which none will be handed. Note that a launch that applied
 * no event before it ended leaves the next its first event number, so such
 * a line would otherwise read as the new launch's own, which a launch reads
 * whatever its age.
 */
export function clearRunnerLines(userId: string, agentId: string): RunnerLineEffect<void> {
  return deleteHandedOn({ userId, agentId });
}

/** The account's agent's message line under its id withdrawn, where no launch took it, as for a launch that failed before its runner could read it, whose send answered failed. */
export function withdrawRunnerLine(
  userId: string,
  agentId: string,
  lineId: string,
): RunnerLineEffect<void> {
  return deleteLine({ userId, agentId, lineId });
}

/**
 * The account's agent's message line under its id stamped acknowledged, as
 * its runner said it took it; nothing where it already was, or none stands.
 * Note that an id no line could carry is passed over before the statement,
 * because a runner names it in an event of its own, and the column would
 * refuse it, failing the batch it came in.
 */
export function acceptRunnerLine(
  userId: string,
  agentId: string,
  lineId: string,
): RunnerLineEffect<Option.Option<WireValue>> {
  if (!LINE_ID.test(lineId)) return Effect.succeed(Option.none());
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeAccepted({ userId, agentId, lineId, now }), (rows) =>
      Option.fromNullishOr(rows[0]?.handed),
    ),
  );
}

/**
 * The account's agent's message line under its id put back as no launch's
 * and untaken, as a turn its plan's limit cut short is handed on to a launch
 * on the next payer (`retry`): the line it queues again under the same id
 * then takes the row over for that launch (`insertLine`), which a line taken
 * would otherwise keep from it. Nothing where no such line stands, or the id
 * is none a line could carry.
 */
export function requeueRunnerLine(
  userId: string,
  agentId: string,
  lineId: string,
): RunnerLineEffect<void> {
  if (!LINE_ID.test(lineId)) return Effect.void;
  return writeRequeued({ userId, agentId, lineId });
}

/**
 * The files the account's agent's message lines no launch took name, whose
 * turn still waits on them (`awaitsOpenTurn`), in the order they were
 * queued: what a launch writes into its place before its runner reads them.
 */
export function waitingRunnerFiles(
  userId: string,
  agentId: string,
): RunnerLineEffect<readonly RunnerLineFile[]> {
  return Effect.map(findWaitingFiles({ userId, agentId }), (rows) =>
    rows.flatMap((row) => row.files),
  );
}

/**
 * What the session will have been handed once its runner takes the account's
 * agent's newest message line no launch took whose turn still waits on it;
 * none where no such line carries it. The next line is composed against it,
 * so a line queued behind another hands only what that one does not.
 */
export function pendingRunnerHanded(
  userId: string,
  agentId: string,
): RunnerLineEffect<Option.Option<WireValue>> {
  return Effect.map(
    findPendingHanded({ userId, agentId }),
    Option.map((row) => row.handed),
  );
}
