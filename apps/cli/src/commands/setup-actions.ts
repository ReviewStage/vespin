/**
 * setup-actions.ts -- `vespin setup actions`, `add`, `edit`, and `remove`: a repository's run actions, the commands a member runs in one of its cloud agents' sandboxes from the Run menu, listed and edited one at a time.
 *
 * The list is read through `workspaceSandboxSetup.read`, and each change
 * is one `workspaceSandboxSetup.editRunAction`, which reads the list as it
 * stands and writes it back under the repository's lock, so an edit here
 * never undoes one made meanwhile in Settings or by an agent. Who may edit,
 * how many actions a repository keeps, and what a label, a command, or an
 * icon may be are the service's to say. An edit or a remove names its
 * repository with `--repo`, or is read from the one whose list holds the
 * action.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import {
  TASK_SECTION_ICON_COLOR,
  TASK_SECTION_ICON_KIND,
  type TaskSectionIcon,
  type TaskSectionIconColor,
} from "@repo/features/task-section-wire";
import type {
  RepositoryRunActions,
  RunAction,
  WorkspaceRunActionEdit,
  WorkspaceSandboxSetupAnswer,
} from "@repo/features/workspace-sandbox-setup-wire";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

const repoFlag = Flag.String("repo").pipe(
  Flag.optional,
  Flag.withDescription("The repository, as owner/name, in any casing"),
);

const actionArgument = Argument.String("action").pipe(
  Argument.withDescription("The action's id, as `vespin setup actions` lists it"),
);

/** The flags an add and an edit name the action's look and place by. */
const actionFlags = {
  label: Flag.String("label").pipe(
    Flag.optional,
    Flag.withDescription("What the Run menu and the action's Terminal tab call it"),
  ),
  command: Flag.String("command").pipe(
    Flag.optional,
    Flag.withDescription("The bash it runs from the checkout, such as 'pnpm dev'"),
  ),
  emoji: Flag.String("emoji").pipe(Flag.optional, Flag.withDescription("One emoji for its icon")),
  glyph: Flag.String("glyph").pipe(
    Flag.optional,
    Flag.withDescription("A Lucide icon for its icon, by its kebab-case name, such as rocket"),
  ),
  color: Flag.Literals("color", Object.values(TASK_SECTION_ICON_COLOR)).pipe(
    Flag.optional,
    Flag.withDescription("With --glyph, the color it wears"),
  ),
  position: Flag.Int("position").pipe(
    Flag.optional,
    Flag.withDescription("Its place in the list, from 0; past the end is the last"),
  ),
};

/** A usage refusal, which names what to type instead. */
const usage = (message: string) =>
  Effect.fail(new CommandFailed({ exit: CLI_EXIT.USAGE, message }));

/** The icon the flags name: one emoji, or one glyph in a color or none; none where neither is named. */
const iconOf = Effect.fnUntraced(function* (
  emoji: Option.Option<string>,
  glyph: Option.Option<string>,
  color: Option.Option<TaskSectionIconColor>,
) {
  if (Option.isSome(emoji) && Option.isSome(glyph)) {
    return yield* usage("Name --emoji or --glyph, not both.");
  }

  if (Option.isSome(color) && Option.isNone(glyph)) {
    return yield* usage("Name --color with --glyph.");
  }

  if (Option.isSome(emoji)) {
    return Option.some<TaskSectionIcon>({ kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: emoji.value });
  }

  if (Option.isNone(glyph)) return Option.none<TaskSectionIcon>();

  return Option.some<TaskSectionIcon>({
    kind: TASK_SECTION_ICON_KIND.GLYPH,
    glyph: glyph.value,
    ...(Option.isSome(color) && { color: color.value }),
  });
});

/** One action as a person reads it: its id, its label with its emoji and whether it is the default the Run button runs, and its command. */
function actionRow(action: RunAction, runByDefault: boolean): string[] {
  const emoji = action.icon?.kind === TASK_SECTION_ICON_KIND.EMOJI ? `${action.icon.emoji} ` : "";
  const label = `${emoji}${action.label}${runByDefault ? " (default)" : ""}`;

  return [action.id, label, action.command];
}

/** The action the Run button runs: the one named the default, or the first where none is. */
function defaultOf(list: RepositoryRunActions): RunAction | undefined {
  return list.actions.find((action) => action.isDefault === true) ?? list.actions[0];
}

/** Each repository's run actions, as a person reads them. */
export function runActionsLines(lists: readonly RepositoryRunActions[]): string[] {
  if (lists.length === 0) return ["No run actions."];

  return lists.flatMap((list, index) => {
    const runByDefault = defaultOf(list);

    return [
      ...(index === 0 ? [] : [""]),
      `${list.repository} run actions:`,
      ...columns(list.actions.map((action) => actionRow(action, action === runByDefault))),
    ];
  });
}

/** The repository's list in a setup, named in any casing; none where it has no actions. */
function listOf(
  setup: WorkspaceSandboxSetupAnswer,
  repository: string,
): RepositoryRunActions | undefined {
  const lowered = repository.trim().toLowerCase();

  return (setup.runActions ?? []).find((list) => list.repository.toLowerCase() === lowered);
}

/** The repository an edit names: the one `--repo` names, or the one whose list holds the action. */
const repositoryOf = Effect.fnUntraced(function* (
  workspaceId: string,
  repo: Option.Option<string>,
  actionId: string,
) {
  if (Option.isSome(repo)) return repo.value;
  const { hosted } = yield* session;
  const setup = yield* askService(hosted.workspaceSandboxSetup.read, { workspaceId });

  const holding = (setup.runActions ?? []).find((list) =>
    list.actions.some((action) => action.id === actionId),
  );

  if (holding === undefined) {
    return yield* usage(
      `No repository has a run action ${actionId}; vespin setup actions lists them.`,
    );
  }

  return holding.repository;
});

/** One edit sent, answered with the repository's list as it then stands and the sentence that says what changed; `-q` prints the id of the action added or changed, and nothing for a remove. */
const sentEdit = Effect.fnUntraced(function* (
  edit: Omit<WorkspaceRunActionEdit, "workspaceId">,
  said: string,
) {
  const { workspace } = yield* resolveWorkspace;
  const { hosted } = yield* session;

  const setup = yield* askService(hosted.workspaceSandboxSetup.editRunAction, {
    ...edit,
    workspaceId: workspace.id,
  });

  const list = listOf(setup, edit.repository);
  yield* answer({
    json: setup,
    lines: [said, "", ...runActionsLines(list === undefined ? [] : [list])],
    ids: setup.actionId === undefined ? [] : [setup.actionId],
  });
});

const listCommand = Command.make("actions", { repo: repoFlag }, ({ repo }) =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;

    const setup = yield* askService(hosted.workspaceSandboxSetup.read, {
      workspaceId: workspace.id,
    });

    const all = setup.runActions ?? [];

    const lists = Option.match(repo, {
      onNone: () => all,
      onSome: (named) => {
        const list = listOf(setup, named);

        return list === undefined ? [] : [list];
      },
    });

    yield* answer({
      json: { runActions: lists },
      lines: runActionsLines(lists),
      ids: lists.flatMap((list) => list.actions.map((action) => action.id)),
    });
  }),
);

const addCommand = Command.make(
  "add",
  {
    repo: repoFlag,
    ...actionFlags,
    isDefault: Flag.Boolean("default").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Make it the default, which the Run button runs"),
    ),
  },
  ({ repo, label, command, emoji, glyph, color, position, isDefault }) =>
    Effect.gen(function* () {
      if (Option.isNone(repo) || Option.isNone(label) || Option.isNone(command)) {
        return yield* usage("Name --repo, --label, and --command.");
      }

      const icon = yield* iconOf(emoji, glyph, color);
      yield* sentEdit(
        {
          repository: repo.value,
          label: label.value,
          command: command.value,
          ...(Option.isSome(icon) && { icon: icon.value }),
          ...(isDefault && { isDefault: true }),
          ...(Option.isSome(position) && { position: position.value }),
        },
        `Added ${label.value}.`,
      );
    }),
).pipe(
  Command.withDescription("Add a run action to a repository's list, last unless --position says"),
  Command.withExamples([
    {
      command:
        "vespin setup actions add --repo acme/app --label 'Dev server' --command 'pnpm dev' --default",
      description: "The Run button's action",
    },
    {
      command:
        "vespin setup actions add --repo acme/app --label Tests --command 'pnpm test' --emoji 🧪",
      description: "Another, with an emoji",
    },
    {
      command:
        "id=$(vespin setup actions add --repo acme/app --label Lint --command 'pnpm lint' -q)",
      description: "Keep the new action's id",
    },
  ]),
);

const editCommand = Command.make(
  "edit",
  {
    action: actionArgument,
    repo: repoFlag,
    ...actionFlags,
    clearIcon: Flag.Boolean("clear-icon").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Wear the Run menu's own icon again"),
    ),
    isDefault: Flag.Boolean("default").pipe(
      Flag.optional,
      Flag.withDescription(
        "Make it the default, which the Run button runs; --no-default makes it no longer the default",
      ),
    ),
  },
  ({ action, repo, label, command, emoji, glyph, color, position, clearIcon, isDefault }) =>
    Effect.gen(function* () {
      const icon = yield* iconOf(emoji, glyph, color);

      if (clearIcon && Option.isSome(icon)) {
        return yield* usage("Name --clear-icon or a new icon, not both.");
      }

      const changes = {
        ...(Option.isSome(label) && { label: label.value }),
        ...(Option.isSome(command) && { command: command.value }),
        ...(Option.isSome(icon) ? { icon: icon.value } : clearIcon ? { icon: null } : {}),
        ...(Option.isSome(isDefault) && { isDefault: isDefault.value }),
        ...(Option.isSome(position) && { position: position.value }),
      };

      if (Object.keys(changes).length === 0) {
        return yield* usage(
          "Name what changes: --label, --command, an icon or --clear-icon, --default or --no-default, or --position.",
        );
      }

      const { workspace } = yield* resolveWorkspace;
      const repository = yield* repositoryOf(workspace.id, repo, action);
      yield* sentEdit(
        { repository, actionId: action, ...changes },
        `Changed run action ${action}.`,
      );
    }),
).pipe(
  Command.withDescription("Change one run action in only what the flags name; its id stays"),
  Command.withExamples([
    {
      command: "vespin setup actions edit <id> --command 'pnpm dev --port 3001'",
      description: "A new command",
    },
    { command: "vespin setup actions edit <id> --default", description: "Make it the default" },
    { command: "vespin setup actions edit <id> --position 0", description: "Move it first" },
  ]),
);

const removeCommand = Command.make(
  "remove",
  { action: actionArgument, repo: repoFlag },
  ({ action, repo }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const repository = yield* repositoryOf(workspace.id, repo, action);
      yield* sentEdit(
        { repository, actionId: action, remove: true },
        `Removed run action ${action}.`,
      );
    }),
).pipe(
  Command.withDescription("Remove one run action from its repository's list"),
  Command.withExamples([{ command: "vespin setup actions remove <id>", description: "Remove it" }]),
);

/** The actions group: list, then add, edit, and remove. */
export const actionsCommand = listCommand.pipe(
  Command.withDescription(
    "List each repository's run actions, the commands a member runs in its cloud agents' sandboxes from the Run menu, and add, edit, or remove one",
  ),
  Command.withSubcommands([addCommand, editCommand, removeCommand]),
  Command.withExamples([
    { command: "vespin setup actions", description: "Every repository's run actions" },
    {
      command: "vespin setup actions --repo acme/app -q",
      description: "One repository's action ids",
    },
  ]),
);
