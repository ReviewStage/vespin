import { boolean, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

/**
 * agent-follower.ts -- one member following an agent on no task, a Manager, and whether it may use that member's machines.
 *
 * An agent on a task is followed through its task (`task-follower.ts`); one
 * on no task has none, so its followers stand here, keyed as a task's are.
 * A row says the member follows the agent, and `machines` says whether the
 * agent may run on that member's own machines; it is the member's to
 * switch, and following again keeps the switch as it stands. The agent's
 * owner, who started it, holds no row: they always follow it with their
 * machines on, which the store reads from the agent itself. Each row leaves
 * with its member or its agent, whichever goes first, and one left behind by
 * a member who has since left the workspace reads as nothing, since every
 * read gates on membership.
 */
export const agentFollower = pgTable(
  "agent_follower",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    machines: boolean("machines").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    // An agent's followers, read by the agent, which leads the key.
    primaryKey({ columns: [table.agentId, table.userId] }),
    // The agents a member follows, and their account's delete taking each of those rows.
    index("agent_follower_user").on(table.userId),
  ],
);
