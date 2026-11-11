/**
 * workspace-settings-words.ts -- what Settings › Workspace says about its members, its invitations, and leaving, on the desktop, the web, and the iOS app alike.
 */

import { INVITATION_ROLE } from "./workspace-invitation-wire.js";

/** What a member's ⋯ offers and what its removal asks, the role changes the owner's alone. */
export const MEMBER_WORDS = {
  MAKE_ADMIN: "Make admin",
  MAKE_MEMBER: "Make member",
  MAKE_OWNER: "Make owner",
  /** The member's removal, which the menu item says. */
  REMOVE: "Remove from workspace",
  REMOVE_QUESTION: (name: string) => `Remove ${name} from this workspace?`,
  REMOVE_BODY: "They lose its tasks, agents, and inbox until they are invited again.",
  REMOVE_VERB: "Remove member",
  REMOVE_RUNNING: "Removing",
  /** The badge on the reader's own row. */
  YOU: "You",
} as const;

/** What a pending invitation's row, its cancel, and its card say. */
export const INVITATION_WORDS = {
  INVITE: "Invite",
  /** An invite's act where the reader may choose its role, the role named. */
  INVITE_AS: (role: string) => `Invite as ${role.toLowerCase()}`,
  INVITING: "Inviting",
  INVITE_TITLE: (workspace: string) => `Invite to ${workspace}`,
  EMAIL_PLACEHOLDER: "name@example.com",
  CANCEL: "Cancel invitation",
  CANCEL_QUESTION: "Cancel invitation?",
  CANCEL_BODY: (email: string) =>
    `The link sent to ${email} stops working. Inviting the address again sends a new one.`,
  CANCEL_RUNNING: "Canceling",
  /** The line under an invited address, its role named first. */
  INVITED_AS: (role: string) => `Invited as ${role}`,
} as const;

/** The roles an invitation offers, in the order a card draws them, the default first. */
export const INVITATION_ROLES = [INVITATION_ROLE.MEMBER, INVITATION_ROLE.ADMIN] as const;

/** What each role an invitation offers may do, the line under its name. */
export const INVITATION_ROLE_DETAIL = {
  [INVITATION_ROLE.MEMBER]: "Works on the workspace's tasks and agents.",
  [INVITATION_ROLE.ADMIN]: "Also invites people and manages members and integrations.",
} as const satisfies Record<(typeof INVITATION_ROLES)[number], string>;

/** Why Admin is stepped back for a reader who is not the owner. */
export const INVITE_ADMIN_OWNER_ONLY = "Only the owner can invite an admin.";

/** What a list's line says where its read did not land. */
export const WORKSPACE_READ_FAILED = {
  MEMBERS: "The members could not be read.",
  INVITATIONS: "The invitations could not be read.",
  SENTRY: "The workspace's Sentry could not be read.",
  SLACK_BOT: "The workspace's Slack bot could not be read.",
} as const;

/**
 * What the leave says: the row's line, and the question's body and what it
 * names as staying and stopping. Tasks and agents are the workspace's; an
 * agent's every step runs as its starter, read through their membership, so
 * one still working when its starter leaves stops at its next step, and a
 * run of an automation starts as its creator, so one whose creator left
 * fails as `creator-left`.
 */
export const LEAVE_WORDS = {
  PRESS: "Leave",
  RUNNING: "Leaving",
  /** The question's title and its act, the workspace's name in both. */
  QUESTION: (name: string) => `Leave ${name}?`,
  VERB: (name: string) => `Leave ${name}`,
  /** The toast once the leave has landed, the workspace's name in it, so it stays masked in a recording. */
  LEFT: (name: string) => `You left ${name}`,
  LINE: "You lose its tasks, agents, and inbox until someone invites you again.",
  TASKS: (name: string) => `Tasks you wrote stay in ${name}.`,
  AGENTS: "Agents you started that are still working stop.",
  AUTOMATIONS: "Automations you created stop running.",
  INVITATIONS: "Invitations you sent stay valid.",
  AUTOMATIONS_NAMED: (names: readonly string[]) =>
    names.length === 1
      ? `An automation you created stops running: ${names[0]}.`
      : `${names.length} automations you created stop running: ${names.join(", ")}.`,
  OWNER: "You're its owner. Make an admin the owner first, then you can leave.",
  OWNER_NO_ADMIN:
    "You're its owner. Make a member an admin, then make them the owner, and you can leave.",
  OWN: (name: string | undefined) =>
    name === undefined
      ? "Your own workspace isn't affected."
      : `Your own workspace, ${name}, isn't affected.`,
} as const;
