import { pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * presence.ts -- when a member last used a desktop or web client, which holds their phone's pushes while it is recent.
 *
 * One row per account, stamped by each beat a client sends while the member
 * uses it (`@repo/features/presence-wire`). The member counts as present
 * while the stamp stands inside `PRESENCE.WINDOW_MS` of now; nothing ever
 * clears it, since a client that closes or goes idle simply stops beating.
 * It carries no content and no client's name, only the instant, and leaves
 * with the account.
 */
export const memberPresence = pgTable("member_presence", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** When a client of the member's last saw them use it. */
  lastActiveAt: timestamptz("last_active_at").notNull(),
});
