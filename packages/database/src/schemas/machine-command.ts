import {
  COMPUTER_RECORDING_BOUNDS,
  MACHINE_COMMAND_KIND,
  type MachineCommandKind,
  type MachineCommandResult,
} from "@repo/features/machine-command-wire";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bound, bytea, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { device } from "./device.js";

/**
 * machine-command.ts -- a command an agent asked to run on the developer's Mac, queued until a Mac of the account runs it.
 *
 * The agent's call inserts the row and waits on it; a signed-in Mac holding
 * the account's read claims it, runs it, and writes its result, a stopped
 * recording's video first where it made one; the call
 * reads the result and deletes the row, so a row stands only while its call
 * does. A Mac claims only rows of the kinds its read named. A row naming a
 * device is claimed by that device alone; a row naming none, as every row
 * queued before devices were, by any Mac of the account, which is the path
 * that drains as every Mac comes to claim as a device. Every row belongs to
 * the account and leaves with it.
 */
export const machineCommand = pgTable(
  "machine_command",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * The machine the command is for, which alone may claim it; null for a
     * command any Mac of the account may claim. Note that it leaves with its
     * device, since no other machine may run what was meant for that one.
     */
    deviceId: uuid("device_id").references(() => device.id, { onDelete: "cascade" }),
    /** What the command asks; a row queued before kinds were is a shell command. */
    kind: text("kind").$type<MachineCommandKind>().notNull().default(MACHINE_COMMAND_KIND.SHELL),
    /** What it asks: a shell command's text, or a computer command's request as JSON (`storedMachineCommandText`). */
    command: text("command"),
    timeoutSeconds: integer("timeout_seconds").notNull(),
    queuedAt: timestamptz("queued_at").notNull(),
    /** When a Mac took it; null while it waits. */
    claimedAt: timestamptz("claimed_at"),
    /** What it came to, once the Mac that took it said; null until then. */
    result: jsonb("result").$type<MachineCommandResult>(),
    /**
     * A stopped recording's video, an H.264 MP4 the Mac that took the
     * command posted before its result, since the result has no room for
     * it; null for every other command. It goes with the row, once its call
     * has kept it beside the transcript or stopped waiting.
     */
    recording: bytea("recording"),
  },
  (table) => [
    index("machine_command_waiting").on(table.userId, table.claimedAt),
    check(
      "machine_command_recording_bound",
      sql`${table.recording} is null or octet_length(${table.recording}) <= ${bound(COMPUTER_RECORDING_BOUNDS.MAX_BYTES)}`,
    ),
  ],
);

/**
 * When a Mac of the account last held the read for its commands, which is
 * what an agent's call reads as the app running on the developer's Mac with
 * the setting on, and so taking shell commands, which every Mac runs. One
 * row per account, moved on every read.
 */
export const machineCommandListener = pgTable("machine_command_listener", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  seenAt: timestamptz("seen_at").notNull(),
});

/**
 * When a device last held the read for its commands, which is what a call
 * meant for that machine reads as it being there to take one. One row per
 * device, moved on every read, beside the account's own row above, which
 * every Mac that listens moves too.
 */
export const machineCommandDeviceListener = pgTable("machine_command_device_listener", {
  deviceId: uuid("device_id")
    .primaryKey()
    .references(() => device.id, { onDelete: "cascade" }),
  seenAt: timestamptz("seen_at").notNull(),
});
