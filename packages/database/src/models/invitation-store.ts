import { randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { invitation, member, user } from "../schemas/auth.js";

/**
 * invitation-store.ts -- a workspace's invitations read, made, and canceled on the organization plugin's own rows by the service.
 *
 * Better Auth's organization plugin takes only a session for
 * `createInvitation`, `listInvitations`, and `cancelInvitation` in 1.7.7,
 * so the service, which acts for an account by its OAuth token, reads and
 * writes the plugin's `invitation` rows here through Drizzle, as the
 * plugin's adapter does: an invitation made pending, by its inviter, until
 * the expiry given, and one canceled by its status alone, its row kept, so
 * the accept page still says it is spent (`invitation-offers.ts`). An
 * address is compared as the plugin compares it, lowercased, against an
 * account's address and an invitation's as stored.
 *
 * What may be invited, by whom, and for how long are the caller's to hold
 * (`packages/service/src/accounts/`); this module keeps only the rows.
 */

/** The plugin's word for an invitation not yet accepted, rejected, or canceled. */
const PENDING = "pending";

/** The plugin's word for an invitation its workspace withdrew. */
const CANCELED = "canceled";

export type InvitationStoreEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One invitation as the service reads it: its address, the role it hands, where any, its status, and when it expires. */
const InvitationRowSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: Schema.NullOr(Schema.String),
  status: Schema.String,
  expiresAt: Schema.Date,
});

export type InvitationRow = typeof InvitationRowSchema.Type;

/** An invitation as it is made: the workspace, the address, the role, who invited, when, and until when. */
const InvitationMadeSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  email: Schema.String,
  role: Schema.String,
  inviterId: Schema.String,
  createdAt: Schema.Date,
  expiresAt: Schema.Date,
});

export type InvitationMade = Omit<typeof InvitationMadeSchema.Type, "id">;

const INVITATION_COLUMNS = {
  id: invitation.id,
  email: invitation.email,
  role: invitation.role,
  status: invitation.status,
  expiresAt: invitation.expiresAt,
} as const;

const findInvitations = SqlSchema.findAll({
  Request: Schema.String,
  Result: InvitationRowSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select(INVITATION_COLUMNS)
        .from(invitation)
        .where(eq(invitation.organizationId, organizationId)),
    ),
});

const findPending = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, now: Schema.Date }),
  Result: InvitationRowSchema,
  execute: ({ organizationId, now }) =>
    Database.use((db) =>
      db
        .select(INVITATION_COLUMNS)
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, organizationId),
            eq(invitation.status, PENDING),
            gt(invitation.expiresAt, now),
          ),
        ),
    ),
});

const findMemberOfEmail = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, email: Schema.String }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ organizationId, email }) =>
    Database.use((db) =>
      db
        .select({ userId: member.userId })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(eq(member.organizationId, organizationId), eq(user.email, email)))
        .limit(1),
    ),
});

const insertInvitation = SqlSchema.findOne({
  Request: InvitationMadeSchema,
  Result: InvitationRowSchema,
  execute: (made) =>
    Database.use((db) =>
      db
        .insert(invitation)
        .values({ ...made, status: PENDING })
        .returning(INVITATION_COLUMNS),
    ),
});

const updateCanceled = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, invitationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ organizationId, invitationId }) =>
    Database.use((db) =>
      db
        .update(invitation)
        .set({ status: CANCELED })
        .where(
          and(
            eq(invitation.id, invitationId),
            eq(invitation.organizationId, organizationId),
            eq(invitation.status, PENDING),
          ),
        )
        .returning({ id: invitation.id }),
    ),
});

/** Every invitation of the workspace, whatever its status, in no order. */
export function listWorkspaceInvitations(
  organizationId: string,
): InvitationStoreEffect<readonly InvitationRow[]> {
  return findInvitations(organizationId);
}

/** The workspace's invitations still pending at `now`, in no order. */
export function pendingWorkspaceInvitations(
  organizationId: string,
  now: Date,
): InvitationStoreEffect<readonly InvitationRow[]> {
  return findPending({ organizationId, now });
}

/** Whether an account under the address, as given, is a member of the workspace. */
export function isWorkspaceMemberAddress(
  organizationId: string,
  email: string,
): InvitationStoreEffect<boolean> {
  return Effect.map(findMemberOfEmail({ organizationId, email }), Option.isSome);
}

/** The invitation made pending under a new id, answered as it stands. */
export function createWorkspaceInvitation(
  made: InvitationMade,
): InvitationStoreEffect<InvitationRow> {
  return insertInvitation({ ...made, id: randomUUID() }).pipe(
    // An insert that returned no row is the database breaking its own contract, not an outcome.
    Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
  );
}

/** The workspace's pending invitation canceled, whether one was; another workspace's, or one no longer pending, is left as it is. */
export function cancelWorkspaceInvitation(
  organizationId: string,
  invitationId: string,
): InvitationStoreEffect<boolean> {
  return Effect.map(updateCanceled({ organizationId, invitationId }), (rows) => rows.length > 0);
}
