/**
 * description.ts -- `vespin description show` and `description edit`: a task's description printed as the Markdown it is, and written whole from a file or stdin.
 *
 * A description is one Markdown text (`description-edit.ts`). `edit` writes it
 * through the procedure the app's description editor saves with,
 * `plans.editDescription`, naming the text it read just before as the base, so a write
 * an agent made in between is kept where the two do not touch the same
 * lines, and is refused as a conflict where they do, with nothing changed.
 * `history`, `show --revision`, and `restore` ask the procedures the app's
 * History tab asks (`plans.descriptionRevisions`, `descriptionRevision`,
 * `restoreDescription`), so a restore is the member's own save, kept as a
 * revision naming the one it brought back.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { DESCRIPTION_EDIT_REFUSAL } from "@repo/features/description-edit";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import { type DescriptionRevisionLine, TASK_BOUNDS } from "@repo/features/task-wire";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveTaskId } from "../tasks.js";

/**
 * A task's description written whole: `value` laid over `base`, the text
 * it was read as, answered with the description as saved, or a refusal
 * saying why nothing was.
 */
export function writeDescription(taskId: string, base: string, value: string) {
  return Effect.gen(function* () {
    const { hosted } = yield* session;
    const saved = yield* askService(hosted.plans.editDescription, {
      params: { id: taskId },
      body: { document: { base, value } },
    });
    if ("plan" in saved) return saved.plan;
    return yield* new CommandFailed({
      exit: CLI_EXIT.REFUSED,
      message:
        "conflict" in saved
          ? "The description changed in the same lines while it was written, so nothing was saved. Run vespin description show, and write it again."
          : saved.refused === DESCRIPTION_EDIT_REFUSAL.TOO_LONG
            ? `The description is longer than a description may be (${TASK_BOUNDS.MAX_BODY_CHARS} characters), so nothing was saved.`
            : "The description was refused, so nothing was saved.",
    });
  });
}

const taskArgument = Argument.String("task").pipe(
  Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
);

/** What a read of a revision the description has none of answers. */
const NO_REVISION_WORDS = {
  [HOSTED_API_ERROR.NOT_FOUND]:
    "The description has no revision of that number. Run vespin description history to list them.",
};

/** A revision's number, as `history` lists it. */
const revisionWords = "The revision's number, as vespin description history lists it";

const showCommand = Command.make(
  "show",
  {
    task: taskArgument,
    revision: Flag.Int("revision").pipe(
      Flag.withAlias("r"),
      Flag.withDescription(`${revisionWords}, to print the description as it stood after it`),
      Flag.optional,
    ),
  },
  ({ task, revision }) =>
    Effect.gen(function* () {
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;
      if (Option.isSome(revision)) {
        const seq = revision.value;
        const read = yield* askService(
          hosted.plans.descriptionRevision,
          { id, seq: String(seq) },
          HOSTED_DEADLINE.USUAL,
          NO_REVISION_WORDS,
        );
        const { body } = read.revision.document;
        yield* answer({
          json: { id, revision: seq, body },
          lines: [body.replace(/\n+$/u, "")],
          ids: [id],
        });
        return;
      }
      const { plan } = yield* askService(hosted.plans.open, { id });
      yield* answer({
        json: { id: plan.id, name: plan.name, body: plan.document.body },
        // Note that the closing line break is dropped, since each line printed ends in one.
        lines: [plan.document.body.replace(/\n+$/u, "")],
        ids: [plan.id],
      });
    }),
).pipe(
  Command.withDescription("Print a task's description as Markdown, now or at one revision"),
  Command.withExamples([
    { command: "vespin description show ACME-42", description: "Print the description" },
    {
      command: "vespin description show ACME-42 | jq -r .body > description.md",
      description: "Save it to edit",
    },
    {
      command: "vespin description show ACME-42 --revision 3",
      description: "Print it as it stood after revision 3",
    },
  ]),
);

const editCommand = Command.make(
  "edit",
  {
    task: taskArgument,
    file: Flag.String("file").pipe(
      Flag.withAlias("F"),
      Flag.withDescription("The whole description, as Markdown, from a file or - for stdin"),
    ),
  },
  ({ task, file }) =>
    Effect.gen(function* () {
      const value = yield* readInput(file);
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;
      const { plan } = yield* askService(hosted.plans.open, { id });
      const saved = yield* writeDescription(id, plan.document.body, value);
      yield* answer({
        json: { id: saved.id, name: saved.name, body: saved.document.body },
        lines: [`Saved the description of ${saved.name}.`],
        ids: [saved.id],
      });
    }),
).pipe(
  Command.withDescription("Replace a task's description with Markdown from a file or stdin"),
  Command.withExamples([
    {
      command: "vespin description edit ACME-42 -F description.md",
      description: "Write the description from a file",
    },
    {
      command:
        "vespin description show ACME-42 | jq -r .body | sed 's/TODO/Done/' | vespin description edit ACME-42 -F -",
      description: "Edit it in a pipe",
    },
  ]),
);

/** Who wrote a revision, as a person reads it. */
function revisionWriter(line: DescriptionRevisionLine): string {
  const name = line.lastEdit.by?.name ?? line.lastEdit.label;
  return name === undefined ? line.lastEdit.actor : `${line.lastEdit.actor} ${name}`;
}

const historyCommand = Command.make(
  "history",
  {
    task: taskArgument,
    before: Flag.Int("before").pipe(
      Flag.withDescription("Read the older revisions before this one: the earlier a page printed"),
      Flag.optional,
    ),
  },
  ({ task, before }) =>
    Effect.gen(function* () {
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;
      const page = yield* askService(hosted.plans.descriptionRevisions, {
        id,
        ...(Option.isSome(before) ? { before: String(before.value) } : undefined),
      });
      const rows = page.revisions.map((line) => [
        String(line.seq),
        new Date(line.lastEdit.at).toISOString(),
        `${line.changes} changes`,
        line.restoredFrom === undefined
          ? revisionWriter(line)
          : `${revisionWriter(line)}, restored ${line.restoredFrom.seq}`,
      ]);
      yield* answer({
        json: { id, ...page },
        lines: [
          ...(rows.length === 0 ? ["The description has no history yet."] : columns(rows)),
          ...(page.earlier === undefined
            ? []
            : [`Older: vespin description history ${task} --before ${page.earlier}`]),
        ],
        ids: page.revisions.map((line) => String(line.seq)),
      });
    }),
).pipe(
  Command.withDescription("List a task's description history, the newest revisions first"),
  Command.withExamples([
    { command: "vespin description history ACME-42", description: "List the revisions" },
  ]),
);

const restoreCommand = Command.make(
  "restore",
  {
    task: taskArgument,
    revision: Argument.Int("revision").pipe(Argument.withDescription(revisionWords)),
  },
  ({ task, revision }) =>
    Effect.gen(function* () {
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;
      const { plan } = yield* askService(
        hosted.plans.restoreDescription,
        { id, seq: String(revision) },
        HOSTED_DEADLINE.USUAL,
        NO_REVISION_WORDS,
      );
      yield* answer({
        json: { id: plan.id, name: plan.name, restored: revision, body: plan.document.body },
        lines: [`Restored revision ${revision} of the description of ${plan.name}.`],
        ids: [plan.id],
      });
    }),
).pipe(
  Command.withDescription(
    "Put one revision back as a task's description, kept as a new revision you can undo",
  ),
  Command.withExamples([
    {
      command: "vespin description restore ACME-42 3",
      description: "Put revision 3 back",
    },
  ]),
);

/** The description group: show, edit, history, and restore. */
export const descriptionCommand = Command.make("description").pipe(
  Command.withDescription("Print, write, or restore a task's description"),
  Command.withSubcommands([showCommand, editCommand, historyCommand, restoreCommand]),
  Command.withExamples([
    { command: "vespin description show ACME-42", description: "Print the description" },
  ]),
);
