import type { MachineAskDecision, MachineAskSubject } from "@repo/features/machine-ask-wire";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";
import { device } from "./device.js";

/**
 * machine-command-ask.ts -- an ask a machine holds for its owner's answer, kept so any of the owner's devices may answer it.
 *
 * A machine that claims a command it may run only once its owner allows
 * it, a shell command under Ask every time or an action on an app not yet
 * allowed, writes one row as it shows the ask, under the command's id, with
 * what it asks: the command's text, or the app as the machine names and
 * draws it. Every device of the owner follows the rows; the first answer
 * written is the answer, which no later answer replaces, and the machine
 * takes it and deletes the row, which takes the ask down everywhere. A row
 * whose window closed with no answer stays, so an answer may still be
 * given late: a late Allow stands as a grant the agent's next ask of the
 * same is answered with, and a late Deny takes it down. The scheduled sweep
 * deletes a row an hour after it was asked
 * (`MACHINE_ASK_BOUNDS.STANDS_SECONDS`). Every row belongs to the account and
 * leaves with it, or with its machine.
 */
export const machineCommandAsk = pgTable(
  "machine_command_ask",
  {
    /** The command's id, which the ask goes by. */
    id: uuid("id").primaryKey(),
    /** The machine's owner, who alone reads and answers it. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The machine that holds the ask. */
    deviceId: uuid("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    /** The agent whose call it is for, as its command named it; null for none, and once the agent is gone. */
    agentId: uuid("agent_id").references(() => agentTable.id, { onDelete: "set null" }),
    /** What it asks: a shell command's text, or the app as the machine names and draws it (`machineAskSubjectSchema`). */
    subject: jsonb("subject").$type<MachineAskSubject>().notNull(),
    askedAt: timestamptz("asked_at").notNull(),
    /** When its window closes on the machine's say, which its countdown reads. */
    expiresAt: timestamptz("expires_at").notNull(),
    /**
     * When the machine said the window closed with no answer, its call
     * answered as not answered; null while it waits. An Allow given after
     * it stands here as a grant, which the agent's next ask of the same on
     * the same machine is answered with.
     */
    lapsedAt: timestamptz("lapsed_at"),
    /** The answer that stands, the first written; null while it waits. */
    decision: text("decision").$type<MachineAskDecision>(),
    /** A denial's words for the agent; null for none. */
    note: text("note"),
  },
  (table) => [index("machine_command_ask_user").on(table.userId)],
);
