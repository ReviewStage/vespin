/**
 * workspace-leave.ts -- `vespin workspace leave`, `transfer <member>`, and `delete`: a member's way out of the workspace, its owner's handover to an admin, and its owner's delete.
 *
 * Each is one hosted procedure, `workspaces.leave`, `transfer`, or `delete`,
 * which decides who may (`workspace-member-operations.ts`,
 * `workspace-delete.ts`): anyone but the owner leaves; the owner hands the
 * workspace to an admin and becomes an admin; the owner deletes it with
 * every task, agent, and conversation in it; never the account's own first
 * workspace for either of the last two. None can be undone by the one who
 * made it, so each asks at a terminal first and takes `--yes` where stdin
 * is none (`confirmOrYes`), and none is a member MCP tool, by design. Each
 * acts in the workspace `-w`, `VESPIN_WORKSPACE`, or the default names
 * (`../workspace.js`); leaving or deleting the default forgets it
 * (`forgetWorkspace`), so the next command falls back to the member's only
 * workspace or asks which.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { forgetWorkspace } from "../config-store.js";
import { answer, columns, confirmOrYes, note } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";
import { namedMember } from "./workspace-members.js";

/** What each command's refusals say, beyond what any call's would. */
const LEAVE_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "The owner cannot leave the workspace: hand it to an admin first with vespin workspace transfer.",
  [HOSTED_API_ERROR.NOT_FOUND]: "You are no longer a member of that workspace, or it was deleted.",
} as const;

const TRANSFER_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Only the workspace's owner may hand it over, to one of its admins, and never your own first workspace.",
  [HOSTED_API_ERROR.NOT_FOUND]: "That account is no member of the workspace.",
} as const;

const DELETE_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Only the workspace's owner may delete it, and never your own first workspace, which goes only with your account.",
  [HOSTED_API_ERROR.NOT_FOUND]: "You are no longer a member of that workspace, or it was deleted.",
} as const;

/**
 * The default workspace forgotten once the member is out of it. Note that a
 * config file it could not write is said on stderr rather than failing the
 * command, because the leave or delete has already happened and must be
 * reported as done.
 */
const forgetDefault = (origin: string, workspace: { id: string; slug?: string | null }) =>
  Effect.catch(forgetWorkspace(origin, workspace), (failed) =>
    note(
      `${failed.message} The default workspace may still name it: choose another with vespin workspace use.`,
    ),
  );

/** The flag each command takes to go ahead without asking. */
const yesFlag = (doing: string) =>
  Flag.Boolean("yes").pipe(
    Flag.withAlias("y"),
    Flag.withDefault(false),
    Flag.withDescription(`${doing} without asking; required where stdin is no terminal`),
  );

export const workspaceLeaveCommand = Command.make("leave", { yes: yesFlag("Leave") }, ({ yes }) =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    yield* confirmOrYes(
      `Leave ${workspace.name}? You stay on its tasks as a former member, and only an invitation lets you back in.`,
      yes,
      "You stayed in the workspace.",
    );
    const { origin, hosted } = yield* session;

    const { workspaceId } = yield* askService(
      hosted.workspaces.leave,
      { workspaceId: workspace.id },
      HOSTED_DEADLINE.USUAL,
      LEAVE_REFUSAL_WORDS,
    );

    yield* forgetDefault(origin, workspace);
    yield* answer({
      json: { workspaceId },
      lines: [`You left ${workspace.name}.`],
      ids: [workspaceId],
    });
  }),
).pipe(
  Command.withDescription("Leave the workspace (anyone but its owner)"),
  Command.withExamples([
    { command: "vespin workspace leave -w acme", description: "After you confirm" },
    { command: "vespin workspace leave -w acme --yes", description: "From a script" },
  ]),
);

export const workspaceTransferCommand = Command.make(
  "transfer",
  {
    member: Argument.String("member").pipe(
      Argument.withDescription("The admin to hand it to, by account id or email"),
    ),
    yes: yesFlag("Hand it over"),
  },
  ({ member, yes }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const heir = yield* namedMember(workspace.id, member);
      yield* confirmOrYes(
        `Hand ${workspace.name} to ${heir.name} <${heir.email}>? They become its owner and you an admin; only they can hand it back.`,
        yes,
        "Nothing was handed over.",
      );
      const { hosted } = yield* session;

      const { members } = yield* askService(
        hosted.workspaces.transfer,
        { workspaceId: workspace.id, userId: heir.userId },
        HOSTED_DEADLINE.USUAL,
        TRANSFER_REFUSAL_WORDS,
      );

      const listed = members.map(({ userId, name, email, role }) => ({
        userId,
        name,
        email,
        role,
      }));

      yield* answer({
        json: { workspaceId: workspace.id, members: listed },
        lines: [
          `${heir.name} now owns ${workspace.name}, and you are an admin.`,
          ...columns(listed.map((one) => [one.userId, one.role, `${one.name} <${one.email}>`])),
        ],
        ids: listed.map(({ userId }) => userId),
      });
    }),
).pipe(
  Command.withDescription(
    "Hand the workspace to one of its admins, becoming an admin (owner only)",
  ),
  Command.withExamples([
    {
      command: "vespin workspace transfer ada@example.com",
      description: "After you confirm",
    },
    { command: "vespin workspace transfer <account-id> --yes", description: "From a script" },
  ]),
);

export const workspaceDeleteCommand = Command.make(
  "delete",
  { yes: yesFlag("Delete") },
  ({ yes }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      yield* confirmOrYes(
        `Delete ${workspace.name} (${workspace.slug ?? workspace.id})? Its agents are stopped, and every task, agent, and conversation in it is deleted for every member. This cannot be undone.`,
        yes,
      );
      const { origin, hosted } = yield* session;

      const { workspaceId } = yield* askService(
        hosted.workspaces.delete,
        { workspaceId: workspace.id },
        HOSTED_DEADLINE.USUAL,
        DELETE_REFUSAL_WORDS,
      );

      yield* forgetDefault(origin, workspace);
      yield* answer({
        json: { workspaceId },
        lines: [`Deleted ${workspace.name}.`],
        ids: [workspaceId],
      });
    }),
).pipe(
  Command.withDescription("Delete the workspace and everything in it (owner only)"),
  Command.withExamples([
    { command: "vespin workspace delete -w acme", description: "After you confirm" },
    { command: "vespin workspace delete -w acme --yes", description: "From a script" },
  ]),
);
