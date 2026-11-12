import type { BootFailure, BootPhase } from "@repo/features/agent-boot";
import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";

/**
 * agent-boot.ts -- an agent's first launch: its machine booting before any turn opens, while every line sent to it waits in its queue.
 *
 * One row per agent, written by the Start that boots its machine and gone
 * once its first turn settles (`../models/agent-boot-store.ts`, the one
 * writer). `phase` is where the boot stands (`@repo/features/agent-boot`'s
 * `BOOT_PHASE`), `phase_at` when it entered it, which the bar counts from,
 * a hand-off keeping the instant its attempt began,
 * `deadline_at` when the minute sweep fails a boot still under way,
 * `failure` why the boot failed where it did, and `attempt` how many boots
 * Retry has begun, so a delivery of an earlier attempt moves nothing. The
 * row goes with its agent. It holds ids, words of fixed sets, a number, and
 * instants alone.
 */
export const agentBootTable = pgTable(
  "agent_boot",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull().default(1),
    phase: text("phase").$type<BootPhase>().notNull(),
    phaseAt: timestamptz("phase_at").notNull(),
    deadlineAt: timestamptz("deadline_at").notNull(),
    failure: text("failure").$type<BootFailure>(),
    createdAt: createdAt(),
  },
  (table) => [
    // The minute sweep reads the boots past their deadline.
    index("agent_boot_deadline").on(table.deadlineAt),
  ],
);
