/**
 * setup.ts -- `vespin setup show`, `edit`, and `actions` (`setup-actions.ts`): the workspace's cloud sandbox setup, its install script, each repository's setup and archive scripts, and each repository's run actions, as Settings › Cloud environment reads and saves them.
 *
 * `show` reads the setup through `workspaceSandboxSetup.read` for the
 * workspace the command acts in; `--repo` narrows it to one repository's
 * setup script, named in any casing, or its archive script with `--kind
 * archive`. `edit` replaces the install script whole through
 * `workspaceSandboxSetup.putInstall`, or with `--repo` that repository's
 * setup or archive script through `putRepository`, from `-F <file|->`; an
 * empty script removes it. Who may save, and what a repository's name may
 * be, are the service's to say.
 */

import {
  REPOSITORY_SCRIPT_KIND,
  type RepositoryScriptKind,
  type WorkspaceSandboxSetupAnswer,
} from "@repo/features/workspace-sandbox-setup-wire";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { answer, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";
import { actionsCommand, runActionsLines } from "./setup-actions.js";

const repoFlag = Flag.String("repo").pipe(
  Flag.optional,
  Flag.withDescription(
    "A repository's setup script, as owner/name, rather than the install script",
  ),
);

const kindFlag = Flag.Literals("kind", Object.values(REPOSITORY_SCRIPT_KIND)).pipe(
  Flag.withDefault(REPOSITORY_SCRIPT_KIND.SETUP),
  Flag.withDescription(
    "With --repo, which of its scripts: setup, run in each new sandbox after its checkout, or archive, run just before one is deleted",
  ),
);

/** A script kind as a person reads it. */
const KIND_WORDS = {
  [REPOSITORY_SCRIPT_KIND.SETUP]: "setup script",
  [REPOSITORY_SCRIPT_KIND.ARCHIVE]: "archive script",
} as const satisfies Record<RepositoryScriptKind, string>;

/** A setup's scripts of the kind, each repository's. */
function scriptsOfKind(setup: WorkspaceSandboxSetupAnswer, kind: RepositoryScriptKind) {
  return kind === REPOSITORY_SCRIPT_KIND.ARCHIVE ? setup.archives : setup.setups;
}

/** When a script was last saved, as a person reads it. */
function savedWords(updatedAt: number): string {
  return `saved ${new Date(updatedAt).toISOString()}`;
}

/** One repository's script of the kind, as `show --repo` prints it: none where no script is saved under that name in any casing, the name read as the service reads it, trimmed. */
function repositoryScriptJson(
  setup: WorkspaceSandboxSetupAnswer,
  named: string,
  kind: RepositoryScriptKind,
) {
  const repository = named.trim();
  const lowered = repository.toLowerCase();
  const found = scriptsOfKind(setup, kind).find((one) => one.repository.toLowerCase() === lowered);
  return found ?? { repository, script: null, updatedAt: null };
}

/** Each repository's scripts of the kind, as a person reads them. */
function scriptLines(setup: WorkspaceSandboxSetupAnswer, kind: RepositoryScriptKind): string[] {
  const scripts = scriptsOfKind(setup, kind);
  if (scripts.length === 0) return [`No repository ${KIND_WORDS[kind]}s.`];
  return scripts.flatMap((one) => [
    "",
    `${one.repository} ${KIND_WORDS[kind]} (${savedWords(one.updatedAt)}):`,
    one.script,
  ]);
}

/** The whole setup, as a person reads it: the install script, then each repository's scripts and run actions. */
function setupLines(setup: WorkspaceSandboxSetupAnswer): string[] {
  const install =
    setup.install === null
      ? ["No install script."]
      : [`Install script (${savedWords(setup.install.updatedAt)}):`, setup.install.script];
  return [
    ...install,
    "",
    ...scriptLines(setup, REPOSITORY_SCRIPT_KIND.SETUP),
    "",
    ...scriptLines(setup, REPOSITORY_SCRIPT_KIND.ARCHIVE),
    "",
    ...runActionsLines(setup.runActions ?? []),
  ];
}

const showCommand = Command.make("show", { repo: repoFlag, kind: kindFlag }, ({ repo, kind }) =>
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
    const found = repositoryScriptJson(setup, repo.value, kind);
    yield* answer({
      json: found,
      lines:
        found.script === null
          ? [`No ${KIND_WORDS[kind]} for ${found.repository}.`]
          : [found.script],
    });
  }),
).pipe(
  Command.withDescription(
    "Print the workspace's cloud sandbox install script, each repository's setup and archive scripts, and its run actions",
  ),
  Command.withExamples([
    { command: "vespin setup show", description: "The whole setup" },
    {
      command: "vespin setup show --repo acme/app | jq -r .script > setup.sh",
      description: "Save one repository's setup script to edit",
    },
    {
      command: "vespin setup show --repo acme/app --kind archive",
      description: "Its archive script",
    },
  ]),
);

const editCommand = Command.make(
  "edit",
  {
    repo: repoFlag,
    kind: kindFlag,
    file: Flag.String("file").pipe(
      Flag.withAlias("F"),
      Flag.withDescription("The whole script, from a file or - for stdin; an empty one removes it"),
    ),
  },
  ({ repo, kind, file }) =>
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
            kind,
          });
      const which = Option.isNone(repo)
        ? "the install script"
        : `the ${KIND_WORDS[kind]} of ${repo.value}`;
      const saved = Option.isNone(repo)
        ? setup.install !== null
        : repositoryScriptJson(setup, repo.value, kind).script !== null;
      yield* answer({
        json: setup,
        lines: [`${saved ? "Saved" : "Removed"} ${which} of ${workspace.name}.`],
      });
    }),
).pipe(
  Command.withDescription(
    "Replace the workspace's install script, or a repository's setup or archive script, from a file or stdin",
  ),
  Command.withExamples([
    { command: "vespin setup edit -F install.sh", description: "Save the install script" },
    {
      command: "vespin setup edit --repo acme/app -F setup.sh",
      description: "Save a repository's setup script",
    },
    {
      command: "vespin setup edit --repo acme/app --kind archive -F archive.sh",
      description: "Save its archive script",
    },
    {
      command: "vespin setup edit --repo acme/app -F /dev/null",
      description: "Remove it",
    },
  ]),
);

/** The setup group: show, edit, and actions. */
export const setupCommand = Command.make("setup").pipe(
  Command.withDescription(
    "Print or write the workspace's cloud sandbox setup: its install script, each repository's setup and archive scripts, and its run actions",
  ),
  Command.withSubcommands([showCommand, editCommand, actionsCommand]),
  Command.withExamples([{ command: "vespin setup show", description: "The whole setup" }]),
);
