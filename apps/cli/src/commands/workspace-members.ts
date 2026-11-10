/**
 * workspace-members.ts -- `vespin workspace members` and `slug`: who is in the workspace a command acts in, and its owner's change of its slug.
 *
 * `members` reads `workspaces.members`, owners first, then admins, then
 * members, with whoever the workspace's work still names but left. `slug`
 * is one `workspaces.setSlug`, which the owner alone may make; a slug the
 * workspace stood under stays its own, so a link written under it still
 * opens it. Both act in the workspace `-w`, `VESPIN_WORKSPACE`, or the
 * default names (`../workspace.js`), and the service decides who may.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import { WORKSPACE_BOUNDS } from "@repo/features/workspace-wire";
import { Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { answer, columns } from "../output.js";
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
