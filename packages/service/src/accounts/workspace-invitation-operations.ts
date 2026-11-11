/**
 * workspace-invitation-operations.ts -- a workspace's pending invitations read, one made, and one canceled by an owner or an admin, as the hosted procedures make them.
 *
 * Each is the one operation its doors run: `workspaceInvitations.list`,
 * `invite`, and `cancel` (`workspace-invitations-procedures.ts`) for the
 * desktop, the web app, and the command-line tool, under the account's
 * OAuth token. An owner or an admin reads, makes, and cancels a workspace's
 * invitations, the owner alone inviting an admin. Each invitation is
 * answered with its accept link on the origin the door names, and one made
 * is emailed to its address where the deployment names a sender
 * (`invitation-mail.ts`).
 *
 * The rows are the organization plugin's own, written by the store
 * (`invitation-store.ts`), since the plugin's invitation calls take only a
 * session. What the plugin's `createInvitation` checked beyond who asks is
 * checked here the same way, each value mirroring Better Auth 1.7.7's
 * organization plugin: the address lowercased and held to the plugin's
 * pattern for one, one already a member's or already invited and pending
 * refused as already invited, a workspace
 * holding its cap of pending invitations refused as not permitted, and an
 * invitation made to expire when the plugin's would.
 */

import {
  cancelWorkspaceInvitation,
  createWorkspaceInvitation,
  INVITATION_STATUS,
  type InvitationRow,
  isWorkspaceMemberAddress,
  listWorkspaceInvitations,
  pendingWorkspaceInvitations,
} from "@repo/database/models/invitation-store";
import { workspaceGitHubAccountId } from "@repo/database/models/workspace-store";
import { githubAccountAvatarUrl } from "@repo/features/account-picture";
import {
  INVITATION_ROLE,
  invitationAcceptUrl,
  type WorkspaceInvitation,
} from "@repo/features/workspace-invitation-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { Clock, Effect, Option, Schema } from "effect";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_WORKSPACE_MEMBER_ACTION,
} from "../events/server-events.js";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../http/http-effect.js";
import { readAccountPerson, readAccountPicture } from "./account-person.js";
import { InvitationMail } from "./invitation-mail.js";
import { managedWorkspace } from "./workspace-access.js";

/** How long an invitation stands before it expires: Better Auth 1.7.7's organization plugin's default `invitationExpiresIn`, 48 hours. */
const INVITATION_EXPIRES_IN_MS = 48 * 60 * 60 * 1_000;

/** How many pending invitations a workspace holds before another is refused: Better Auth 1.7.7's organization plugin's default `invitationLimit`. */
const PENDING_INVITATION_LIMIT = 100;

/**
 * Whether a lowercased address is one Better Auth 1.7.7's organization
 * plugin invites: zod's `z.email()` pattern, which its `createInvitation`
 * checks the address against, stricter than the wire's own
 * (`workspace-invitation-wire.ts`), refusing a dot at the local part's start
 * or two in a row, and a top-level domain of one letter or none.
 */
const isPluginInvitableEmail = Schema.is(
  Schema.String.check(
    Schema.isPattern(
      /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+.-]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/,
    ),
  ),
);

/** Who an invitation's email says invited them where the inviter's account cannot be read. */
const INVITER_UNKNOWN = "A teammate";

/** The role an invitation carries, where it is one an invitation may; anything else is no invitation of ours. */
function invitationRoleOf(role: string | null): WorkspaceInvitation["role"] | undefined {
  return Object.values(INVITATION_ROLE).find((one) => one === role);
}

/**
 * The invitations as a member reads them: pending and unexpired alone,
 * soonest to expire first, each with its accept link on the origin given.
 */
function pendingInvitations(
  invitations: readonly InvitationRow[],
  origin: string,
  now: number,
): readonly WorkspaceInvitation[] {
  return invitations
    .filter((one) => one.status === INVITATION_STATUS.PENDING && one.expiresAt.getTime() > now)
    .toSorted((first, second) => first.expiresAt.getTime() - second.expiresAt.getTime())
    .flatMap((one) => {
      const role = invitationRoleOf(one.role);
      if (role === undefined) return [];
      return [
        {
          id: one.id,
          email: one.email,
          role,
          expiresAt: one.expiresAt.toISOString(),
          acceptUrl: invitationAcceptUrl(origin, one.id, one.email),
        },
      ];
    });
}

/** The workspace's pending invitations as they stand, read for its owner or an admin. */
const pendingOf = Effect.fn("web/workspacePendingInvitations")(function* (
  organizationId: string,
  origin: string,
) {
  const listed = yield* hostedStoreOrUnavailable(listWorkspaceInvitations(organizationId));
  return pendingInvitations(listed, origin, yield* Clock.currentTimeMillis);
});

/**
 * The invitation made, emailed to its address from the deployment's sender
 * (`invitation-mail.ts`), naming the inviter by their name, or their address
 * where their account has none. A runtime without a sender
 * emails nothing, and an inviter whose row cannot be read is "A teammate",
 * since the invitation already stands.
 *
 * The letter shows pictures a mail client loads by address alone: the
 * workspace's connected GitHub account's avatar, else, on the inviter's own
 * first workspace, their sign-in picture, else the letter draws its tile; and
 * the inviter's sign-in picture, else their initial. Note that a photo
 * uploaded in Settings is not shown, because it is served to members alone.
 */
const emailInvitation = Effect.fn("web/emailWorkspaceInvitation")(function* (
  invitation: WorkspaceInvitation,
  workspace: Workspace,
  inviterId: string,
) {
  const mail = yield* Effect.serviceOption(InvitationMail);
  if (Option.isNone(mail)) return;
  const inviter = yield* readAccountPerson(inviterId).pipe(Effect.orElseSucceed(() => undefined));
  const accountId = yield* workspaceGitHubAccountId(inviterId, workspace.id).pipe(
    Effect.orElseSucceed(() => Option.none<number>()),
  );
  const workspacePictureUrl = Option.match(accountId, {
    onNone: () => workspace.pictureUrl,
    onSome: githubAccountAvatarUrl,
  });
  const inviterPictureUrl = yield* readAccountPicture(inviterId).pipe(
    Effect.orElseSucceed(() => undefined),
  );
  yield* mail.value.send({
    email: invitation.email,
    acceptUrl: invitation.acceptUrl,
    workspaceName: workspace.name,
    inviterLabel: inviter?.name.trim() || inviter?.email || INVITER_UNKNOWN,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    ...(workspacePictureUrl === undefined ? {} : { workspacePictureUrl }),
    ...(inviterPictureUrl === undefined ? {} : { inviterPictureUrl }),
  });
});

/** A workspace's pending invitations, to its owner or an admin, each with its accept link on `origin`. */
export const workspaceInvitationsRead = Effect.fn("web/workspaceInvitationsRead")(function* (
  userId: string,
  workspaceId: string,
  origin: string,
) {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  return { invitations: yield* pendingOf(workspace.id, origin) };
});

/**
 * An owner's or an admin's invitation of an address to the workspace, the
 * owner alone inviting an admin, answered with the invitation and its
 * accept link on `origin`, and emailed to the address.
 */
export const workspaceInvite = Effect.fn("web/workspaceInvite")(function* (
  userId: string,
  input: {
    readonly workspaceId: string;
    readonly email: string;
    readonly role: WorkspaceInvitation["role"];
  },
  origin: string,
) {
  const workspace = yield* managedWorkspace(userId, input.workspaceId);
  if (input.role === INVITATION_ROLE.ADMIN && workspace.role !== WORKSPACE_ROLE.OWNER) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  const email = input.email.toLowerCase();
  // Note that an address the plugin would not invite is not permitted, as the plugin's refusal was answered.
  if (!isPluginInvitableEmail(email)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const now = yield* Clock.currentTimeMillis;
  if (yield* hostedStoreOrUnavailable(isWorkspaceMemberAddress(workspace.id, email))) {
    return yield* Effect.fail(HOSTED_REFUSAL.ALREADY_INVITED);
  }
  const pending = yield* hostedStoreOrUnavailable(
    pendingWorkspaceInvitations(workspace.id, new Date(now)),
  );
  if (pending.some((one) => one.email === email)) {
    return yield* Effect.fail(HOSTED_REFUSAL.ALREADY_INVITED);
  }
  if (pending.length >= PENDING_INVITATION_LIMIT) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  const made = yield* hostedStoreOrUnavailable(
    createWorkspaceInvitation({
      organizationId: workspace.id,
      email,
      role: input.role,
      inviterId: userId,
      createdAt: new Date(now),
      expiresAt: new Date(now + INVITATION_EXPIRES_IN_MS),
    }),
  );
  yield* recordServerEvent(
    SERVER_EVENT.WORKSPACE_INVITE_SEND,
    { userId, workspaceId: workspace.id },
    { role: input.role },
  );
  const [invitation] = pendingInvitations([made], origin, now);
  if (invitation === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  yield* emailInvitation(invitation, workspace, userId);
  return { invitation };
});

/** An owner's or an admin's cancel of one of the workspace's pending invitations, answered with those still pending; any other is not found. */
export const workspaceInvitationCancel = Effect.fn("web/workspaceInvitationCancel")(function* (
  userId: string,
  workspaceId: string,
  invitationId: string,
  origin: string,
) {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const pending = yield* pendingOf(workspace.id, origin);
  if (!pending.some((one) => one.id === invitationId)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  yield* hostedStoreOrUnavailable(cancelWorkspaceInvitation(workspace.id, invitationId));
  yield* recordServerEvent(
    SERVER_EVENT.WORKSPACE_MEMBER_CHANGE,
    { userId, workspaceId: workspace.id },
    { action: SERVER_WORKSPACE_MEMBER_ACTION.INVITE_CANCEL },
  );
  return { invitations: yield* pendingOf(workspace.id, origin) };
});
