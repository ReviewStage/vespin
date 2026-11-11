import { COMMAND_PREFIX } from "@repo/wire";
import { sql } from "drizzle-orm";
import { check, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { bound, timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

/**
 * account-allowed-command.ts -- the shell commands a member always allows their coding agents to run unasked, each by its first words, in every repository and on either harness.
 *
 * A row is one command prefix (`COMMAND_PREFIX`), its tokens in order
 * (`["pnpm","test"]`, shown as `pnpm test *`), kept once per member. It is
 * added where the member answered an agent's ask with Always allow and the
 * harness proposed the command's prefix, naming that agent, or by hand in
 * Settings, naming none; it is never edited, only removed. Every launch of
 * the member's agents in a mode that asks is handed the member's prefixes
 * as they then stand, so a removal stops applying at the next launch.
 *
 * A prefix is the member's own and is read by no one else. It is the
 * command's words, which are never written to a log, a trace, or a counted
 * event. Every row leaves with the account, and the agent named leaves the
 * row standing, naming none, once it is gone.
 */
export const accountAllowedCommand = pgTable(
  "account_allowed_command",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The command's first words, one token each. */
    prefix: text("prefix").array().notNull(),
    /** The agent whose ask the member answered with Always allow; null for one added by hand, and once that agent is gone. */
    agentId: uuid("agent_id").references(() => agentTable.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    // A member keeps a prefix once, and a launch reads the member's by this index's lead.
    unique("account_allowed_command_prefix").on(table.userId, table.prefix),
    // A prefix is held to its bound here as well as on the wire, so no writer keeps a longer one.
    check(
      "account_allowed_command_prefix_bound",
      sql`cardinality(${table.prefix}) between 1 and ${bound(COMMAND_PREFIX.MAX_TOKENS)}`,
    ),
  ],
);
