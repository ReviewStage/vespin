import type { ViewChoiceKey } from "@repo/features/view-choice-wire";
import { index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * account-view-choice.ts -- one view choice an account keeps (a sort, a filter, a fold), for one of its workspaces or for the account, so it follows the member to every device.
 *
 * A choice is the member's reading of their own lists, as a pin is
 * (`task-pin.ts`): one member's choice in a shared workspace is theirs
 * alone. Each key is declared once, with the Schema its value reads
 * through (`@repo/features/view-choice-wire`'s `VIEW_CHOICE`), which the
 * service checks every write against, so the value is JSON a build could
 * have chosen. A choice of a workspace's names it, one of the account's
 * names none, and the account keeps at most one of each key in each place.
 * Choosing again writes over it, and forgetting it deletes the row. Each row
 * leaves with its account or its workspace, whichever goes first, and one
 * left behind by a member who has since left the workspace reads as
 * nothing, since its read gates on membership.
 */
export const accountViewChoice = pgTable(
  "account_view_choice",
  {
    /** The row's own id, by which the account's live read keys it. */
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").$type<ViewChoiceKey>().notNull(),
    /** The workspace the choice is kept for; null for the account's own. */
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    value: jsonb("value").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // One choice of each key in each place, the account's own under no workspace.
    unique("account_view_choice_user_key_organization")
      .on(table.userId, table.key, table.organizationId)
      .nullsNotDistinct(),
    // A workspace's delete cascades to its members' choices, found by the workspace alone.
    index("account_view_choice_organization").on(table.organizationId),
  ],
);
