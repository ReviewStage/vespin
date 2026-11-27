import { boolean, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

/**
 * agent-read.ts -- one member's read mark on one Manager's chat: the newest instant of it they looked at, and whether they marked it unread.
 *
 * A Manager's page is a chat, and a message it sends (`said_at` on
 * `agent.ts`) marks its row unread for every member who can open it until
 * they look. The mark lives on the account, as a task's does
 * (`task-read.ts`), so it follows the member to every Mac and browser; a
 * member with no mark reads the agent through its start. The instant is the
 * service's, never a window's clock, and a look only ever moves it forward;
 * Mark as unread alone moves it back, to just before a message of the chat,
 * and marks the chat unread until the member opens it again, as a task's
 * mark by hand does (`task-read.ts`), whoever sent what follows. Each row
 * leaves with its account or its agent.
 */
export const agentRead = pgTable(
  "agent_read",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The newest instant of the agent's chat the member looked at. */
    readThrough: timestamptz("read_through").notNull(),
    /** Whether the member marked the chat unread and has not opened it since. */
    markedUnread: boolean("marked_unread").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.agentId] }),
    // An agent's delete cascades to its marks, found by the agent alone.
    index("agent_read_agent").on(table.agentId),
  ],
);
