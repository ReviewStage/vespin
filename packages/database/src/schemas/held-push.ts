import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";
import { inboxItem } from "./inbox.js";

/**
 * held-push.ts -- an alert held back from a member's phones while they were at their desk, sent once they walk away if what it tells of still waits.
 *
 * A push due while the member is present (`./presence.ts`) is held for every
 * phone whose "Notify me" is away (`PUSH_NOTIFY`), as one row naming what it
 * tells of: an Inbox thread (`inbox_item_id`), or an agent whose turn failed
 * (`agent_id` and `turn_id`). Exactly one of the two stands. One row per
 * thread, and per agent, so a later post on a held thread, or a later failure
 * of a held agent, only stamps it held again, as a later push would replace
 * the earlier one on the lock screen. The scheduled sweep takes the rows of
 * members no longer present and sends each whose thread still waits on them
 * or whose agent still stands on that failed turn, and drops the rest
 * (`packages/service/src/push/held-pushes.ts`). A row leaves with its thread,
 * its agent, or its account.
 */
export const heldPush = pgTable(
  "held_push",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The thread a held post or ask is on; null for a failed turn. */
    inboxItemId: uuid("inbox_item_id").references(() => inboxItem.id, { onDelete: "cascade" }),
    /** The agent whose turn failed; null for a thread. */
    agentId: uuid("agent_id").references(() => agentTable.id, { onDelete: "cascade" }),
    /** The failed turn, which the agent must still stand on for the push to go; null for a thread. */
    turnId: text("turn_id"),
    /** When the push was last held. */
    heldAt: timestamptz("held_at").notNull(),
  },
  (table) => [
    // One hold per thread and per agent for a member: a later push only stamps it again.
    uniqueIndex("held_push_user_item").on(table.userId, table.inboxItemId),
    uniqueIndex("held_push_user_agent").on(table.userId, table.agentId),
    // A hold tells of a thread or of an agent's failed turn, never both and never neither.
    check(
      "held_push_one_subject",
      sql`(${table.inboxItemId} is not null) <> (${table.agentId} is not null and ${table.turnId} is not null)`,
    ),
  ],
);
