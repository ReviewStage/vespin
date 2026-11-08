import { sql } from "drizzle-orm";
import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_helpers.js";
import { organization } from "./auth.js";

/**
 * workspace-sandbox-script.ts -- the scripts that set up a workspace's cloud agent sandboxes: one install script for the workspace, and one setup script per repository.
 *
 * As Conductor Cloud keeps them, in the workspace's settings rather than in
 * a repository: the install script runs once per build of each of the
 * workspace's repositories' base snapshots, so what it installs is in every
 * sandbox made from one, and a repository's setup script runs once in each
 * new agent sandbox of that repository, after its checkout. Both are plain
 * text every member may read, since a secret belongs in the workspace's
 * environment variables (`workspace-environment-variable.ts`), and both go
 * with their workspace.
 */
export const workspaceInstallScript = pgTable("workspace_install_script", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** The bash the base snapshot's build runs. */
  script: text("script").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceRepositorySetup = pgTable(
  "workspace_repository_setup",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** `owner/name` as GitHub spelled it when the script was saved, e.g. `"acme/relay"`. */
    repository: text("repository").notNull(),
    /** The bash each new agent sandbox of the repository runs after its checkout. */
    script: text("script").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One script per repository however its name is cased, since GitHub's names ignore case.
    uniqueIndex("workspace_repository_setup_organization_repository").on(
      table.organizationId,
      sql`lower(${table.repository})`,
    ),
  ],
);
