/**
 * workspaces-procedures.ts -- the account's workspaces as the Mac reads and asks for them: the list, a workspace created, renamed, given a slug or a photo, handed over, or deleted, and its members read, removed, given a role, or left.
 *
 * `GET /api/workspaces` answers every workspace the bearer's account is a
 * member of, the one made for it first and the rest by name, each with the
 * account's role and its connected GitHub account; that first workspace is
 * ensured before the read, so an account's first read makes it, and it is
 * then a workspace like any other. `POST` creates a workspace with the name
 * given through the organization plugin's server-only create, the account
 * its owner.
 * `GET /api/workspaces/members` answers a workspace's members to a member
 * of it, and who its work still names but left. `POST /api/workspaces/members/remove`
 * lets the owner remove an admin or a member, and an admin a member alone;
 * `POST /api/workspaces/members/role` lets the owner alone make a member an
 * admin or an admin a member; `POST /api/workspaces/transfer` lets the owner
 * alone hand the workspace to an admin, becoming an admin, though never the
 * account's own first workspace, which is named for its creator; each
 * answers the members as they then stand. Nobody removes or changes
 * themselves, whose way out is leaving, or the owner.
 * `POST /api/workspaces/leave` lets anyone but an owner leave. A member
 * removed, or one who leaves, stays assigned to the workspace's tasks they
 * were on, read as a former member (`workspace-members.ts`), until someone
 * clears or changes it.
 * `POST /api/workspaces/delete` lets the owner alone delete a workspace,
 * though never the account's own first workspace, which goes only with the
 * account, and, where it is asked `ifAlone`, never one anyone else is a
 * member of or that holds an agent, as setup's Just me asks of the team's
 * workspace it made without asking (its pending invitations go with it). Every turn under way among the
 * workspace's agents not archived, any member's, one the owner cannot see
 * among them, is stopped first under
 * the account that started it (`everyTurnStoppedByStarter`), which nothing
 * past a Stop's own loses should the delete then be refused; the plugin
 * then deletes the workspace and every row of it, and its hooks delete the
 * agents' conversations and sandboxes (`workspace-deletion.ts`).
 * `POST /api/workspaces/rename` lets an owner or admin rename a workspace,
 * answering it under its new name and its old slug; an account's first
 * workspace is refused, since it is named by its owner's account name.
 * `POST /api/workspaces/slug/set` lets the owner alone change the slug, an
 * account's first workspace's among them, refusing one spelled other than a
 * slug may be, one reserved, and one another workspace holds or held, each
 * by its own word; the slug it stood under stays its own
 * (`workspace-slug-store.ts`), and it is answered under the new one.
 * `POST /api/workspaces/photo/set` lets an owner or admin set the photo, as
 * a `data:` URL of a photo's type within its bound, or remove it with null,
 * answering the workspace with its photo's new version or none. The photo's
 * bytes are served apart (`workspaces-app.ts`).
 * `POST /api/workspaces/experiment/set` lets an owner or admin turn a
 * workspace experiment on or off for everyone in the workspace, refusing a
 * key that names none, and answers the workspace with who changed each of
 * its experiments last (`workspace-experiment-store.ts`).
 *
 * Every procedure takes the account's OAuth token, so the desktop, the web
 * app, the iPhone, the command-line tool, and the member MCP server reach
 * each the same way. Each write is one operation the procedure hands its
 * input to, which holds who may make it: the members' writes
 * (`workspace-member-operations.ts`), the delete (`workspace-delete.ts`),
 * and the slug, the name, and the photo (`workspace-operations.ts`). The
 * organization plugin's rows they write are the store's to write
 * (`organization-store.ts`), since the plugin's own member, update, and
 * delete calls take only a session.
 *
 * The caller is resolved, and a body held to its bound, on the resource
 * before its input is read, so an unsigned caller is refused as
 * unauthenticated and an oversized body as too large whatever it carries.
 */

import { setWorkspaceExperiment } from "@repo/database/models/workspace-experiment-store";
import type { WorkspaceSeams } from "@repo/database/models/workspace-seams";
import { ensurePersonalWorkspace, listWorkspaces } from "@repo/database/models/workspace-store";
import { WORKSPACE_MEMBERS_QUERY } from "@repo/features/workspace-wire";
import { isExperiment, isWorkspaceExperiment } from "@repo/settings";
import { Effect } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { answeredWorkspace, managedWorkspace } from "./workspace-access.js";
import { createdWorkspace, pluginWriteOrUnavailable } from "./workspace-create.js";
import { workspaceDelete } from "./workspace-delete.js";
import {
  workspaceLeave,
  workspaceMemberRemove,
  workspaceMemberRoleChange,
  workspaceTransfer,
} from "./workspace-member-operations.js";
import {
  workspaceMembersRead,
  workspacePhotoSet,
  workspaceRename,
  workspaceSlugSet,
} from "./workspace-operations.js";

export interface WorkspacesProcedureSeams {
  resolveUserId: UserIdResolver;
  workspaces: WorkspaceSeams;
}

/** The workspaces resource, every procedure under the account's OAuth token. */
export function workspacesProcedures(seams: WorkspacesProcedureSeams) {
  const account = hosted.workspaces.use(accountMiddleware(seams.resolveUserId));
  return {
    list: account.list.effect(function* ({ context }) {
      yield* pluginWriteOrUnavailable(ensurePersonalWorkspace(context.userId, seams.workspaces));
      return { workspaces: yield* hostedStoreOrUnavailable(listWorkspaces(context.userId)) };
    }),
    create: account.create.effect(function* ({ context, input }) {
      return { workspace: yield* createdWorkspace(seams.workspaces, context.userId, input.name) };
    }),
    members: account.members.effect(function* ({ context, input }) {
      return yield* workspaceMembersRead(
        context.userId,
        input[WORKSPACE_MEMBERS_QUERY.WORKSPACE_ID],
      );
    }),
    removeMember: account.removeMember.effect(function* ({ context, input }) {
      return yield* workspaceMemberRemove(context.userId, input.workspaceId, input.userId);
    }),
    changeRole: account.changeRole.effect(function* ({ context, input }) {
      return yield* workspaceMemberRoleChange(
        context.userId,
        input.workspaceId,
        input.userId,
        input.role,
      );
    }),
    transfer: account.transfer.effect(function* ({ context, input }) {
      return yield* workspaceTransfer(context.userId, input.workspaceId, input.userId);
    }),
    leave: account.leave.effect(function* ({ context, input }) {
      return yield* workspaceLeave(context.userId, input.workspaceId);
    }),
    delete: account.delete.effect(function* ({ context, input }) {
      return yield* workspaceDelete(context.userId, input.workspaceId, input.ifAlone === true);
    }),
    rename: account.rename.effect(function* ({ context, input }) {
      return yield* workspaceRename(context.userId, input.workspaceId, input.name);
    }),
    setSlug: account.setSlug.effect(function* ({ context, input }) {
      return yield* workspaceSlugSet(context.userId, input.workspaceId, input.slug);
    }),
    setPhoto: account.setPhoto.effect(function* ({ context, input }) {
      return yield* workspacePhotoSet(context.userId, input.workspaceId, input.photo);
    }),
    /**
     * Note that the choice is written by the store rather than the plugin,
     * because an experiment is the app's state and not the plugin's, and an
     * owner or admin may make it, which `managedWorkspace` holds. A key this
     * build does not list as a workspace's experiment is refused.
     */
    setExperiment: account.setExperiment.effect(function* ({ context, input }) {
      const { userId } = context;
      const { workspaceId, experiment, on } = input;
      if (!isExperiment(experiment) || !isWorkspaceExperiment(experiment)) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      const workspace = yield* managedWorkspace(userId, workspaceId);
      yield* hostedStoreOrUnavailable(
        setWorkspaceExperiment({ organizationId: workspace.id, experiment, on, by: userId }),
      );
      return { workspace: yield* answeredWorkspace(userId, workspace.id) };
    }),
  };
}
