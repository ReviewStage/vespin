/**
 * base-drive-repositories.ts -- the workspace an installation connects, and a workspace's first owner, each for a fill of its drive.
 *
 * Each workspace's drive (`packages/service/src/agents/workspace-drive.ts`)
 * is filled under the account of the workspace's first owner, whose firewall
 * the fill's sandbox writes under.
 */

import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { and, asc, eq } from "drizzle-orm";
import { type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { member } from "../schemas/auth.js";
import { githubInstallation } from "../schemas/github-installation.js";
import type { AgentStoreEffect } from "./agent-store.js";

const BaseDriveWorkspaceSchema = Schema.Struct({
  workspaceId: Schema.String,
  userId: Schema.String,
});

/** A workspace an active GitHub installation connects, and the account of its first owner, whose firewall a fill's sandbox writes under. */
export type BaseDriveWorkspace = typeof BaseDriveWorkspaceSchema.Type;

const findBaseDriveWorkspaceOfInstallation = SqlSchema.findOneOption({
  Request: Schema.Number,
  Result: BaseDriveWorkspaceSchema,
  execute: (installationId) =>
    Database.use((db) =>
      db
        .select({ workspaceId: member.organizationId, userId: member.userId })
        .from(githubInstallation)
        .innerJoin(member, eq(member.organizationId, githubInstallation.organizationId))
        .where(
          and(
            eq(githubInstallation.installationId, installationId),
            eq(member.role, WORKSPACE_ROLE.OWNER),
          ),
        )
        .orderBy(asc(member.createdAt))
        .limit(1),
    ),
});

/**
 * The workspace an installation is linked to, with its first owner, whatever
 * the installation's status, so a drive is emptied of an uninstalled
 * installation's repositories; none where it is linked to none.
 */
export function baseDriveWorkspaceOfInstallation(
  installationId: number,
): AgentStoreEffect<Option.Option<BaseDriveWorkspace>> {
  return findBaseDriveWorkspaceOfInstallation(installationId);
}

const findWorkspaceDriveOwner = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: BaseDriveWorkspaceSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ workspaceId: member.organizationId, userId: member.userId })
        .from(member)
        .where(
          and(eq(member.organizationId, organizationId), eq(member.role, WORKSPACE_ROLE.OWNER)),
        )
        .orderBy(asc(member.createdAt))
        .limit(1),
    ),
});

/** The workspace with its first owner; none where it has no owner, as a workspace being deleted. */
export function workspaceDriveOwner(
  organizationId: string,
): AgentStoreEffect<Option.Option<BaseDriveWorkspace>> {
  return findWorkspaceDriveOwner(organizationId);
}
