import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization } from "./auth.js";

/**
 * sandbox-owner.ts -- the workspace each Vercel sandbox we create is billed to, kept past its agent.
 *
 * One row per sandbox name, written before the sandbox is opened under it
 * (`../models/sandbox-owners.ts`): an agent's by its launch (`@repo/service`'s
 * `agents/machine/sandbox-machine.ts`), naming the agent and its starter, and
 * a workspace drive's fill (`@repo/service`'s `agents/workspace-drive.ts`),
 * naming the member whose firewall it fills under and no agent. A Mac
 * agent opens no sandbox and writes none. `agent_id` and `user_id` hold no
 * foreign key, so the row outlives the agent and the account; it goes with
 * its workspace alone. It holds ids, a name, and an instant alone.
 */
export const sandboxOwnerTable = pgTable(
  "sandbox_owner",
  {
    /** The sandbox's name, as Vercel knows it. */
    sandboxName: text("sandbox_name").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The agent the sandbox was opened for; null for a drive fill's. */
    agentId: uuid("agent_id"),
    /** The member it was opened for: the agent's starter, or the fill's member. */
    userId: text("user_id"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    // A workspace's delete cascades to its rows, and its usage is read by workspace.
    index("sandbox_owner_organization").on(table.organizationId),
  ],
);
