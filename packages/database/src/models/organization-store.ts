/**
 * organization-store.ts -- a workspace's members, name, photo, and the workspace itself written to the organization plugin's own rows by the service.
 *
 * Better Auth's organization plugin takes only a session for these writes
 * (`removeMember`, `updateMemberRole`, `leaveOrganization`,
 * `updateOrganization`, and `deleteOrganization` in 1.7.7), so the service,
 * which acts for an account by its OAuth token, writes the same rows here
 * through Drizzle. Each write is the one the plugin's adapter makes: a
 * member's row deleted or given a role, the organization's name or logo
 * changed, and a workspace deleted as the adapter deletes one, its members
 * and invitations and then its row, in one transaction, every other row of
 * the workspace cascading with it.
 *
 * Who may make each write, and what the plugin's hooks did around it, are
 * the caller's to hold (`packages/service/src/accounts/`); this module keeps
 * only the rows.
 */

import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";
import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import * as SqlClient from "effect/sql/SqlClient";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { invitation, member, organization } from "../schemas/auth.js";

export type OrganizationStoreEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const MemberKeySchema = Schema.Struct({ organizationId: Schema.String, userId: Schema.String });

const deleteMember = SqlSchema.void({
  Request: MemberKeySchema,
  execute: ({ organizationId, userId }) =>
    Database.use((db) =>
      db
        .delete(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId))),
    ),
});

const updateMemberRole = SqlSchema.void({
  Request: Schema.Struct({ ...MemberKeySchema.fields, role: Schema.String }),
  execute: ({ organizationId, userId, role }) =>
    Database.use((db) =>
      db
        .update(member)
        .set({ role })
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId))),
    ),
});

const updateName = SqlSchema.void({
  Request: Schema.Struct({ organizationId: Schema.String, name: Schema.String }),
  execute: ({ organizationId, name }) =>
    Database.use((db) =>
      db.update(organization).set({ name }).where(eq(organization.id, organizationId)),
    ),
});

const updateLogo = SqlSchema.void({
  Request: Schema.Struct({ organizationId: Schema.String, logo: Schema.NullOr(Schema.String) }),
  execute: ({ organizationId, logo }) =>
    Database.use((db) =>
      db.update(organization).set({ logo }).where(eq(organization.id, organizationId)),
    ),
});

const deleteMembersOf = SqlSchema.void({
  Request: Schema.String,
  execute: (organizationId) =>
    Database.use((db) => db.delete(member).where(eq(member.organizationId, organizationId))),
});

const deleteInvitationsOf = SqlSchema.void({
  Request: Schema.String,
  execute: (organizationId) =>
    Database.use((db) =>
      db.delete(invitation).where(eq(invitation.organizationId, organizationId)),
    ),
});

const deleteOrganizationRow = SqlSchema.void({
  Request: Schema.String,
  execute: (organizationId) =>
    Database.use((db) => db.delete(organization).where(eq(organization.id, organizationId))),
});

/** The account's membership of the workspace ended, whether removed or leaving; nothing where it is not a member. */
export function removeWorkspaceMember(
  organizationId: string,
  userId: string,
): OrganizationStoreEffect<void> {
  return deleteMember({ organizationId, userId });
}

/** The account given the role in the workspace; nothing where it is not a member. */
export function setWorkspaceMemberRole(
  organizationId: string,
  userId: string,
  role: WorkspaceRole,
): OrganizationStoreEffect<void> {
  return updateMemberRole({ organizationId, userId, role });
}

/**
 * The workspace handed from its owner to the heir: the heir made an owner
 * and the owner an admin, in one transaction, so it is never left with two
 * owners or none.
 */
export function handOverWorkspace(
  organizationId: string,
  ownerId: string,
  heirId: string,
): OrganizationStoreEffect<void> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.andThen(
        updateMemberRole({ organizationId, userId: heirId, role: WORKSPACE_ROLE.OWNER }),
        updateMemberRole({ organizationId, userId: ownerId, role: WORKSPACE_ROLE.ADMIN }),
      ),
    ),
  );
}

/** The workspace's name changed, its slug left as it was. */
export function renameWorkspace(
  organizationId: string,
  name: string,
): OrganizationStoreEffect<void> {
  return updateName({ organizationId, name });
}

/** The workspace's photo set as the `data:` URL given, or removed with null. */
export function setWorkspaceLogo(
  organizationId: string,
  logo: string | null,
): OrganizationStoreEffect<void> {
  return updateLogo({ organizationId, logo });
}

/**
 * The workspace deleted as the plugin's adapter deletes one in 1.7.7: its
 * members, then its invitations, then its row, in one transaction; every
 * other row naming the workspace cascades with its row. Nothing for a
 * workspace already gone.
 */
export function deleteWorkspaceRows(organizationId: string): OrganizationStoreEffect<void> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* deleteMembersOf(organizationId);
        yield* deleteInvitationsOf(organizationId);
        yield* deleteOrganizationRow(organizationId);
      }),
    ),
  );
}
