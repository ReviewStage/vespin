import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";

/**
 * sandbox-port-share.ts -- a coding agent's cloud sandbox port shared by a public link, which the scheduled sweep lists.
 *
 * One row per agent's session whose sandbox shares a port, written as the
 * share opens, replaced by a share of another port, and deleted as it closes,
 * by the developer or by the sweep once no one has visited the link for its
 * idle bound (`maintenance/port-share-sweep.ts` in the service). The session
 * is the runtime's own id, which names the sandbox, and is no foreign key,
 * because nothing holds that id unique. The row names a session, a port,
 * and an instant alone, never a byte the link carries.
 */
export const sandboxPortShare = pgTable("sandbox_port_share", {
  /** The runtime's session id of the agent, which its sandbox is named after. */
  sessionId: text("session_id").primaryKey(),
  /** The port shared from the sandbox. */
  port: integer("port").notNull(),
  /** When the share opened. */
  sharedAt: timestamptz("shared_at").notNull(),
});
