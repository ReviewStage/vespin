/**
 * admin-billing-queries.ts -- the usage ledger read across workspaces for the admin dashboard: one month's usage by workspace, the months it holds, one workspace's months and members, and one account's month by workspace.
 *
 * The ledger's own reads (`@repo/database/models/usage-charges`) each name
 * one workspace, as every member-facing read must; these are the admin's
 * alone, behind the dashboard's gate, and sum the same rows by the same UTC
 * month (`utcMonthOf`). Each answers ids, names of workspaces and accounts,
 * and sums: never a charge's figures.
 */

import { Database } from "@repo/database/core/query";
import { utcMonthOf, workspaceMonthMemberTotals } from "@repo/database/models/usage-charges";
import { WORKSPACE_NAME } from "@repo/database/models/workspace-store";
import { organization } from "@repo/database/schemas/auth";
import { usageChargeTable } from "@repo/database/schemas/usage-charge";
import { and, desc, eq, gte, lt, sql, sum } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { isAdminRole } from "./admin-access.js";
import {
  type AdminBillingSource,
  type AdminBillingWorkspaceSource,
  type AdminWorkspaceBillingSource,
  buildAdminAccountSandboxUsage,
  buildAdminBilling,
  buildAdminWorkspaceBilling,
} from "./admin-billing.js";
import { AggregateColumnSchema, findAccountFaces } from "./admin-queries.js";
import { PERSONAL } from "./admin-workspaces-queries.js";
import type { AdminSeamEffect } from "./seam.js";

/** A charge's UTC month, as `YYYY-MM`. */
const CHARGE_MONTH = sql<string>`to_char(${usageChargeTable.occurredAt} at time zone 'UTC', 'YYYY-MM')`;

/** The charges summed; a bigint's sum is Postgres's numeric, which the aggregate schema reads. */
const SUMMED = sql<string>`coalesce(${sum(usageChargeTable.amountMicroUsd)}, 0)`;

const MonthRangeSchema = Schema.Struct({ from: Schema.Date, to: Schema.Date });

const WorkspaceUsageSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  personal: Schema.Boolean,
  usageMicroUsd: AggregateColumnSchema,
});

/** The charges between the two instants, the first held and the second not. */
function between(range: typeof MonthRangeSchema.Type) {
  return and(
    gte(usageChargeTable.occurredAt, range.from),
    lt(usageChargeTable.occurredAt, range.to),
  );
}

/** Each workspace with charges in the month, its name as its members read it, and their sum. */
const findMonthWorkspaces = SqlSchema.findAll({
  Request: MonthRangeSchema,
  Result: WorkspaceUsageSchema,
  execute: (range) =>
    Database.use((db) =>
      db
        .select({
          id: organization.id,
          name: WORKSPACE_NAME,
          personal: PERSONAL,
          usageMicroUsd: SUMMED,
        })
        .from(usageChargeTable)
        .innerJoin(organization, eq(organization.id, usageChargeTable.organizationId))
        .where(between(range))
        .groupBy(organization.id),
    ),
});

/** Every UTC month the ledger holds a charge in. */
const findLedgerMonths = SqlSchema.findAll({
  Request: Schema.Void,
  Result: Schema.Struct({ month: Schema.String }),
  execute: () =>
    Database.use((db) =>
      db.selectDistinct({ month: CHARGE_MONTH }).from(usageChargeTable).orderBy(desc(CHARGE_MONTH)),
    ),
});

/** One workspace's charges summed by UTC month. */
const findWorkspaceMonths = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ month: Schema.String, usageMicroUsd: AggregateColumnSchema }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ month: CHARGE_MONTH, usageMicroUsd: SUMMED })
        .from(usageChargeTable)
        .where(eq(usageChargeTable.organizationId, organizationId))
        .groupBy(CHARGE_MONTH),
    ),
});

/** One account's charges in the month, by the workspace each was charged to. */
const findAccountWorkspaces = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, ...MonthRangeSchema.fields }),
  Result: WorkspaceUsageSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select({
          id: organization.id,
          name: WORKSPACE_NAME,
          personal: PERSONAL,
          usageMicroUsd: SUMMED,
        })
        .from(usageChargeTable)
        .innerJoin(organization, eq(organization.id, usageChargeTable.organizationId))
        .where(and(eq(usageChargeTable.userId, request.userId), between(request)))
        .groupBy(organization.id),
    ),
});

/** The month's first instant and the next month's, from its `YYYY-MM` key. */
function monthRange(month: string) {
  return utcMonthOf(new Date(`${month}-01T00:00:00.000Z`));
}

/** The source the Billing screen's answer is built from. */
function readAdminBillingSource(month: string): AdminSeamEffect<AdminBillingSource> {
  return Effect.map(
    Effect.all([findLedgerMonths(undefined), findMonthWorkspaces(monthRange(month))], {
      concurrency: "unbounded",
    }),
    ([months, workspaces]) => ({ months: months.map((row) => row.month), workspaces }),
  );
}

/** The Billing screen's answer for the month, its `YYYY-MM` key. */
export function readAdminBilling(month: string, now: number) {
  return Effect.map(readAdminBillingSource(month), (source) =>
    buildAdminBilling(source, month, now),
  );
}

/** One workspace's usage by month and its current month by member, each member's face named where the account still stands. */
function readWorkspaceBillingSource(
  organizationId: string,
  now: number,
): AdminSeamEffect<AdminWorkspaceBillingSource> {
  return Effect.gen(function* () {
    const [months, memberTotals] = yield* Effect.all(
      [
        findWorkspaceMonths(organizationId),
        workspaceMonthMemberTotals(organizationId, new Date(now)),
      ],
      { concurrency: "unbounded" },
    );

    const userIds = memberTotals.flatMap((row) => (row.userId === null ? [] : [row.userId]));
    const faces = userIds.length === 0 ? [] : yield* findAccountFaces(userIds);

    const faceById = new Map(
      faces.map(({ role, ...face }) => [face.id, { ...face, admin: isAdminRole(role) }]),
    );

    return {
      months,
      members: memberTotals.map((row) => ({
        userId: row.userId,
        account: row.userId === null ? null : (faceById.get(row.userId) ?? null),
        usageMicroUsd: row.amountMicroUsd,
      })),
    };
  });
}

/** One workspace's page's billing section. */
export function readAdminWorkspaceBilling(organizationId: string, now: number) {
  return Effect.map(readWorkspaceBillingSource(organizationId, now), (source) =>
    buildAdminWorkspaceBilling(source, now),
  );
}

/** One account's page's sandbox usage this month, by workspace. */
export function readAdminAccountSandboxUsage(userId: string, now: number) {
  return Effect.map(
    findAccountWorkspaces({ userId, ...utcMonthOf(new Date(now)) }),
    (workspaces: readonly AdminBillingWorkspaceSource[]) =>
      buildAdminAccountSandboxUsage(workspaces, now),
  );
}
