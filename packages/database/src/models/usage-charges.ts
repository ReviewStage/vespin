/**
 * usage-charges.ts -- the usage ledger's writes and reads: charges recorded once per item, and one workspace's month totalled by kind or by member.
 *
 * A charge is recorded by its kind and the id its source gives the item
 * (`../schemas/usage-charge.ts`); one already recorded is left as it stood,
 * so a source read again over the same items records nothing new. A month is
 * the UTC calendar month, from its first instant to the next month's, and a
 * charge falls in the month its usage happened in. Every month read names
 * its workspace, so none answers another workspace's charges; the charges
 * not yet sent on to be invoiced are read by their row ids or their items'
 * ids, across workspaces, by the usage queues that send them
 * (`@repo/service`'s `billing/usage-queues.ts`), and stamped as sent once
 * they are.
 */

import { and, asc, eq, gte, inArray, isNull, lt, min, sql, sum } from "drizzle-orm";
import { Array as Arr, Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { usageChargeTable } from "../schemas/usage-charge.js";
import { UsageFiguresSchema, type UsageKind, usageKindSchema } from "../usage-vocabulary.js";
import type { AgentStoreEffect } from "./agent-store.js";

/**
 * How many charges one statement writes. Note that a write is cut into
 * statements of this many, because a day's sessions run to thousands and
 * Postgres takes at most 65,535 parameters a statement, nine a charge here.
 */
const WRITE_CHUNK = 1000;

const ChargeSchema = Schema.Struct({
  organizationId: Schema.String,
  userId: Schema.NullOr(Schema.String),
  kind: usageKindSchema,
  sourceId: Schema.String,
  figures: UsageFiguresSchema,
  amountMicroUsd: Schema.Int,
  occurredAt: Schema.Date,
});

/** One billable item as the ledger records it: whose it is, what it was, what it was priced from, and what it cost. */
export type UsageCharge = typeof ChargeSchema.Type;

const MonthSchema = Schema.Struct({
  organizationId: Schema.String,
  from: Schema.Date,
  to: Schema.Date,
});

const KindTotalSchema = Schema.Struct({ kind: usageKindSchema, amountMicroUsd: Schema.Number });

/** What one kind of usage cost a workspace in a month, in micro-dollars. */
export type UsageKindTotal = typeof KindTotalSchema.Type;

const MemberTotalSchema = Schema.Struct({
  userId: Schema.NullOr(Schema.String),
  amountMicroUsd: Schema.Number,
});

/** What a member's usage cost a workspace in a month, in micro-dollars; the usage that was no member's under a null id. */
export type UsageMemberTotal = typeof MemberTotalSchema.Type;

const insertCharges = SqlSchema.findAll({
  Request: Schema.Array(ChargeSchema),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (charges) =>
    Database.use((db) =>
      db
        .insert(usageChargeTable)
        .values([...charges])
        // An item already charged stands as it was first charged.
        .onConflictDoNothing({ target: [usageChargeTable.kind, usageChargeTable.sourceId] })
        .returning({ id: usageChargeTable.id }),
    ),
});

const UnsentSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  kind: usageKindSchema,
  amountMicroUsd: Schema.Int,
  occurredAt: Schema.Date,
});

/** A charge not yet sent on to be invoiced: its row's id, whose it is, what kind, what it cost, and when it happened. */
export type UnsentUsageCharge = typeof UnsentSchema.Type;

const findUnsent = SqlSchema.findAll({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  Result: UnsentSchema,
  execute: ({ ids }) =>
    Database.use((db) =>
      db
        .select({
          id: usageChargeTable.id,
          organizationId: usageChargeTable.organizationId,
          kind: usageChargeTable.kind,
          amountMicroUsd: usageChargeTable.amountMicroUsd,
          occurredAt: usageChargeTable.occurredAt,
        })
        .from(usageChargeTable)
        .where(and(inArray(usageChargeTable.id, [...ids]), isNull(usageChargeTable.sentAt)))
        .orderBy(asc(usageChargeTable.id)),
    ),
});

const findUnsentOfSources = SqlSchema.findAll({
  Request: Schema.Struct({ kind: usageKindSchema, sourceIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ kind, sourceIds }) =>
    Database.use((db) =>
      db
        .select({ id: usageChargeTable.id })
        .from(usageChargeTable)
        .where(
          and(
            eq(usageChargeTable.kind, kind),
            inArray(usageChargeTable.sourceId, [...sourceIds]),
            isNull(usageChargeTable.sentAt),
          ),
        )
        .orderBy(asc(usageChargeTable.id)),
    ),
});

const findEarliestUnsent = SqlSchema.findAll({
  Request: Schema.Struct({ organizationIds: Schema.Array(Schema.String), since: Schema.Date }),
  Result: Schema.Struct({ organizationId: Schema.String, occurredAt: Schema.Date }),
  execute: ({ organizationIds, since }) =>
    Database.use((db) =>
      db
        .select({
          organizationId: usageChargeTable.organizationId,
          occurredAt: sql<Date>`${min(usageChargeTable.occurredAt)}`.mapWith(
            usageChargeTable.occurredAt,
          ),
        })
        .from(usageChargeTable)
        .where(
          and(
            inArray(usageChargeTable.organizationId, [...organizationIds]),
            isNull(usageChargeTable.sentAt),
            gte(usageChargeTable.occurredAt, since),
          ),
        )
        .groupBy(usageChargeTable.organizationId),
    ),
});

const stampSent = SqlSchema.void({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String), sentAt: Schema.Date }),
  execute: ({ ids, sentAt }) =>
    Database.use((db) =>
      db
        .update(usageChargeTable)
        .set({ sentAt })
        .where(and(inArray(usageChargeTable.id, [...ids]), isNull(usageChargeTable.sentAt))),
    ),
});

/** The workspace's charges that fall in the month. */
function inMonth(month: typeof MonthSchema.Type) {
  return and(
    eq(usageChargeTable.organizationId, month.organizationId),
    gte(usageChargeTable.occurredAt, month.from),
    lt(usageChargeTable.occurredAt, month.to),
  );
}

/** The month's charges summed, as a number: a bigint's sum is Postgres's numeric, read as text. */
const SUMMED = sql<string>`coalesce(${sum(usageChargeTable.amountMicroUsd)}, 0)`.mapWith(Number);

const findKindTotals = SqlSchema.findAll({
  Request: MonthSchema,
  Result: KindTotalSchema,
  execute: (month) =>
    Database.use((db) =>
      db
        .select({ kind: usageChargeTable.kind, amountMicroUsd: SUMMED })
        .from(usageChargeTable)
        .where(inMonth(month))
        .groupBy(usageChargeTable.kind)
        .orderBy(usageChargeTable.kind),
    ),
});

const findMemberTotals = SqlSchema.findAll({
  Request: MonthSchema,
  Result: MemberTotalSchema,
  execute: (month) =>
    Database.use((db) =>
      db
        .select({ userId: usageChargeTable.userId, amountMicroUsd: SUMMED })
        .from(usageChargeTable)
        .where(inMonth(month))
        .groupBy(usageChargeTable.userId)
        .orderBy(usageChargeTable.userId),
    ),
});

/** The UTC calendar month the instant falls in: its first instant, and the next month's. */
export function utcMonthOf(instant: Date) {
  const year = instant.getUTCFullYear();
  const month = instant.getUTCMonth();

  return { from: new Date(Date.UTC(year, month, 1)), to: new Date(Date.UTC(year, month + 1, 1)) };
}

/** Records the charges, leaving any item already charged as it stood; how many were new. */
export function recordUsageCharges(charges: readonly UsageCharge[]): AgentStoreEffect<number> {
  return Effect.map(Effect.forEach(Arr.chunksOf(charges, WRITE_CHUNK), insertCharges), (recorded) =>
    recorded.reduce((total, chunk) => total + chunk.length, 0),
  );
}

/** What each kind of usage cost the workspace in the UTC month the instant falls in; a kind with no charges is left out. */
export function workspaceMonthTotals(
  organizationId: string,
  instant: Date,
): AgentStoreEffect<readonly UsageKindTotal[]> {
  return findKindTotals({ organizationId, ...utcMonthOf(instant) });
}

/** What each member's usage cost the workspace in the UTC month the instant falls in, the usage that was no member's under a null id; a member with no charges is left out. */
export function workspaceMonthMemberTotals(
  organizationId: string,
  instant: Date,
): AgentStoreEffect<readonly UsageMemberTotal[]> {
  return findMemberTotals({ organizationId, ...utcMonthOf(instant) });
}

/** The charges among the row ids named that are not yet sent on, in the order of their ids; one sent or no charge's is left out. */
export function unsentUsageChargesOf(
  ids: readonly string[],
): AgentStoreEffect<readonly UnsentUsageCharge[]> {
  if (ids.length === 0) return Effect.succeed([]);

  return Effect.map(
    Effect.forEach(Arr.chunksOf(ids, WRITE_CHUNK), (chunk) => findUnsent({ ids: chunk })),
    (pages) => pages.flat(),
  );
}

/** The row ids of the charges of the kind whose items are those named that are not yet sent on, whether recorded just now or before. */
export function unsentChargeIdsOf(
  kind: UsageKind,
  sourceIds: readonly string[],
): AgentStoreEffect<readonly string[]> {
  if (sourceIds.length === 0) return Effect.succeed([]);

  return Effect.map(
    Effect.forEach(Arr.chunksOf(sourceIds, WRITE_CHUNK), (chunk) =>
      findUnsentOfSources({ kind, sourceIds: chunk }),
    ),
    (rows) => rows.flat().map((row) => row.id),
  );
}

/** When each of the workspaces' earliest charge not yet sent on happened, at or after `since`; a workspace with none is left out. */
export function earliestUnsentUsage(
  organizationIds: readonly string[],
  since: Date,
): AgentStoreEffect<ReadonlyMap<string, Date>> {
  if (organizationIds.length === 0) return Effect.succeed(new Map());

  return Effect.map(
    findEarliestUnsent({ organizationIds, since }),
    (rows) => new Map(rows.map((row) => [row.organizationId, row.occurredAt])),
  );
}

/** Stamps the charges as sent on at the instant; one already stamped keeps its first stamp. */
export function markUsageChargesSent(ids: readonly string[], sentAt: Date): AgentStoreEffect<void> {
  return ids.length === 0 ? Effect.void : stampSent({ ids, sentAt });
}
