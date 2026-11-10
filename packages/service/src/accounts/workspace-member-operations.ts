/**
 * workspace-member-operations.ts -- a workspace's member removed, given a role, handed the workspace, or leaving, as the hosted procedures make each and the member MCP tools will.
 *
 * Each is the one operation its doors run: `workspaces.removeMember`,
 * `changeRole`, `transfer`, and `leave` (`workspaces-procedures.ts`) for the
 * desktop, the web app, the iPhone, and the command-line tool, under the
 * account's OAuth token. Who may do what stands here alone: the owner
 * removes an admin or a member and an admin a member alone; the owner alone
 * makes a member an admin or an admin a member, and hands the workspace to
 * an admin, becoming an admin, though never the account's own first
 * workspace, which is named for its creator; anyone but an owner leaves.
 * Nobody removes or changes themselves, whose way out is leaving, or the
 * owner. Each change is counted under the member who made it, and each but
 * a leaving answers the members as they then stand.
 *
 * The rows are the organization plugin's own, written by the store
 * (`organization-store.ts`), since the plugin's member writes take only a
 * session and these rules already make the whole decision. A member
 * removed, or one who leaves, stays assigned to the workspace's tasks they
 * were on, read as a former member (`workspace-members.ts`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  handOverWorkspace,
  removeWorkspaceMember,
  setWorkspaceMemberRole,
} from "@repo/database/models/organization-store";
import { workspaceOf } from "@repo/database/models/workspace-store";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";
import { Effect, Option } from "effect";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_WORKSPACE_MEMBER_ACTION,
  type ServerWorkspaceMemberAction,
} from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { answeredWorkspace, ownedWorkspace } from "./workspace-access.js";
import { listMembers } from "./workspace-members.js";

/** The roles a workspace is handed to: an admin, or an owner a handover cut short already made one. */
const HEIR_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  WORKSPACE_ROLE.ADMIN,
  WORKSPACE_ROLE.OWNER,
]);

/** The roles each role removes: the owner an admin or a member, an admin a member alone. */
const REMOVABLE_BY: ReadonlyMap<WorkspaceRole, ReadonlySet<WorkspaceRole>> = new Map([
  [WORKSPACE_ROLE.OWNER, new Set([WORKSPACE_ROLE.ADMIN, WORKSPACE_ROLE.MEMBER])],
  [WORKSPACE_ROLE.ADMIN, new Set([WORKSPACE_ROLE.MEMBER])],
]);

/**
 * Another member's role in the workspace, as the account would act on them.
 * One not in it is not found; the account itself is not permitted, since
 * its own way out is leaving.
 */
const otherMemberRole = Effect.fn("web/workspaceOtherMember")(function* (
  userId: string,
  workspaceId: string,
  otherId: string,
) {
  if (otherId === userId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const other = yield* hostedStoreOrUnavailable(workspaceOf(otherId, workspaceId));
  if (Option.isNone(other)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return other.value.role;
});

/** The members of a workspace as they stand after a write. */
const membersNow = (
  workspaceId: string,
): Effect.Effect<
  { members: Effect.Success<ReturnType<typeof listMembers>> },
  HostedRefusal,
  DatabaseServices
> => Effect.map(hostedStoreOrUnavailable(listMembers(workspaceId)), (members) => ({ members }));

/** A change to a workspace's members, or to the workspace, counted under the member who made it. */
export function memberChanged(
  userId: string,
  workspaceId: string,
  action: ServerWorkspaceMemberAction,
) {
  return recordServerEvent(
    SERVER_EVENT.WORKSPACE_MEMBER_CHANGE,
    { userId, workspaceId },
    { action },
  );
}

/** The account removing another from the workspace, answered with the members as they then stand. */
export const workspaceMemberRemove = Effect.fn("web/workspaceMemberRemove")(function* (
  userId: string,
  workspaceId: string,
  removed: string,
) {
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  const removable = REMOVABLE_BY.get(workspace.role);
  if (removable === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const role = yield* otherMemberRole(userId, workspace.id, removed);
  if (!removable.has(role)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* hostedStoreOrUnavailable(removeWorkspaceMember(workspace.id, removed));
  yield* memberChanged(userId, workspace.id, SERVER_WORKSPACE_MEMBER_ACTION.REMOVE);
  return yield* membersNow(workspace.id);
});

/** The owner giving another member a role, answered with the members as they then stand. */
export const workspaceMemberRoleChange = Effect.fn("web/workspaceMemberRoleChange")(function* (
  userId: string,
  workspaceId: string,
  changed: string,
  role: WorkspaceRole,
) {
  const workspace = yield* ownedWorkspace(userId, workspaceId);
  const current = yield* otherMemberRole(userId, workspace.id, changed);
  if (current === WORKSPACE_ROLE.OWNER) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* hostedStoreOrUnavailable(setWorkspaceMemberRole(workspace.id, changed, role));
  yield* memberChanged(userId, workspace.id, SERVER_WORKSPACE_MEMBER_ACTION.ROLE_CHANGE);
  return yield* membersNow(workspace.id);
});

/**
 * The owner hands the workspace to one of its admins and becomes an admin,
 * both roles moved in one transaction. The account's first workspace is
 * refused, because every read names it for its creator, whoever owns it,
 * and nobody may rename it. An heir who is already an owner is a handover
 * cut short before both roles moved in one write, so the old owner trying
 * again finishes it.
 */
export const workspaceTransfer = Effect.fn("web/workspaceTransfer")(function* (
  userId: string,
  workspaceId: string,
  heir: string,
) {
  const workspace = yield* ownedWorkspace(userId, workspaceId);
  if (workspace.personal === true) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const role = yield* otherMemberRole(userId, workspace.id, heir);
  if (!HEIR_ROLES.has(role)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* hostedStoreOrUnavailable(handOverWorkspace(workspace.id, userId, heir));
  yield* memberChanged(userId, workspace.id, SERVER_WORKSPACE_MEMBER_ACTION.TRANSFER);
  return yield* membersNow(workspace.id);
});

/** The account leaving the workspace, which an owner may not. */
export const workspaceLeave = Effect.fn("web/workspaceLeave")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  if (workspace.role === WORKSPACE_ROLE.OWNER) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  yield* hostedStoreOrUnavailable(removeWorkspaceMember(workspace.id, userId));
  yield* memberChanged(userId, workspace.id, SERVER_WORKSPACE_MEMBER_ACTION.LEAVE);
  return { workspaceId: workspace.id };
});
