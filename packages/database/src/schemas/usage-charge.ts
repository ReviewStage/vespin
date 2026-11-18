import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { USAGE_KIND, type UsageFigures, type UsageKind } from "../usage-vocabulary.js";
import { createdAt, literal, timestamptz } from "./_helpers.js";
import { organization } from "./auth.js";

/**
 * usage-charge.ts -- the ledger of what each workspace owes: one row per billable item, priced at what it cost us.
 *
 * A row names the workspace it is charged to, the member it was used for
 * where there is one (the starter of the agent whose sandbox ran; none for a
 * drive's fill), what kind of usage it is, and the id its source gives the
 * item, which is unique within its kind, so an item read twice is charged
 * once (`../models/usage-charges.ts`). It keeps the figures it was priced
 * from and its amount in micro-dollars, when the usage happened, which
 * month it falls in, and when it was sent on to be invoiced, null until it
 * is. `user_id` holds no foreign key, so a member's charges outlive the
 * account; a row goes with its workspace alone. It holds ids, figures, and
 * instants alone.
 */
export const usageChargeTable = pgTable(
  "usage_charge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The member the usage was for; null where it was no member's, as a drive's fill is. */
    userId: text("user_id"),
    kind: text("kind").$type<UsageKind>().notNull(),
    /** The item's id at its source: a sandbox session's Vercel id. */
    sourceId: text("source_id").notNull(),
    figures: jsonb("figures").$type<UsageFigures>().notNull(),
    amountMicroUsd: bigint("amount_micro_usd", { mode: "number" }).notNull(),
    /** When the usage happened: a sandbox session's stop. Its month is the month it is billed in. */
    occurredAt: timestamptz("occurred_at").notNull(),
    /** When the row was sent on to be invoiced; null until it is. */
    sentAt: timestamptz("sent_at"),
    createdAt: createdAt(),
  },
  (table) => [
    // An item is charged once, however often its source is read.
    uniqueIndex("usage_charge_source").on(table.kind, table.sourceId),
    // A workspace's month is read by workspace and instant, and by member within them.
    index("usage_charge_organization_month").on(
      table.organizationId,
      table.occurredAt,
      table.userId,
    ),
    // A sandbox's charges not yet sent are read by its name, which its figures carry.
    index("usage_charge_unsent_sandbox")
      .on(sql`(${table.figures} ->> 'sandboxName')`)
      .where(sql`${table.sentAt} is null`),
    check(
      "usage_charge_kind",
      sql`${table.kind} in (${sql.join(Object.values(USAGE_KIND).map(literal), sql`, `)})`,
    ),
    check("usage_charge_amount", sql`${table.amountMicroUsd} >= 0`),
  ],
);
