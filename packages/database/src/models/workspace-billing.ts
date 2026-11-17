/**
 * workspace-billing.ts -- where each workspace is billed, written as its Metronome customer and contract are made and read by workspace.
 *
 * A workspace's row is written the first time it has usage to send
 * (`../schemas/workspace-billing.ts`): its Metronome customer first, then
 * its contract. The first customer recorded stands, so two sends that raced
 * to make one both carry on with the one kept. Every read and write names
 * its workspace, so none reaches another's row.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { workspaceBillingTable } from "../schemas/workspace-billing.js";
import type { AgentStoreEffect } from "./agent-store.js";

const BillingSchema = Schema.Struct({
  organizationId: Schema.String,
  metronomeCustomerId: Schema.String,
  metronomeContractId: Schema.NullOr(Schema.String),
  stripeCustomerId: Schema.NullOr(Schema.String),
  blockedAt: Schema.NullOr(Schema.Date),
});

/** Where a workspace is billed: its Metronome customer and contract, its Stripe customer, and since when it is blocked, null where none. */
export type WorkspaceBilling = typeof BillingSchema.Type;

const BILLING_COLUMNS = {
  organizationId: workspaceBillingTable.organizationId,
  metronomeCustomerId: workspaceBillingTable.metronomeCustomerId,
  metronomeContractId: workspaceBillingTable.metronomeContractId,
  stripeCustomerId: workspaceBillingTable.stripeCustomerId,
  blockedAt: workspaceBillingTable.blockedAt,
};

const CustomerSchema = Schema.Struct({
  organizationId: Schema.String,
  metronomeCustomerId: Schema.String,
});

const ContractSchema = Schema.Struct({
  organizationId: Schema.String,
  metronomeContractId: Schema.String,
});

const findBillings = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: BillingSchema,
  execute: (organizationIds) =>
    Database.use((db) =>
      db
        .select(BILLING_COLUMNS)
        .from(workspaceBillingTable)
        .where(inArray(workspaceBillingTable.organizationId, [...organizationIds])),
    ),
});

const insertCustomer = SqlSchema.findAll({
  Request: CustomerSchema,
  Result: BillingSchema,
  execute: (customer) =>
    Database.use((db) =>
      db
        .insert(workspaceBillingTable)
        .values(customer)
        // The first customer recorded stands; the row is answered either way.
        .onConflictDoUpdate({
          target: workspaceBillingTable.organizationId,
          set: { metronomeCustomerId: sql`${workspaceBillingTable.metronomeCustomerId}` },
        })
        .returning(BILLING_COLUMNS),
    ),
});

const updateContract = SqlSchema.void({
  Request: ContractSchema,
  execute: ({ organizationId, metronomeContractId }) =>
    Database.use((db) =>
      db
        .update(workspaceBillingTable)
        .set({ metronomeContractId, updatedAt: sql`now()` })
        .where(eq(workspaceBillingTable.organizationId, organizationId)),
    ),
});

/** Where each of the workspaces is billed, by workspace; one with no row yet is left out. */
export function workspaceBillings(
  organizationIds: readonly string[],
): AgentStoreEffect<ReadonlyMap<string, WorkspaceBilling>> {
  if (organizationIds.length === 0) return Effect.succeed(new Map());

  return Effect.map(
    findBillings(organizationIds),
    (rows) => new Map(rows.map((row) => [row.organizationId, row])),
  );
}

/** Where the workspace is billed; none until its Metronome customer is recorded. */
export function workspaceBilling(
  organizationId: string,
): AgentStoreEffect<Option.Option<WorkspaceBilling>> {
  return Effect.map(workspaceBillings([organizationId]), (rows) =>
    Option.fromNullishOr(rows.get(organizationId)),
  );
}

/** Records the workspace's Metronome customer, where none is yet; answers the row as it stands, whose customer is the first recorded. */
export function recordMetronomeCustomer(
  organizationId: string,
  metronomeCustomerId: string,
): AgentStoreEffect<WorkspaceBilling> {
  return Effect.flatMap(insertCustomer({ organizationId, metronomeCustomerId }), (rows) => {
    const row = rows[0];

    return row === undefined
      ? Effect.die(new Error("A workspace billing upsert answered no row"))
      : Effect.succeed(row);
  });
}

/** Records the contract made on the workspace's Metronome customer. */
export function recordMetronomeContract(
  organizationId: string,
  metronomeContractId: string,
): AgentStoreEffect<void> {
  return updateContract({ organizationId, metronomeContractId });
}
