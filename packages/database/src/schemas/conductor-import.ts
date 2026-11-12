import type {
  ConductorImportFailure,
  ConductorImportKind,
  ConductorImportStatus,
} from "@repo/features/conductor-import-wire";
import { index, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { organization, user } from "./auth.js";
import { task } from "./task.js";

/**
 * conductor-import.ts -- what an import from Conductor brought into a workspace, and each run of one with its sealed key and progress.
 *
 * `conductor_import` holds one row per Conductor workspace or chat a
 * workspace imported, keyed by the workspace and Conductor's id, with the
 * task or the agent it became: a run again creates only what has no row. A
 * row leaves with its workspace, and with its task or agent, so one deleted
 * since is imported afresh by the next run.
 *
 * `conductor_import_run` is one member's run, holding the Conductor key
 * sealed (`models/provider-key-seal.ts`'s `sealConductorKey`, bound to the
 * account and the run) only while the run has work queued: its last item
 * settled clears the key, and the sweep clears one past `keyExpiresAt`, a
 * day after the run began. `conductor_import_item` is where each workspace
 * and chat of the run stands, for the form to read, and which of them a
 * delivery holds while it talks to Conductor, so a run asks only a few
 * things of Conductor at once; both leave with the run, which the sweep
 * deletes a week after it began.
 */
export const conductorImport = pgTable(
  "conductor_import",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Conductor's id of the workspace or the chat. */
    conductorId: text("conductor_id").notNull(),
    kind: text("kind").$type<ConductorImportKind>().notNull(),
    /** The task a workspace became; null for a chat. */
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    /** The agent a chat became; null for a workspace. */
    agentId: uuid("agent_id").references(() => agentTable.id, { onDelete: "cascade" }),
    importedAt: timestamptz("imported_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.conductorId] }),
    // A task's or an agent's delete cascades here, found by its id alone.
    index("conductor_import_task").on(table.taskId),
    index("conductor_import_agent").on(table.agentId),
  ],
);

export const conductorImportRun = pgTable(
  "conductor_import_run",
  {
    id: uuid("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The Conductor key as the service sealed it; null once the run ended or its day ran out. */
    sealedKey: text("sealed_key"),
    startedAt: timestamptz("started_at").notNull(),
    /** When its member canceled it, which cleared its key and every item still queued; null while it stands. */
    canceledAt: timestamptz("canceled_at"),
    /** When the sweep clears the key whatever is still queued. */
    keyExpiresAt: timestamptz("key_expires_at").notNull(),
  },
  (table) => [
    // The form reads a member's newest run in a workspace.
    index("conductor_import_run_member").on(table.userId, table.organizationId, table.startedAt),
    index("conductor_import_run_started").on(table.startedAt),
  ],
);

export const conductorImportItem = pgTable(
  "conductor_import_item",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => conductorImportRun.id, { onDelete: "cascade" }),
    conductorId: text("conductor_id").notNull(),
    kind: text("kind").$type<ConductorImportKind>().notNull(),
    /** Conductor's id of the workspace, a chat's own or the workspace's itself. */
    workspaceConductorId: text("workspace_conductor_id").notNull(),
    name: text("name"),
    status: text("status").$type<ConductorImportStatus>().notNull(),
    failure: text("failure").$type<ConductorImportFailure>(),
    /** Until when a delivery holds it while talking to Conductor; null while none does. A run holds a few at once. */
    leasedUntil: timestamptz("leased_until"),
    /** How many of its deliveries Conductor or the store failed in a way that may pass; it settles failed at the bound. */
    attempts: integer("attempts").notNull().default(0),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.conductorId] })],
);
