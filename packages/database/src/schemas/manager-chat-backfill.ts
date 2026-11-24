import { pgTable, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";

/**
 * manager-chat-backfill.ts -- the Managers whose old chat the one-time backfill has copied out of their transcript.
 *
 * The scheduled sweep backfills a few Managers at a time
 * (`service/src/maintenance/manager-chat-backfill.ts`) and marks each here
 * once its chat stands whole, so the next sweep takes the next ones and,
 * once every Manager is marked, does nothing. A row goes with its agent. The
 * table goes with the backfill, once nothing reads the chat from a
 * transcript.
 */
export const managerChatBackfill = pgTable("manager_chat_backfill", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agentTable.id, { onDelete: "cascade" }),
  backfilledAt: timestamptz("backfilled_at").notNull(),
});
