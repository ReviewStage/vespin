/**
 * conductor-import-store.ts -- what a workspace imported from Conductor, and each import run with its sealed key and where each of its workspaces and chats stands.
 *
 * Every function is an effect over the ambient `SqlClient`. The imports are
 * keyed by the workspace and Conductor's id, so no workspace reads or skips
 * on another's; a run and its items are read by the run's id, which only
 * the service holds, or by the member and the workspace together, so no
 * account reads another's run. Who may call each is the caller's to check.
 * The key goes in sealed (`provider-key-seal.ts`'s `sealConductorKey`) and
 * comes out sealed: this module never sees it in the clear.
 */

import {
  CONDUCTOR_IMPORT_FAILURE,
  CONDUCTOR_IMPORT_KIND,
  CONDUCTOR_IMPORT_STATUS,
} from "@repo/features/conductor-import-wire";
import { and, desc, eq, inArray, isNotNull, lt, lte, ne, notExists, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { member, user } from "../schemas/auth.js";
import {
  conductorImport,
  conductorImportItem,
  conductorImportRun,
} from "../schemas/conductor-import.js";
import { InstantColumnSchema } from "./columns.js";

type ImportEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const KindSchema = Schema.Literals(Object.values(CONDUCTOR_IMPORT_KIND));

const StatusSchema = Schema.Literals(Object.values(CONDUCTOR_IMPORT_STATUS));

const FailureSchema = Schema.Literals(Object.values(CONDUCTOR_IMPORT_FAILURE));

const ImportedSchema = Schema.Struct({
  conductorId: Schema.String,
  kind: KindSchema,
  taskId: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
});

/** A workspace or a chat a workspace imported: the task or the agent it became. */
export type ConductorImported = typeof ImportedSchema.Type;

const RunSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  userId: Schema.String,
  sealedKey: Schema.NullOr(Schema.String),
  startedAt: InstantColumnSchema,
});

/** A run as its row holds it: whose it is, in which workspace, and its key sealed while it has work queued. */
export type ConductorImportRunRow = typeof RunSchema.Type;

const ItemSchema = Schema.Struct({
  conductorId: Schema.String,
  kind: KindSchema,
  workspaceConductorId: Schema.String,
  name: Schema.NullOr(Schema.String),
  status: StatusSchema,
  failure: Schema.NullOr(FailureSchema),
});

/** One workspace or chat of a run, where it stands. */
export type ConductorImportItemRow = typeof ItemSchema.Type;

/** One workspace or chat a run queues. */
export type ConductorImportQueued = Pick<
  ConductorImportItemRow,
  "conductorId" | "kind" | "workspaceConductorId" | "name"
>;

const findImported = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    conductorIds: Schema.Array(Schema.String),
  }),
  Result: ImportedSchema,
  execute: ({ organizationId, conductorIds }) =>
    Database.use((db) =>
      db
        .select({
          conductorId: conductorImport.conductorId,
          kind: conductorImport.kind,
          taskId: conductorImport.taskId,
          agentId: conductorImport.agentId,
        })
        .from(conductorImport)
        .where(
          and(
            eq(conductorImport.organizationId, organizationId),
            inArray(conductorImport.conductorId, [...conductorIds]),
          ),
        ),
    ),
});

const insertImported = SqlSchema.void({
  Request: Schema.Struct({
    organizationId: Schema.String,
    conductorId: Schema.String,
    kind: KindSchema,
    taskId: Schema.NullOr(Schema.String),
    agentId: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  execute: ({ now, ...row }) =>
    Database.use((db) =>
      db
        .insert(conductorImport)
        .values({ ...row, importedAt: now })
        .onConflictDoNothing(),
    ),
});

const insertRun = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    organizationId: Schema.String,
    userId: Schema.String,
    sealedKey: Schema.String,
    startedAt: Schema.Date,
    keyExpiresAt: Schema.Date,
  }),
  execute: (row) => Database.use((db) => db.insert(conductorImportRun).values(row)),
});

const RUN_COLUMNS = {
  id: conductorImportRun.id,
  organizationId: conductorImportRun.organizationId,
  userId: conductorImportRun.userId,
  sealedKey: conductorImportRun.sealedKey,
  startedAt: conductorImportRun.startedAt,
};

const findRun = SqlSchema.findAll({
  Request: Schema.String,
  Result: RunSchema,
  execute: (runId) =>
    Database.use((db) =>
      db.select(RUN_COLUMNS).from(conductorImportRun).where(eq(conductorImportRun.id, runId)),
    ),
});

const findNewestRun = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: RunSchema,
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select(RUN_COLUMNS)
        .from(conductorImportRun)
        .where(
          and(
            eq(conductorImportRun.userId, userId),
            eq(conductorImportRun.organizationId, organizationId),
          ),
        )
        .orderBy(desc(conductorImportRun.startedAt))
        .limit(1),
    ),
});

const findItems = SqlSchema.findAll({
  Request: Schema.String,
  Result: ItemSchema,
  execute: (runId) =>
    Database.use((db) =>
      db
        .select({
          conductorId: conductorImportItem.conductorId,
          kind: conductorImportItem.kind,
          workspaceConductorId: conductorImportItem.workspaceConductorId,
          name: conductorImportItem.name,
          status: conductorImportItem.status,
          failure: conductorImportItem.failure,
        })
        .from(conductorImportItem)
        .where(eq(conductorImportItem.runId, runId))
        .orderBy(conductorImportItem.workspaceConductorId, conductorImportItem.kind),
    ),
});

const insertItems = SqlSchema.void({
  Request: Schema.Struct({
    runId: Schema.String,
    items: Schema.Array(
      Schema.Struct({
        conductorId: Schema.String,
        kind: KindSchema,
        workspaceConductorId: Schema.String,
        name: Schema.NullOr(Schema.String),
      }),
    ),
    now: Schema.Date,
  }),
  execute: ({ runId, items, now }) =>
    Database.use((db) =>
      db
        .insert(conductorImportItem)
        .values(
          items.map((item) => ({
            ...item,
            runId,
            status: CONDUCTOR_IMPORT_STATUS.QUEUED,
            failure: null,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing(),
    ),
});

const updateItem = SqlSchema.void({
  Request: Schema.Struct({
    runId: Schema.String,
    conductorId: Schema.String,
    status: StatusSchema,
    failure: Schema.NullOr(FailureSchema),
    now: Schema.Date,
  }),
  execute: ({ runId, conductorId, status, failure, now }) =>
    Database.use((db) =>
      db
        .update(conductorImportItem)
        .set({ status, failure, updatedAt: now })
        .where(
          and(
            eq(conductorImportItem.runId, runId),
            eq(conductorImportItem.conductorId, conductorId),
          ),
        ),
    ),
});

/** The run's key cleared once none of its items is queued, answering whether it was. */
const clearEndedKey = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (runId) =>
    Database.use((db) =>
      db
        .update(conductorImportRun)
        .set({ sealedKey: null })
        .where(
          and(
            eq(conductorImportRun.id, runId),
            isNotNull(conductorImportRun.sealedKey),
            notExists(
              db
                .select({ one: sql`1` })
                .from(conductorImportItem)
                .where(
                  and(
                    eq(conductorImportItem.runId, runId),
                    eq(conductorImportItem.status, CONDUCTOR_IMPORT_STATUS.QUEUED),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: conductorImportRun.id }),
    ),
});

const clearExpiredKeys = SqlSchema.findAll({
  Request: Schema.Date,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (now) =>
    Database.use((db) =>
      db
        .update(conductorImportRun)
        .set({ sealedKey: null })
        .where(
          and(isNotNull(conductorImportRun.sealedKey), lte(conductorImportRun.keyExpiresAt, now)),
        )
        .returning({ id: conductorImportRun.id }),
    ),
});

const deleteRunsBefore = SqlSchema.findAll({
  Request: Schema.Date,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (before) =>
    Database.use((db) =>
      db
        .delete(conductorImportRun)
        .where(lt(conductorImportRun.startedAt, before))
        .returning({ id: conductorImportRun.id }),
    ),
});

const findMembersNamed = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, name: Schema.String }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ organizationId, name }) =>
    Database.use((db) =>
      db
        .select({ userId: member.userId })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(
          and(
            eq(member.organizationId, organizationId),
            ne(user.name, ""),
            sql`lower(btrim(${user.name})) = lower(btrim(${name}))`,
          ),
        ),
    ),
});

/** What the workspace imported of the Conductor ids named, by id; an id it never imported is left out. */
export function readConductorImports(
  organizationId: string,
  conductorIds: readonly string[],
): ImportEffect<ReadonlyMap<string, ConductorImported>> {
  if (conductorIds.length === 0) return Effect.succeed(new Map());

  return Effect.map(
    findImported({ organizationId, conductorIds }),
    (rows) => new Map(rows.map((row) => [row.conductorId, row])),
  );
}

/** A workspace's task or a chat's agent recorded as imported; one recorded already keeps its first row. */
export function recordConductorImport(
  organizationId: string,
  imported: ConductorImported,
  now: Date,
): ImportEffect<void> {
  return insertImported({ organizationId, ...imported, now });
}

/** A run begun by the member in the workspace, its key sealed for it, cleared by the sweep at `keyExpiresAt` at the latest. */
export function beginConductorImportRun(run: {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly sealedKey: string;
  readonly startedAt: Date;
  readonly keyExpiresAt: Date;
}): ImportEffect<void> {
  return insertRun(run);
}

/** The run of this id, for the queue's consumer; none where it was deleted. */
export function readConductorImportRun(
  runId: string,
): ImportEffect<Option.Option<ConductorImportRunRow>> {
  return Effect.map(findRun(runId), (rows) => Option.fromNullishOr(rows[0]));
}

/** The member's newest run in the workspace, with its items; none where they ran none or it was deleted. */
export function readNewestConductorImportRun(
  userId: string,
  organizationId: string,
): ImportEffect<
  Option.Option<{
    readonly run: ConductorImportRunRow;
    readonly items: readonly ConductorImportItemRow[];
  }>
> {
  return Effect.gen(function* () {
    const [run] = yield* findNewestRun({ userId, organizationId });

    if (run === undefined) return Option.none();

    return Option.some({ run, items: yield* findItems(run.id) });
  });
}

/** Workspaces or chats queued on the run; one it holds already keeps where it stands. */
export function queueConductorImportItems(
  runId: string,
  items: readonly ConductorImportQueued[],
  now: Date,
): ImportEffect<void> {
  if (items.length === 0) return Effect.void;

  return insertItems({ runId, items, now });
}

/**
 * One item of the run settled as it ended, with why where it failed, and
 * the run's key cleared where nothing of it is still queued, answering
 * whether that cleared it.
 */
export function settleConductorImportItem(
  runId: string,
  conductorId: string,
  settled: {
    readonly status: Exclude<
      ConductorImportItemRow["status"],
      typeof CONDUCTOR_IMPORT_STATUS.QUEUED
    >;
    readonly failure: ConductorImportItemRow["failure"];
  },
  now: Date,
): ImportEffect<boolean> {
  return Effect.gen(function* () {
    yield* updateItem({ runId, conductorId, ...settled, now });

    return (yield* clearEndedKey(runId)).length > 0;
  });
}

/** The run's key cleared where nothing of it is still queued, answering whether that cleared it. */
export function clearEndedConductorImportKey(runId: string): ImportEffect<boolean> {
  return Effect.map(clearEndedKey(runId), (rows) => rows.length > 0);
}

/**
 * The sweep's: every run's key past its expiry cleared, and every run begun
 * before `deleteBefore` deleted with its items, answering how many of each.
 */
export function sweepConductorImportRuns(
  now: Date,
  deleteBefore: Date,
): ImportEffect<{ readonly keysCleared: number; readonly runsDeleted: number }> {
  return Effect.gen(function* () {
    const cleared = yield* clearExpiredKeys(now);
    const deleted = yield* deleteRunsBefore(deleteBefore);

    return { keysCleared: cleared.length, runsDeleted: deleted.length };
  });
}

/** The members of the workspace whose account's name is the one given, its case and outer spaces aside. */
export function workspaceMembersNamed(
  organizationId: string,
  name: string,
): ImportEffect<readonly string[]> {
  return Effect.map(findMembersNamed({ organizationId, name }), (rows) =>
    rows.map((row) => row.userId),
  );
}
