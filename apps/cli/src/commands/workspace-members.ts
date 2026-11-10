/**
 * workspace-members.ts -- `vespin workspace members` and `slug`: who is in the workspace a command acts in, and its owner's change of its slug.
 *
 * `members` reads `workspaces.members`, owners first, then admins, then
 * members, with whoever the workspace's work still names but left. `slug`
 * is one `workspaces.setSlug`, which the owner alone may make; a slug the
 * workspace stood under stays its own, so a link written under it still
 * opens it. Both act in the workspace `-w`, `VESPIN_WORKSPACE`, or the
 * default names (`../workspace.js`), and the service decides who may.
 * `namedMember` reads which member a command names, by account id or email.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import { WORKSPACE_BOUNDS } from "@repo/features/workspace-wire";
import { Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { answer, CommandFailed, columns } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

/** What a slug change's refusals say, beyond what any call's would. */
const SLUG_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]: "Only the workspace's owner may change its slug.",
  [HOSTED_API_ERROR.WORKSPACE_SLUG_MALFORMED]: `A slug is lowercase letters and digits, with single hyphens between them, at most ${WORKSPACE_BOUNDS.MAX_SLUG_CHARS} characters.`,
  [HOSTED_API_ERROR.WORKSPACE_SLUG_RESERVED]: "That slug is reserved; choose another.",
  [HOSTED_API_ERROR.WORKSPACE_SLUG_TAKEN]:
    "Another workspace holds or held that slug; choose another.",
} as const;

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
