import {
  REPOSITORY_SCRIPT_KIND,
  type RepositoryScriptKind,
} from "@repo/features/workspace-sandbox-setup-wire";
import { sql } from "drizzle-orm";
import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_helpers.js";
import { organization } from "./auth.js";

/**
 * workspace-sandbox-script.ts -- the scripts that set up and archive a workspace's cloud agent sandboxes: one install script for the workspace, one setup script and one archive script per repository, and each repository's run actions.
 *
 * As Conductor Cloud keeps them, in the workspace's settings rather than in
 * a repository: the install script runs once per build of each of the
 * workspace's repositories' base snapshots, so what it installs is in every
 * sandbox made from one, a repository's setup script runs once in each new
 * agent sandbox of that repository, after its checkout, and its archive
 * script once in each just before it is deleted for good. All are plain
 * text every member may read, since a secret belongs in the workspace's
 * environment variables (`workspace-environment-variable.ts`), and all go
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
    /** The bash the repository's agent sandboxes run: each new one after its checkout, or each just before its delete, as `kind` says. */
    script: text("script").notNull(),
    /** Which of the repository's scripts the row is (`REPOSITORY_SCRIPT_KIND`); its setup script for every row from before the column. */
    kind: text("kind")
      .$type<RepositoryScriptKind>()
      .notNull()
      .default(REPOSITORY_SCRIPT_KIND.SETUP),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One script of each kind per repository however its name is cased, since GitHub's names ignore case.
    uniqueIndex("workspace_repository_setup_organization_repository_kind").on(
      table.organizationId,
      sql`lower(${table.repository})`,
      table.kind,
    ),
  ],
);

/**
 * A repository's run actions, one row each: the commands a member runs in
 * one of its cloud agents' sandboxes, each only when pressed, from the Run
 * menu in the agent's message box. A save replaces the repository's whole
 * list, keeping the id of each action it names, so a run already going is
 * still known as its action after the list around it changes.
 */
export const workspaceRepositoryRunAction = pgTable(
  "workspace_repository_run_action",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** `owner/name` as GitHub spelled it when the list was saved, e.g. `"acme/relay"`. */
    repository: text("repository").notNull(),
    /** Its place in the repository's list, from 0; the first is the Run button's. */
    position: integer("position").notNull(),
    /** The words the Run menu and the action's Terminal tab draw. */
    label: text("label").notNull(),
    /** The bash it runs from the checkout. */
    command: text("command").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One action at each place in a repository's list however its name is cased, since GitHub's names ignore case.
    uniqueIndex("workspace_repository_run_action_repository_position").on(
      table.organizationId,
      sql`lower(${table.repository})`,
      table.position,
    ),
  ],
);
