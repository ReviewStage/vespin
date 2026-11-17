import { pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { organization } from "./auth.js";

/**
 * workspace-billing.ts -- where each workspace is billed: its Metronome customer and contract, its Stripe customer once billing is set up, and whether an invoice it owes was given up on.
 *
 * A row is written the first time the workspace has usage to send
 * (`../models/workspace-billing.ts`): its Metronome customer first, then the
 * contract made on it, so a contract that failed to be made is made on the
 * next send rather than on a second customer. `stripe_customer_id` stays null
 * until an owner sets billing up, and `blocked_at` is set while an invoice is
 * marked uncollectible. It holds ids and instants alone, and goes with its
 * workspace.
 */
export const workspaceBillingTable = pgTable("workspace_billing", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  metronomeCustomerId: text("metronome_customer_id").notNull(),
  /** The contract the workspace's usage is rated on; null only until it is made. */
  metronomeContractId: text("metronome_contract_id"),
  /** The Stripe customer invoices are charged to; null until billing is set up. */
  stripeCustomerId: text("stripe_customer_id"),
  /** When an invoice the workspace owes was marked uncollectible; null while none is. */
  blockedAt: timestamptz("blocked_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
