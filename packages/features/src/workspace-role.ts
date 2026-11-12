/**
 * workspace-role.ts -- what the account's role in a workspace lets it do and how a role is said, read where a client decides what to offer.
 */

import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
} from "./workspace-wire.js";

/** Whether the account's role lets it manage the workspace's members and GitHub organization. */
export function managesWorkspace(workspace: Workspace): boolean {
  return workspace.role === WORKSPACE_ROLE.OWNER || workspace.role === WORKSPACE_ROLE.ADMIN;
}

/** A member's role in their workspace, in the words a row and a card say it, on every client. */
export const WORKSPACE_ROLE_WORDS = {
  [WORKSPACE_ROLE.OWNER]: "Owner",
  [WORKSPACE_ROLE.ADMIN]: "Admin",
  [WORKSPACE_ROLE.MEMBER]: "Member",
} as const satisfies Record<WorkspaceRole, string>;

/** Whether the reader's role removes a member of `role`, as the service holds it. */
function removesMember(reader: WorkspaceRole, role: WorkspaceRole): boolean {
  if (reader === WORKSPACE_ROLE.OWNER) return role !== WORKSPACE_ROLE.OWNER;

  return reader === WORKSPACE_ROLE.ADMIN && role === WORKSPACE_ROLE.MEMBER;
}

/** What the reader may do to one member of a workspace. */
export interface MemberActs {
  /** Make a member an admin. */
  readonly promote: boolean;
  /** Make an admin a member. */
  readonly demote: boolean;
  /** Hand the workspace to an admin. */
  readonly transfer: boolean;
  readonly remove: boolean;
}

/**
 * What the reader may do to another member, by both their roles, as the
 * service holds it: the owner makes a member an admin, an admin a member or
 * the owner, though never in the account's own first workspace, which is
 * named for its creator, and removes anyone but itself; an admin removes
 * members alone. Nobody acts on themselves, whose way out is Leave.
 */
export function memberActs(
  workspace: Workspace,
  member: WorkspaceMember,
  self: boolean,
): MemberActs {
  const owner = workspace.role === WORKSPACE_ROLE.OWNER && !self;
  const admin = member.role === WORKSPACE_ROLE.ADMIN;

  return {
    promote: owner && member.role === WORKSPACE_ROLE.MEMBER,
    demote: owner && admin,
    transfer: owner && admin && workspace.personal !== true,
    remove: !self && removesMember(workspace.role, member.role),
  };
}
