import type { CloudSetupScript } from "@repo/features/workspace-sandbox-setup-wire";
import { integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { organization } from "./auth.js";

/**
 * workspace-sandbox-script-run.ts -- how each of a workspace's cloud setup scripts last ran in an agent's sandbox, so Settings › Cloud setup can say whether a script works without starting an agent.
 *
 * One row per script: the workspace's install script, and each repository's
 * setup script (an archive script's row from before archive scripts were
 * removed is never read), each replaced by its next run
 * (`../models/workspace-sandbox-script-run-store.ts`). A row holds facts
 * alone, when the run started, how it exited, and whose sandbox it ran in,
 * never what the script printed, since a setup log may print a workspace
 * variable's value or a token; that stays in the sandbox's setup log, which
 * the agent's Terminal reads. The row goes with its workspace and with its
 * agent.
 */
export const workspaceSandboxScriptRun = pgTable(
  "workspace_sandbox_script_run",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Which script ran (`CLOUD_SETUP_SCRIPT`). */
    script: text("script").$type<CloudSetupScript>().notNull(),
    /** `owner/name` of the repository whose script ran, lowercased, since GitHub's names ignore case; null for the install script, which is the workspace's. */
    repository: text("repository"),
    /** The agent whose sandbox it ran in. */
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    exitCode: integer("exit_code").notNull(),
    /** When the run started. */
    ranAt: timestamptz("ran_at").notNull(),
  },
  (table) => [
    // One row per script, the install script's under no repository.
    unique("workspace_sandbox_script_run_organization_script_repository")
      .on(table.organizationId, table.script, table.repository)
      .nullsNotDistinct(),
  ],
);
