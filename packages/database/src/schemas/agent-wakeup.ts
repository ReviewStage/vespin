import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";

/**
 * agent-wakeup.ts -- the wakeup a coding agent booked with `schedule_wakeup`, kept until its delayed queue message delivers it.
 *
 * A coding agent, on either harness, books one through our tool: a prompt
 * and the instant it comes due. Its turn then ends, and a queue message
 * delayed until then hands the prompt back to the agent as a line of its
 * own, which opens its next turn (`@repo/service`'s
 * `agents/coder-host/agent-wakeups.ts`). One row per agent: booking again
 * replaces it under a new id, a `stop` deletes it, and so do a Stop and a
 * rewind of the agent, as a stopped harness's own wakeups end with it
 * (`../models/agent-wakeups.ts`). The row goes with its agent.
 */
export const agentWakeupTable = pgTable(
  "agent_wakeup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The prompt the agent asked to be woken with, which is delivered as the line. */
    prompt: text("prompt").notNull(),
    /** When the wakeup comes due, which its queue message is delayed until. */
    dueAt: timestamptz("due_at").notNull(),
    /** How many deliveries the retired minute sweep claimed; no deployment past the queue's delivery writes it, and it is dropped once none claims. */
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    // The retired minute sweep read the wakeups due; dropped with `attempts`.
    index("agent_wakeup_due").on(table.dueAt),
    // An agent holds one booking: booking again replaces it, and a Stop deletes it.
    uniqueIndex("agent_wakeup_agent").on(table.agentId),
  ],
);
