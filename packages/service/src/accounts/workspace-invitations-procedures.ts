/**
 * workspace-invitations-procedures.ts -- a workspace's invitations as an owner or an admin lists, makes, and cancels them from the Mac, and one as its recipient is offered it on the accept page.
 *
 * The list, the make, and the cancel take the account's OAuth token, so the
 * desktop, the web app, the command-line tool, and the member MCP server
 * reach each the same way: `GET /api/workspaces/invitations` answers the
 * pending invitations, each with its accept link, `POST` makes one, the
 * owner alone inviting an admin, and emails its link to the invited address
 * where the deployment names a sender, and `POST
 * /api/workspaces/invitations/cancel` cancels one, answering those still
 * pending. Each is one operation (`workspace-invitation-operations.ts`),
 * which holds who may make it and writes the organization plugin's rows
 * through the store, since the plugin's invitation calls take only a
 * session. `GET /api/workspaces/invitations/offer` answers one invitation
 * as its recipient is offered it on the accept page
 * (`invitation-offers.ts`), under the browser's Better Auth session: the
 * workspace's name, the role, and the inviter while they are still a
 * member, or why there is none to offer.
 *
 * The caller is resolved before the input is read, by the middleware on
 * the resource, so an unsigned caller is refused as unauthenticated
 * whatever it sent.
 */

import { WORKSPACE_INVITATIONS_QUERY } from "@repo/features/workspace-invitation-wire";
import { Clock } from "effect";
import {
  hostedStoreOrUnavailable,
  type SessionUserIdResolver,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted, sessionMiddleware } from "../orpc/base.js";
import { invitationOffer } from "./invitation-offers.js";
import {
  workspaceInvitationCancel,
  workspaceInvitationsRead,
  workspaceInvite,
} from "./workspace-invitation-operations.js";

export interface WorkspaceInvitationsProcedureSeams {
  /** The account the OAuth token names, for the list, the make, and the cancel. */
  resolveUserId: UserIdResolver;
  /** The account the browser's Better Auth session names, for the accept page's offer. */
  resolveSessionUserId: SessionUserIdResolver;
}

/** The origin an invitation's accept link is on: the service's own, as the request reached it. */
function originOf(request: Request): string {
  return new URL(request.url).origin;
}

/** The workspace invitations resource: the list, the make, and the cancel to an owner or an admin, and the offer to its recipient. */
export function workspaceInvitationsProcedures(seams: WorkspaceInvitationsProcedureSeams) {
  const account = hosted.workspaceInvitations.use(accountMiddleware(seams.resolveUserId));
  const session = hosted.workspaceInvitations.use(sessionMiddleware(seams.resolveSessionUserId));
  return {
    list: account.list.effect(function* ({ input, context }) {
      return yield* workspaceInvitationsRead(
        context.userId,
        input[WORKSPACE_INVITATIONS_QUERY.WORKSPACE_ID],
        originOf(context.request),
      );
    }),
    invite: account.invite.effect(function* ({ input, context }) {
      return yield* workspaceInvite(context.userId, input, originOf(context.request));
    }),
    cancel: account.cancel.effect(function* ({ input, context }) {
      return yield* workspaceInvitationCancel(
        context.userId,
        input.workspaceId,
        input.invitationId,
        originOf(context.request),
      );
    }),
    offer: session.offer.effect(function* ({ input, context }) {
      const now = yield* Clock.currentTimeMillis;
      return yield* hostedStoreOrUnavailable(invitationOffer(context.userId, input.id, now));
    }),
  };
}
