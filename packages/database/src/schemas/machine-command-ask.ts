import {
  MACHINE_ASK_BOUNDS,
  MACHINE_ASK_DECISION,
  MACHINE_ASK_KIND,
  type MachineAskDecision,
  type MachineAskKind,
} from "@repo/features/machine-ask-wire";
import { COMPUTER_BOUNDS, MACHINE_COMMAND_BOUNDS } from "@repo/features/machine-command-wire";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bound, literal, timestamptz } from "./_helpers.js";
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
 * outlives its command's row, which its call deletes once it stops waiting,
 * so an answer given late still reaches the machine; the scheduled sweep
 * deletes one standing past `MACHINE_ASK_BOUNDS.STANDS_SECONDS`. Every row
 * belongs to the account and leaves with it, or with its machine.
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
    kind: text("kind").$type<MachineAskKind>().notNull(),
    /** A shell command's text; null for an app's ask. */
    command: text("command"),
    /** An app's name, bundle id where it has one, and icon as a 64px PNG's base64; null for a shell command's ask. */
    appName: text("app_name"),
    appBundleId: text("app_bundle_id"),
    appIconPng: text("app_icon_png"),
    askedAt: timestamptz("asked_at").notNull(),
    /** When its window closes, its call answered as not answered; an answer after it is late, and still reaches the machine. */
    expiresAt: timestamptz("expires_at").notNull(),
    /** The answer that stands, the first written; null while it waits. */
    decision: text("decision").$type<MachineAskDecision>(),
    /** A denial's words for the agent; null for none. */
    note: text("note"),
    answeredAt: timestamptz("answered_at"),
  },
  (table) => [
    index("machine_command_ask_user").on(table.userId, table.askedAt),
    index("machine_command_ask_asked").on(table.askedAt),
    check(
      "machine_command_ask_subject",
      sql`(${table.kind} = ${literal(MACHINE_ASK_KIND.SHELL)} and ${table.command} is not null and ${table.appName} is null) or (${table.kind} = ${literal(MACHINE_ASK_KIND.APP)} and ${table.appName} is not null and ${table.command} is null)`,
    ),
    check(
      "machine_command_ask_command_bound",
      sql`${table.command} is null or char_length(${table.command}) <= ${bound(MACHINE_COMMAND_BOUNDS.MAX_COMMAND_CHARS)}`,
    ),
    check(
      "machine_command_ask_icon_bound",
      sql`${table.appIconPng} is null or char_length(${table.appIconPng}) <= ${bound(COMPUTER_BOUNDS.MAX_ICON_CHARS)}`,
    ),
    check(
      "machine_command_ask_note_bound",
      sql`${table.note} is null or char_length(${table.note}) <= ${bound(MACHINE_ASK_BOUNDS.MAX_NOTE_CHARS)}`,
    ),
    check(
      "machine_command_ask_answered",
      sql`(${table.decision} is null) = (${table.answeredAt} is null) and (${table.note} is null or ${table.decision} = ${literal(MACHINE_ASK_DECISION.DENY)})`,
    ),
  ],
);
