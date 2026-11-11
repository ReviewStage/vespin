/**
 * workspace-members.ts -- `vespin workspace members`, `remove`, `role`, `invitations`, `invite`, `uninvite`, `rename`, and `slug`: who is in the workspace a command acts in, its invitations, and its name and slug.
 *
 * `members` reads `workspaces.members`, owners first, then admins, then
 * members, with whoever the workspace's work still names but left. `remove`
 * and `role` are one `workspaces.removeMember` and `changeRole` each, on a
 * member named by account id or email, read against that same list
 * (`namedMember`); `remove` asks first, or takes `--yes`. `invitations`,
 * `invite`, and `uninvite` are `workspaceInvitations.list`, `invite`, and
 * `cancel`, each answered with accept links. `rename` is one
 * `workspaces.rename` and `slug` one `workspaces.setSlug`; a slug the
 * workspace stood under stays its own, so a link written under it still
 * opens it. All act in the workspace `-w`, `VESPIN_WORKSPACE`, or the
 * default names (`../workspace.js`), and the service decides who may.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import {
  INVITATION_ROLE,
  type WorkspaceInvitation,
} from "@repo/features/workspace-invitation-wire";
import { ASSIGNABLE_ROLE, WORKSPACE_BOUNDS } from "@repo/features/workspace-wire";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, confirmOrYes } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

/** What a removal's refusals say. */
const REMOVE_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "The owner removes an admin or a member, and an admin a member alone; nobody removes the owner or themselves.",
  [HOSTED_API_ERROR.NOT_FOUND]: "Nobody of that account is a member of the workspace.",
} as const;

/** What a role change's refusals say. */
const ROLE_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Only the workspace's owner gives a role, and never to themselves.",
  [HOSTED_API_ERROR.NOT_FOUND]: "Nobody of that account is a member of the workspace.",
} as const;

/** What an invitations read's refusals say. */
const INVITATIONS_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]: "Only the workspace's owner or an admin reads its invitations.",
} as const;

/** What an invitation's refusals say. */
const INVITE_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Only the workspace's owner or an admin invites, the owner alone as an admin; or the address is not one an invitation may go to; or the workspace holds as many pending invitations as it may.",
  [HOSTED_API_ERROR.ALREADY_INVITED]:
    "That address is already a member's, or already holds a pending invitation.",
} as const;

/** What a cancel's refusals say. */
const UNINVITE_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Only the workspace's owner or an admin cancels its invitations.",
  [HOSTED_API_ERROR.NOT_FOUND]:
    "No pending invitation of the workspace has that id. vespin workspace invitations lists them.",
} as const;

/** What a rename's refusals say. */
const RENAME_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Only the workspace's owner or an admin renames it, and an account's first workspace, named for its owner, is never renamed.",
} as const;

/** What a slug change's refusals say, beyond what any call's would. */
const SLUG_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]: "Only the workspace's owner may change its slug.",
  [HOSTED_API_ERROR.WORKSPACE_SLUG_MALFORMED]: `A slug is lowercase letters and digits, with single hyphens between them, at most ${WORKSPACE_BOUNDS.MAX_SLUG_CHARS} characters.`,
  [HOSTED_API_ERROR.WORKSPACE_SLUG_RESERVED]: "That slug is reserved; choose another.",
  [HOSTED_API_ERROR.WORKSPACE_SLUG_TAKEN]:
    "Another workspace holds or held that slug; choose another.",
} as const;

/** The member argument of `remove` and `role`. */
const memberArgument = Argument.String("member").pipe(
  Argument.withDescription("The member, by account id or email, as members prints them"),
);

/**
 * The member of the workspace a command names, by account id or by email in
 * any case, as `workspaces.members` lists them; a usage failure listing the
 * members where none matches.
 */
export const namedMember = (workspaceId: string, named: string) =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const { members } = yield* askService(hosted.workspaces.members, { workspaceId });
    const email = named.toLowerCase();
    const member = members.find((one) => one.userId === named || one.email.toLowerCase() === email);
    if (member !== undefined) {
      return { userId: member.userId, name: member.name, email: member.email, role: member.role };
    }
    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message: [
        `${named} names no member of the workspace by account id or email. Its members:`,
        ...columns(members.map((one) => [one.userId, one.role, `${one.name} <${one.email}>`])).map(
          (line) => `  ${line}`,
        ),
      ].join("\n"),
    });
  });

/** The members as a write answers them, printed as `members` prints them. */
function membersAnswer(
  members: readonly {
    readonly userId: string;
    readonly name: string;
    readonly email: string;
    readonly role: string;
  }[],
  said: string,
) {
  const listed = members.map(({ userId, name, email, role }) => ({ userId, name, email, role }));
  return answer({
    json: { members: listed },
    lines: [
      said,
      ...columns(listed.map((one) => [one.userId, one.role, `${one.name} <${one.email}>`])),
    ],
    ids: listed.map(({ userId }) => userId),
  });
}

/** Invitations as `invitations` and `uninvite` print them. */
function invitationsAnswer(invitations: readonly WorkspaceInvitation[], said?: string) {
  return answer({
    json: { invitations },
    lines: [
      ...(said === undefined ? [] : [said]),
      ...(invitations.length === 0
        ? ["No pending invitations."]
        : columns(
            invitations.map((one) => [one.id, one.role, one.email, `expires ${one.expiresAt}`]),
          )),
    ],
    ids: invitations.map(({ id }) => id),
  });
}

export const workspaceMembersCommand = Command.make("members", {}, () =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;
    const read = yield* askService(hosted.workspaces.members, { workspaceId: workspace.id });
    const members = read.members.map(({ userId, name, email, role }) => ({
      userId,
      name,
      email,
      role,
    }));
    const former = (read.former ?? []).map(({ userId, name }) => ({ userId, name }));
    yield* answer({
      json: { members, former },
      lines: [
        ...columns(members.map((one) => [one.userId, one.role, `${one.name} <${one.email}>`])),
        ...(former.length === 0
          ? []
          : ["", "Left:", ...columns(former.map((one) => [one.userId, one.name]))]),
      ],
      ids: members.map(({ userId }) => userId),
    });
  }),
).pipe(
  Command.withDescription("List the workspace's members, and who left it"),
  Command.withExamples([
    { command: "vespin workspace members", description: "Who is in the workspace" },
    { command: "vespin workspace members -w acme -q", description: "Their account ids alone" },
  ]),
);

export const workspaceSlugCommand = Command.make(
  "slug",
  {
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The new slug: lowercase letters and digits, hyphens between"),
    ),
  },
  ({ slug }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const { workspace: changed } = yield* askService(
        hosted.workspaces.setSlug,
        { workspaceId: workspace.id, slug },
        HOSTED_DEADLINE.USUAL,
        SLUG_REFUSAL_WORDS,
      );
      yield* answer({
        json: { workspace: { id: changed.id, slug: changed.slug, name: changed.name } },
        lines: [`${changed.name} is now at ${changed.slug ?? slug}.`],
        ids: [changed.id],
      });
    }),
).pipe(
  Command.withDescription("Change the workspace's slug, the first step of its links (owner only)"),
  Command.withExamples([
    { command: "vespin workspace slug acme-labs", description: "Move links to /acme-labs" },
  ]),
);

export const workspaceRemoveCommand = Command.make(
  "remove",
  {
    member: memberArgument,
    yes: Flag.Boolean("yes").pipe(
      Flag.withAlias("y"),
      Flag.withDefault(false),
      Flag.withDescription("Remove without asking; required where stdin is no terminal"),
    ),
  },
  ({ member: named, yes }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const member = yield* namedMember(workspace.id, named);
      yield* confirmOrYes(
        `Remove ${member.name} <${member.email}> from ${workspace.name}? They lose it at once, and coming back takes a new invitation.`,
        yes,
        "Nobody was removed.",
      );
      const { hosted } = yield* session;
      const { members } = yield* askService(
        hosted.workspaces.removeMember,
        { workspaceId: workspace.id, userId: member.userId },
        HOSTED_DEADLINE.USUAL,
        REMOVE_REFUSAL_WORDS,
      );
      yield* membersAnswer(members, `Removed ${member.name} from ${workspace.name}.`);
    }),
).pipe(
  Command.withDescription("Remove a member from the workspace (owner, or an admin for a member)"),
  Command.withExamples([
    { command: "vespin workspace remove ada@example.com", description: "After you confirm" },
    { command: "vespin workspace remove <account-id> --yes", description: "From a script" },
  ]),
);

export const workspaceRoleCommand = Command.make(
  "role",
  {
    member: memberArgument,
    role: Argument.Literals("role", Object.values(ASSIGNABLE_ROLE)).pipe(
      Argument.withDescription("admin or member"),
    ),
  },
  ({ member: named, role }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const member = yield* namedMember(workspace.id, named);
      const { hosted } = yield* session;
      const { members } = yield* askService(
        hosted.workspaces.changeRole,
        { workspaceId: workspace.id, userId: member.userId, role },
        HOSTED_DEADLINE.USUAL,
        ROLE_REFUSAL_WORDS,
      );
      yield* membersAnswer(
        members,
        `${member.name} is now ${role === ASSIGNABLE_ROLE.ADMIN ? "an admin" : "a member"}.`,
      );
    }),
).pipe(
  Command.withDescription("Make a member an admin, or an admin a member (owner only)"),
  Command.withExamples([
    { command: "vespin workspace role ada@example.com admin", description: "Make Ada an admin" },
  ]),
);

export const workspaceInvitationsCommand = Command.make("invitations", {}, () =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;
    const { invitations } = yield* askService(
      hosted.workspaceInvitations.list,
      { workspaceId: workspace.id },
      HOSTED_DEADLINE.USUAL,
      INVITATIONS_REFUSAL_WORDS,
    );
    yield* invitationsAnswer(invitations);
  }),
).pipe(
  Command.withDescription("List the workspace's pending invitations (owners and admins)"),
  Command.withExamples([
    { command: "vespin workspace invitations", description: "Pending invitations" },
    { command: "vespin workspace invitations --json", description: "With their accept links" },
  ]),
);

export const workspaceInviteCommand = Command.make(
  "invite",
  {
    email: Argument.String("email").pipe(Argument.withDescription("The address to invite")),
    role: Flag.Literals("role", Object.values(INVITATION_ROLE)).pipe(
      Flag.withDefault(INVITATION_ROLE.MEMBER),
      Flag.withDescription("member, or admin, which only the owner may offer"),
    ),
  },
  ({ email, role }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const { invitation } = yield* askService(
        hosted.workspaceInvitations.invite,
        { workspaceId: workspace.id, email, role },
        HOSTED_DEADLINE.USUAL,
        INVITE_REFUSAL_WORDS,
      );
      yield* answer({
        json: { invitation },
        lines: [
          `Invited ${invitation.email} to ${workspace.name} as ${invitation.role}, until ${invitation.expiresAt}.`,
          `Accept link: ${invitation.acceptUrl}`,
        ],
        ids: [invitation.id],
      });
    }),
).pipe(
  Command.withDescription(
    "Invite an address to the workspace, emailed where the service sends mail",
  ),
  Command.withExamples([
    { command: "vespin workspace invite ada@example.com", description: "As a member" },
    { command: "vespin workspace invite ada@example.com --role admin", description: "As an admin" },
  ]),
);

export const workspaceUninviteCommand = Command.make(
  "uninvite",
  {
    invitation: Argument.String("invitation").pipe(
      Argument.withDescription("The invitation, by its id as invitations prints it"),
    ),
  },
  ({ invitation }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const { invitations } = yield* askService(
        hosted.workspaceInvitations.cancel,
        { workspaceId: workspace.id, invitationId: invitation },
        HOSTED_DEADLINE.USUAL,
        UNINVITE_REFUSAL_WORDS,
      );
      yield* invitationsAnswer(invitations, `Canceled invitation ${invitation}.`);
    }),
).pipe(
  Command.withDescription("Cancel a pending invitation, so its accept link stops working"),
  Command.withExamples([
    { command: "vespin workspace uninvite <invitation>", description: "Cancel one invitation" },
  ]),
);

export const workspaceRenameCommand = Command.make(
  "rename",
  {
    name: Argument.String("name").pipe(Argument.withDescription("The workspace's new name")),
  },
  ({ name }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const { workspace: renamed } = yield* askService(
        hosted.workspaces.rename,
        { workspaceId: workspace.id, name },
        HOSTED_DEADLINE.USUAL,
        RENAME_REFUSAL_WORDS,
      );
      yield* answer({
        json: { workspace: { id: renamed.id, slug: renamed.slug, name: renamed.name } },
        lines: [`${workspace.name} is now ${renamed.name}; its links are unchanged.`],
        ids: [renamed.id],
      });
    }),
).pipe(
  Command.withDescription("Rename the workspace (owners and admins; never your first workspace)"),
  Command.withExamples([
    { command: 'vespin workspace rename "Acme Labs"', description: "Rename the workspace" },
  ]),
);
