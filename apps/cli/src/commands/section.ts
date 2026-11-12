/**
 * section.ts -- `vespin section list`, `create`, and `delete`: the sections the signed-in member keeps in a workspace's sidebar, each with the tasks in it.
 *
 * A section is the member's own, in one workspace, as the sidebar's is
 * (`@repo/features/task-section-wire`): `list` reads them through
 * `taskSections.list` for the workspace the command acts in, and `create`
 * and `delete` are one `taskSections.write` each. A section is named by its
 * id or its title (`resolveSection`), which `vespin task update --section`
 * reads the same way to move a task in.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import {
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSections,
} from "@repo/features/task-section-wire";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

/** A section as every answer prints it: its id, title, emoji, and the ids of the tasks in it. */
function sectionJson(section: TaskSection, sections: TaskSections) {
  const icon = section.icon;

  return {
    id: section.id,
    workspaceId: section.workspaceId,
    title: section.title,
    emoji: icon?.kind === TASK_SECTION_ICON_KIND.EMOJI ? icon.emoji : null,
    taskIds: sections.entries
      .filter((entry) => entry.sectionId === section.id)
      .map((entry) => entry.taskId),
  };
}

/** The member's sections of one workspace, as the sidebar reads them. */
function sectionsOf(workspaceId: string) {
  return Effect.gen(function* () {
    const { hosted } = yield* session;
    const sections = yield* askService(hosted.taskSections.list, undefined);

    return {
      sections,
      inWorkspace: sections.sections.filter((section) => section.workspaceId === workspaceId),
    };
  });
}

/** The member's section of a workspace an argument names, by its id or its title in any case, with all their sections as they stand, or a usage failure where it names none, or several. */
export function resolveSection(workspaceId: string, named: string) {
  return Effect.gen(function* () {
    const { sections, inWorkspace } = yield* sectionsOf(workspaceId);
    const lowered = named.toLowerCase();

    const matches = inWorkspace.filter(
      (section) => section.id === named || section.title.toLowerCase() === lowered,
    );

    const [only, ...others] = matches;

    if (only !== undefined && others.length === 0) return { section: only, sections };

    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message: [
        only === undefined
          ? `${named} is none of your sections in this workspace.`
          : `${named} names several of your sections; name one by id.`,
        ...(inWorkspace.length === 0
          ? ["You keep no sections here; make one with vespin section create."]
          : [
              "Your sections:",
              ...inWorkspace.map((section) => `  ${section.id}  ${section.title}`),
            ]),
      ].join("\n"),
    });
  });
}

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { sections, inWorkspace } = yield* sectionsOf(workspace.id);
    const found = inWorkspace.map((section) => sectionJson(section, sections));
    yield* answer({
      json: { sections: found },
      lines:
        found.length === 0
          ? ["No sections."]
          : columns(
              found.map((section) => [
                section.id,
                `${section.taskIds.length} tasks`,
                `${section.emoji === null ? "" : `${section.emoji} `}${section.title}`,
              ]),
            ),
      ids: found.map(({ id }) => id),
    });
  }),
).pipe(
  Command.withDescription("List your sidebar sections in the workspace, with the tasks in each"),
  Command.withExamples([{ command: "vespin section list", description: "Your sections" }]),
);

const createCommand = Command.make(
  "create",
  {
    title: Argument.String("title").pipe(Argument.withDescription("The section's title")),
    emoji: Flag.String("emoji").pipe(
      Flag.optional,
      Flag.withDescription("One emoji to draw beside its title"),
    ),
  },
  ({ title, emoji }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const id = crypto.randomUUID();

      const written = yield* askService(hosted.taskSections.write, {
        kind: TASK_SECTION_WRITE.CREATE,
        id,
        workspaceId: workspace.id,
        title,
        ...(Option.isSome(emoji)
          ? { icon: { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: emoji.value } }
          : undefined),
      });

      const made = written.sections.find((section) => section.id === id);

      if (made === undefined) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.UNAVAILABLE,
          message: "The service did not answer with the section it made.",
        });
      }

      const found = sectionJson(made, written);
      yield* answer({
        json: found,
        lines: [`Created section ${found.title} (${found.id}).`],
        ids: [found.id],
      });
    }),
).pipe(
  Command.withDescription("Make a section in your sidebar of the workspace, to keep tasks in"),
  Command.withExamples([
    { command: 'vespin section create "This week" --emoji 🔥', description: "A new section" },
    {
      command: 'vespin task update ACME-42 --section "This week"',
      description: "Then move a task into it",
    },
  ]),
);

const deleteCommand = Command.make(
  "delete",
  {
    section: Argument.String("section").pipe(
      Argument.withDescription("The section, by its id or its title"),
    ),
  },
  ({ section }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const named = yield* resolveSection(workspace.id, section);
      const { hosted } = yield* session;
      yield* askService(hosted.taskSections.write, {
        kind: TASK_SECTION_WRITE.DELETE,
        id: named.section.id,
      });
      const found = sectionJson(named.section, named.sections);
      yield* answer({
        json: found,
        lines: [
          `Deleted section ${found.title}; its tasks went back under Tasks, and none was deleted.`,
        ],
        ids: [found.id],
      });
    }),
).pipe(
  Command.withDescription("Delete one of your sections; its tasks go back under Tasks"),
  Command.withExamples([
    { command: 'vespin section delete "This week"', description: "Delete a section by title" },
  ]),
);

/** The section group: list, create, and delete. */
export const sectionCommand = Command.make("section").pipe(
  Command.withDescription("List, make, and delete your sidebar sections"),
  Command.withSubcommands([listCommand, createCommand, deleteCommand]),
  Command.withExamples([
    { command: "vespin section list", description: "Your sections in the workspace" },
  ]),
);
