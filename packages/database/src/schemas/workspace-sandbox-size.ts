import { SANDBOX_SIZE, SANDBOX_VCPU_SIZES, type SandboxVcpus } from "@repo/features/sandbox-size";
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text } from "drizzle-orm/pg-core";
import { updatedAt } from "./_helpers.js";
import { organization } from "./auth.js";

/**
 * workspace-sandbox-size.ts -- how large a workspace's cloud agents' sandboxes open: the vCPUs its owners and admins chose.
 *
 * One row per workspace that chose a size, written again on each change; a
 * workspace with no row opens its agents' sandboxes at `SANDBOX_SIZE.VCPUS`.
 * Rows leave with the workspace.
 */

/** Every size a workspace may choose, as a check's list. */
const SIZES = sql.raw(SANDBOX_VCPU_SIZES.join(", "));

export const workspaceSandboxSize = pgTable(
  "workspace_sandbox_size",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The vCPUs the workspace's owners and admins chose for its agents' sandboxes. */
    vcpus: integer("vcpus").$type<SandboxVcpus>().notNull().default(SANDBOX_SIZE.VCPUS),
    updatedAt: updatedAt(),
  },
  (table) => [check("workspace_sandbox_size_vcpus", sql`${table.vcpus} in (${SIZES})`)],
);
