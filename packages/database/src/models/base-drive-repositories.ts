/**
 * base-drive-repositories.ts -- the workspaces an active GitHub installation connects, read across accounts for the scheduled refresh alone, and the workspace an installation connects, for its fill.
 *
 * Each workspace's drive (`packages/service/src/agents/workspace-drive.ts`)
 * is filled under the account of the workspace's first owner, whose firewall
 * the fill's sandbox writes under.
 */

import { GITHUB_INSTALLATION_STATUS } from "@repo/features/github-installation-wire";
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
        .from(githubInstallation)
        .innerJoin(member, eq(member.organizationId, githubInstallation.organizationId))
        .where(
          and(
            eq(githubInstallation.status, GITHUB_INSTALLATION_STATUS.ACTIVE),
            eq(member.role, WORKSPACE_ROLE.OWNER),
          ),
        )
        .orderBy(member.organizationId, asc(member.createdAt)),
    ),
});

/** Every workspace an active installation connects, with its first owner, across accounts, for the daily refresh of its drive alone. */
export function listBaseDriveWorkspaces(): AgentStoreEffect<readonly BaseDriveWorkspace[]> {
  return findBaseDriveWorkspaces(undefined);
}
