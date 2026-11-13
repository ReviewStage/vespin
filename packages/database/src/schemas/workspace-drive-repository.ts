import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization } from "./auth.js";

/**
 * workspace-drive-repository.ts -- the repositories a workspace's drive holds.
 *
 * Each workspace's drive (`packages/service/src/agents/workspace-drive.ts`)
 * holds its repositories at `/workspace/<owner>/<name>`. A row names one of
 * them, lower-cased as the drive's folder is, and when a fill added it. The
 * row leaves with its workspace.
 */
export const workspaceDriveRepository = pgTable(
  "workspace_drive_repository",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Lower-cased `owner/name`, e.g. `"acme/relay"`. */
    repository: text("repository").notNull(),
    addedAt: timestamptz("added_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.repository] })],
);
