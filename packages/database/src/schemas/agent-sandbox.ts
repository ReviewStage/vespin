import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";

/**
 * agent-sandbox.ts -- when each cloud agent's sandbox was last used, since its provider does not say.
 *
 * One row per sandbox, keyed by its name (`agent-sandbox-<digest>`, from
 * `@repo/service`'s `agents/agent-sandbox-open.ts`), naming the agent it was
 * opened for, `used_at`, the last open or touch recorded, and `state`, LIVE
 * while the sandbox stands, RELEASING once a sweep found it unused long
 * enough to delete and queued its release, and RELEASED once it was deleted.
 * An open writes the row LIVE and a touch moves `used_at` on, at most once a
 * minute each (`../models/agent-sandboxes.ts`, `@repo/service`'s
 * `agents/sandbox-use.ts`); the release is `@repo/service`'s
 * `agents/session-sandboxes.ts`. `booting_since` is when a boot of the
 * sandbox began, set as the launch opens it and cleared once its runner is
 * handed its first lines or the open failed, so the task list reads the
 * sandbox booting, running, or off (`@repo/service`'s `live/reads/tasks.ts`).
 * The row goes with its agent. It holds ids, a name, and instants alone.
 */

/** Whether a sandbox the row names stands. */
export const AGENT_SANDBOX_STATE = {
  LIVE: "live",
  RELEASING: "releasing",
  RELEASED: "released",
} as const;

export type AgentSandboxState = (typeof AGENT_SANDBOX_STATE)[keyof typeof AGENT_SANDBOX_STATE];

/**
 * The states a row may move to from each: a LIVE sandbox is released by a
 * sweep or deleted by its session's discard, a RELEASING one is opened again
 * or deleted, and a RELEASED one is opened again. Every write of `state`
 * (`../models/agent-sandboxes.ts`) is guarded on the moves into the state it
 * writes.
 */
export const AGENT_SANDBOX_TRANSITIONS = {
  [AGENT_SANDBOX_STATE.LIVE]: [AGENT_SANDBOX_STATE.RELEASING, AGENT_SANDBOX_STATE.RELEASED],
  [AGENT_SANDBOX_STATE.RELEASING]: [AGENT_SANDBOX_STATE.LIVE, AGENT_SANDBOX_STATE.RELEASED],
  [AGENT_SANDBOX_STATE.RELEASED]: [AGENT_SANDBOX_STATE.LIVE],
} as const satisfies Record<AgentSandboxState, readonly AgentSandboxState[]>;

export const agentSandboxTable = pgTable(
  "agent_sandbox",
  {
    /** The sandbox's name, which every open and touch of it names. */
    sandboxName: text("sandbox_name").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** When the sandbox was last opened or touched, to the minute. */
    usedAt: timestamptz("used_at").notNull(),
    state: text("state").$type<AgentSandboxState>().notNull().default(AGENT_SANDBOX_STATE.LIVE),
    /** When the boot under way began; null where none is. */
    bootingSince: timestamptz("booting_since"),
  },
  (table) => [
    // An agent's delete cascades to its rows, found by the agent alone.
    index("agent_sandbox_agent").on(table.agentId),
    // A sweep reads the live sandboxes unused the longest first.
    index("agent_sandbox_used").on(table.usedAt),
  ],
);
