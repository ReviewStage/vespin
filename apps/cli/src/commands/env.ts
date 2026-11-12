/**
 * env.ts -- `vespin env list`, `set`, and `delete`: the environment variables of the workspace the command acts in, which every cloud agent its members start is handed.
 *
 * Each is one `workspaceEnvironment` procedure, as Settings › Cloud environment
 * calls it: `list` reads the names to any member, and `set` and `delete`
 * write as an owner or admin, which the service holds. A value goes in
 * once, read by `set` from stdin alone (`readSecret`), never from an
 * argument a shell would keep in its history, and never comes out: every
 * answer is the names as they then stand, each with when it was last set.
 * A name is checked against the service's own rule before anything is read.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import {
  type WorkspaceEnvironmentAnswer,
  workspaceVariableNameSchema,
} from "@repo/features/workspace-environment-wire";
import { Effect, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, confirmOrYes, readSecret } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

const isVariableName = Schema.is(workspaceVariableNameSchema);

/** The words a write refused for want of a role says, naming who may make it. */
const NOT_PERMITTED_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Only the workspace's owners and admins set and delete its environment variables.",
} as const;

/** The variable a `NAME` argument names, checked as the service checks one, or a usage failure saying how one is spelled. */
const variableName = (name: string) =>
  isVariableName(name)
    ? Effect.succeed(name)
    : Effect.fail(
        new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: `${name} is no variable name: a letter or underscore, then letters, digits, and underscores.`,
        }),
      );

const NAME_ARGUMENT = Argument.String("name").pipe(
  Argument.withDescription("The variable's name, such as DATABASE_URL"),
);

/** The workspace's names as an answer prints them, with a line a person reads first. */
function namesAnswer(
  workspaceId: string,
  found: WorkspaceEnvironmentAnswer,
  said: readonly string[],
) {
  const variables = found.variables.map(({ name, updatedAt }) => ({ name, updatedAt }));

  return answer({
    json: { workspaceId, variables },
    lines: [
      ...said,
      ...(variables.length === 0
        ? ["No environment variables."]
        : columns(
            variables.map(({ name, updatedAt }) => [name, new Date(updatedAt).toISOString()]),
          )),
    ],
    ids: variables.map(({ name }) => name),
  });
}

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;

    const found = yield* askService(hosted.workspaceEnvironment.list, {
      workspaceId: workspace.id,
    });

    yield* namesAnswer(workspace.id, found, []);
  }),
).pipe(
  Command.withDescription(
    "List the workspace's environment variables by name, with when each was last set; never a value",
  ),
  Command.withExamples([{ command: "vespin env list", description: "The variables' names" }]),
);

const setCommand = Command.make("set", { name: NAME_ARGUMENT }, ({ name }) =>
  Effect.gen(function* () {
    const checked = yield* variableName(name);
    const { workspace } = yield* resolveWorkspace;
    const value = yield* readSecret(`Value of ${checked} (not shown):`);
    const { hosted } = yield* session;

    const found = yield* askService(
      hosted.workspaceEnvironment.put,
      { workspaceId: workspace.id, name: checked, value },
      HOSTED_DEADLINE.USUAL,
      NOT_PERMITTED_WORDS,
    );

    yield* namesAnswer(workspace.id, found, [`Set ${checked}.`]);
  }),
).pipe(
  Command.withDescription(
    "Set a variable every cloud agent in the workspace is handed, its value read from stdin and never shown again",
  ),
  Command.withExamples([
    { command: "vespin env set DATABASE_URL", description: "Type the value; it is not echoed" },
    {
      command: "vespin env set DATABASE_URL < url.txt",
      description: "Read it from a file, one trailing newline dropped",
    },
    {
      command: 'printf %s "$TOKEN" | vespin env set NPM_TOKEN',
      description: "Pipe it from a script",
    },
  ]),
);

const deleteCommand = Command.make(
  "delete",
  {
    name: NAME_ARGUMENT,
    yes: Flag.Boolean("yes").pipe(
      Flag.withAlias("y"),
      Flag.withDefault(false),
      Flag.withDescription("Delete without asking; required where stdin is no terminal"),
    ),
  },
  ({ name, yes }) =>
    Effect.gen(function* () {
      const checked = yield* variableName(name);
      const { workspace } = yield* resolveWorkspace;
      yield* confirmOrYes(
        `Delete ${checked} from ${workspace.name}? Its value is gone for good.`,
        yes,
      );
      const { hosted } = yield* session;

      const found = yield* askService(
        hosted.workspaceEnvironment.delete,
        { workspaceId: workspace.id, name: checked },
        HOSTED_DEADLINE.USUAL,
        NOT_PERMITTED_WORDS,
      );

      yield* namesAnswer(workspace.id, found, [`Deleted ${checked}.`]);
    }),
).pipe(
  Command.withDescription("Delete a variable; cloud agents started from then on are not handed it"),
  Command.withExamples([
    { command: "vespin env delete DATABASE_URL", description: "Delete it, after you confirm" },
    { command: "vespin env delete DATABASE_URL --yes", description: "The same, from a script" },
  ]),
);

/** The env group: list, set, and delete. */
export const envCommand = Command.make("env").pipe(
  Command.withDescription("List, set, and delete the workspace's environment variables"),
  Command.withSubcommands([listCommand, setCommand, deleteCommand]),
  Command.withExamples([{ command: "vespin env list", description: "The variables' names" }]),
);
