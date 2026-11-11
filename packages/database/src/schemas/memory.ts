import { sql } from "drizzle-orm";
import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { organization, user } from "./auth.js";

/**
 * memory.ts -- one memory of a workspace: a settled fact or convention a coding agent kept for the workspace's later work, and each time an agent was shown one.
 *
 * A memory is the workspace's, shared by every member, never a task's or a
 * repository's, so every agent working in the workspace may recall it and no
 * agent of another workspace ever does. A coding agent writes it through the
 * `save_memory` tool (`packages/service/src/agents/memory-tools.ts`), and corrects
 * it in place, so a newer fact replaces the older one's text under the same
 * id and the workspace never holds both. `user_id` names the member whose
 * words it holds: the starter of the agent that kept it, or of the one that
 * last corrected it. The memory is the workspace's knowledge, as its git
 * history is, so it outlives the member who said it: one who leaves the
 * workspace leaves their memories with it, and deleting their account leaves
 * them too, `user_id` null, read as nobody the service can name, as
 * `description_revision` keeps its writer. Forgetting one, from Settings, deletes the
 * row, and the row leaves with its workspace.
 *
 * `agent_id` and `message_id` are where the words came from: the coding
 * agent that kept them, or last corrected them, and the line that opened its
 * turn then, which a link to the agent's transcript lands on. A member's own
 * keep, through their client or the member MCP server, names neither, and
 * neither does a memory kept before they were. The agent is set null when it
 * goes, with its task; the memory stays.
 */
export const memory = pgTable(
  "memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Null once the member's account is gone, which reads as nobody the service can name. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    /** The coding agent that kept or last corrected the words; null for a member's own keep, from before it was kept, and once the agent is gone. */
    agentId: uuid("agent_id").references(() => agentTable.id, { onDelete: "set null" }),
    /**
     * The line that opened the agent's turn as it kept them, by its
     * `messages` id; null wherever `agent_id` was never set, and for a turn
     * no line opened. Note that it is no reference, as a line's
     * `sender_agent_id` is none: a rewind deletes lines, and a reference
     * would have every such delete look through every memory for its own.
     */
    messageId: uuid("message_id"),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    index("memory_organization_updated").on(table.organizationId, table.updatedAt),
    // The foreign key's set null on every agent deleted, with its task, finds the memories it kept, which a scan of the table would read through to the last.
    index("memory_agent").on(table.agentId).where(sql`${table.agentId} is not null`),
  ],
);

/**
 * One memory handed to a coding agent once: one row per memory each time
 * an agent's `search_memory` answers it, or a turn is handed it, never a
 * member's own search. The rows are what Settings counts a memory's recalls
 * in the last thirty days and its last recall from. `agent_id` and
 * `message_id` are the recalling agent and the line that opened its turn, as
 * on `memory`. A row goes with its memory and with its workspace.
 */
export const memoryRecall = pgTable(
  "memory_recall",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memory.id, { onDelete: "cascade" }),
    /** The coding agent the memory was handed to; null once the agent is gone. */
    agentId: uuid("agent_id").references(() => agentTable.id, { onDelete: "set null" }),
    /** The line that opened that agent's turn, as `memory.message_id` is; no reference, for the same reason. */
    messageId: uuid("message_id"),
    recalledAt: timestamptz("recalled_at").notNull(),
  },
  (table) => [
    // A memory's recalls since an instant, and its latest, each one range of this index.
    index("memory_recall_memory_recalled").on(table.memoryId, table.recalledAt),
    // A workspace's recalls since an instant, and the foreign key's cascade when a workspace goes.
    index("memory_recall_organization_recalled").on(table.organizationId, table.recalledAt),
    // The foreign key's set null on every agent deleted, as on `memory`.
    index("memory_recall_agent").on(table.agentId).where(sql`${table.agentId} is not null`),
  ],
);
