import type { SandboxBootStep, SandboxState } from "@repo/features/agent-sandbox-wire";
import { boolean, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { conversations } from "./storage.js";

/**
 * agent-sandbox.ts -- where a cloud agent's sandbox stands as the service last saw it, so every client draws it live.
 *
 * One row per agent session, keyed by the conversation its sandbox is kept
 * for (`agent.conversation_id`), written as the sandbox boots, as its
 * runner is handed its first lines, as it is touched, and as it is
 * discarded (`../models/agent-sandbox-store.ts`). The session its sandbox
 * is named for is kept beside it, so a discard of a session the
 * conversation has since moved off leaves the newer session's record be. A
 * row goes with its conversation. Vercel stops an untouched sandbox by
 * itself, which no service code sees, so `runs_until` is when the sandbox
 * stops unless touched again, and a reader reads the row against its own
 * clock rather than taking `state` as it stands. A sandbox a member stopped
 * by hand is held off (`held_off`), so the warm call an agent on screen
 * sends leaves it stopped until the agent's next boot or a Wake now.
 */
export const agentSandbox = pgTable(
  "agent_sandbox",
  {
    /** The conversation of the coding agent whose sandbox this is. */
    conversationId: uuid("conversation_id")
      .primaryKey()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** The session the sandbox is named for, as the conversation records it (`runtime_session_id`). */
    session: text("session").notNull(),
    /** Off, booting, or running (`SANDBOX_STATE`). */
    state: text("state").$type<SandboxState>().notNull(),
    /** The steps of the newest boot in the order they began, each with its start as epoch milliseconds; reset as each boot begins. */
    steps: jsonb("steps").$type<readonly SandboxBootStep[]>().notNull().default([]),
    /** When the sandbox moved to its state. */
    stateAt: timestamptz("state_at").notNull(),
    /** While running, when the sandbox stops unless touched again; null otherwise. */
    runsUntil: timestamptz("runs_until"),
    /** Whether a member stopped the sandbox by hand, so a warm call resumes nothing; cleared as the next boot begins and on a Wake now. */
    heldOff: boolean("held_off").notNull().default(false),
  },
  // A discard names the sandbox by its session.
  (table) => [index("agent_sandbox_session").on(table.session)],
);
