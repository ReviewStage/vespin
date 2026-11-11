/**
 * base-drive-repositories.ts -- every workspace a base drive may stand in, read across accounts for the scheduled refresh alone.
 *
 * A workspace's repository has a base drive
 * (`packages/service/src/agents/base-drive.ts`) for every repository its
 * GitHub installations grant, filled by the scheduled refresh before any
 * agent asks for one. The refresh reads each workspace that has an active
 * installation, once, with the account of its owner, whose firewall the
 * fill's sandbox writes under; which repositories the installations grant is
 * GitHub's to say, and whether a drive stands the sandbox provider's.
 */

import { GITHUB_INSTALLATION_STATUS } from "@repo/features/github-installation-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { and, asc, eq, sql } from "drizzle-orm";
import { Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { member } from "../schemas/auth.js";
import { githubInstallation } from "../schemas/github-installation.js";
import type { AgentStoreEffect } from "./agent-store.js";

const BaseDriveWorkspaceSchema = Schema.Struct({
  workspaceId: Schema.String,
  userId: Schema.String,
});

/** A workspace with an active GitHub installation, and the account of its first owner. */
export type BaseDriveWorkspace = typeof BaseDriveWorkspaceSchema.Type;

const findBaseDriveWorkspaces = SqlSchema.findAll({
  Request: Schema.Void,
  Result: BaseDriveWorkspaceSchema,
  execute: () =>
    Database.use((db) =>
      db
        .selectDistinctOn([member.organizationId], {
          workspaceId: member.organizationId,
          userId: member.userId,
        })
        .from(member)
        .where(
          and(
            eq(member.role, WORKSPACE_ROLE.OWNER),
            sql`exists (select 1 from ${githubInstallation} where ${githubInstallation.organizationId} = ${member.organizationId} and ${githubInstallation.status} = ${GITHUB_INSTALLATION_STATUS.ACTIVE})`,
          ),
        )
        .orderBy(member.organizationId, asc(member.createdAt)),
    ),
});

/** Every workspace with an active GitHub installation, of every account, for the scheduled refresh alone. */
export function listBaseDriveWorkspaces(): AgentStoreEffect<readonly BaseDriveWorkspace[]> {
  return findBaseDriveWorkspaces(undefined);
}
