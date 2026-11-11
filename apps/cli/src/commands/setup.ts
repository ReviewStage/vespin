/**
 * setup.ts -- `vespin setup show` and `edit`: the workspace's cloud sandbox setup, its install script and each repository's setup script, as Settings › Cloud environment reads and saves them.
 *
 * `show` reads the setup through `workspaceSandboxSetup.read` for the
 * workspace the command acts in; `--repo` narrows it to one repository's
 * setup script, named in any casing. `edit` replaces the install script
 * whole through `workspaceSandboxSetup.putInstall`, or with `--repo` that
 * repository's setup script through `putRepository`, from `-F <file|->`;
 * an empty script removes it. Who may save, and what a repository's name
 * may be, are the service's to say.
 */

import type { WorkspaceSandboxSetupAnswer } from "@repo/features/workspace-sandbox-setup-wire";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { answer, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

const repoFlag = Flag.String("repo").pipe(
  Flag.optional,
  Flag.withDescription(
    "A repository's setup script, as owner/name, rather than the install script",
  ),
);

/** When a script was last saved, as a person reads it. */
function savedWords(updatedAt: number): string {
  return `saved ${new Date(updatedAt).toISOString()}`;
}

/** One repository's setup script, as `show --repo` prints it: none where no script is saved under that name in any casing, the name read as the service reads it, trimmed. */
function repositorySetupJson(setup: WorkspaceSandboxSetupAnswer, named: string) {
  const repository = named.trim();
  const lowered = repository.toLowerCase();
  const found = setup.setups.find((one) => one.repository.toLowerCase() === lowered);
  return found ?? { repository, script: null, updatedAt: null };
}

/** The whole setup, as a person reads it: the install script, then each repository's. */
function setupLines(setup: WorkspaceSandboxSetupAnswer): string[] {
  const install =
    setup.install === null
      ? ["No install script."]
      : [`Install script (${savedWords(setup.install.updatedAt)}):`, setup.install.script];
  const setups =
    setup.setups.length === 0
      ? ["No repository setup scripts."]
      : setup.setups.flatMap((one) => [
          "",
          `${one.repository} setup script (${savedWords(one.updatedAt)}):`,
          one.script,
        ]);
  return [...install, "", ...setups];
}

const showCommand = Command.make("show", { repo: repoFlag }, ({ repo }) =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;
    const setup = yield* askService(hosted.workspaceSandboxSetup.read, {
      workspaceId: workspace.id,
    });
    if (Option.isNone(repo)) {
      yield* answer({ json: setup, lines: setupLines(setup) });
      return;
    }
    const found = repositorySetupJson(setup, repo.value);
    yield* answer({
      json: found,
      lines: found.script === null ? [`No setup script for ${found.repository}.`] : [found.script],
    });
  }),
).pipe(
  Command.withDescription(
    "Print the workspace's cloud sandbox install script and each repository's setup script",
  ),
  Command.withExamples([
    { command: "vespin setup show", description: "The whole setup" },
    {
      command: "vespin setup show --repo acme/app | jq -r .script > setup.sh",
      description: "Save one repository's setup script to edit",
    },
  ]),
);

const editCommand = Command.make(
  "edit",
  {
    repo: repoFlag,
    file: Flag.String("file").pipe(
      Flag.withAlias("F"),
      Flag.withDescription("The whole script, from a file or - for stdin; an empty one removes it"),
    ),
  },
  ({ repo, file }) =>
    Effect.gen(function* () {
      const script = yield* readInput(file);
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const setup = Option.isNone(repo)
        ? yield* askService(hosted.workspaceSandboxSetup.putInstall, {
            workspaceId: workspace.id,
            script,
          })
        : yield* askService(hosted.workspaceSandboxSetup.putRepository, {
            workspaceId: workspace.id,
            repository: repo.value,
            script,
          });
      const which = Option.isNone(repo)
        ? "the install script"
        : `the setup script of ${repo.value}`;
      const saved = Option.isNone(repo)
        ? setup.install !== null
        : repositorySetupJson(setup, repo.value).script !== null;
      yield* answer({
        json: setup,
        lines: [`${saved ? "Saved" : "Removed"} ${which} of ${workspace.name}.`],
      });
    }),
).pipe(
  Command.withDescription(
    "Replace the workspace's install script, or a repository's setup script, from a file or stdin",
  ),
  Command.withExamples([
    { command: "vespin setup edit -F install.sh", description: "Save the install script" },
    {
      command: "vespin setup edit --repo acme/app -F setup.sh",
      description: "Save a repository's setup script",
    },
    {
      command: "vespin setup edit --repo acme/app -F /dev/null",
      description: "Remove it",
    },
  ]),
);

/** The setup group: show and edit. */
export const setupCommand = Command.make("setup").pipe(
  Command.withDescription(
    "Print or write the workspace's cloud sandbox setup: its install script and each repository's setup script",
  ),
  Command.withSubcommands([showCommand, editCommand]),
  Command.withExamples([{ command: "vespin setup show", description: "The whole setup" }]),
);
