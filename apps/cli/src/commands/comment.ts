/**
 * comment.ts -- `vespin comment list`, `add`, `reply`, `resolve`, and `reopen`: a task's comment threads read, one started on words of its description, answered, or settled and brought back.
 *
 * Every command goes through the procedures the app's margin writes with
 * (`descriptionComments.read`, `start`, and `act`), so a comment reaches the
 * agents its thread and its `@` mentions reach, as one typed in the window
 * does. `list` reads the description's threads, or one page's with `--page`;
 * `add` finds its words in the description as saved, the one place they
 * stand (`locatedPhrase`), as the MCP server's `comment_on_description`
 * does.
 */

import { randomUUID } from "node:crypto";
import { CLI_EXIT } from "@repo/features/cli-exit";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_REFUSAL,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentActionRequest,
  type DescriptionCommentEntry,
  type DescriptionCommentRefusal,
  type DescriptionCommentThread,
  type DescriptionCommentThreadAnswer,
} from "@repo/features/description-comment-wire";
import { locatedPhrase } from "@repo/features/description-notes";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveTaskId } from "../tasks.js";

/** Which threads `list` prints: the open ones, the resolved ones, or every one. */
const LISTED = {
  OPEN: DESCRIPTION_COMMENT_STATUS.OPEN,
  RESOLVED: DESCRIPTION_COMMENT_STATUS.RESOLVED,
  ALL: "all",
} as const;

/** Why a write to a thread took nothing, in words for the person running the command. */
const REFUSAL_WORDS: Record<DescriptionCommentRefusal, string> = {
  [DESCRIPTION_COMMENT_REFUSAL.TOO_MANY]:
    "The description holds as many threads as it may, or the thread as many comments.",
  [DESCRIPTION_COMMENT_REFUSAL.NO_WORDS]: "Those words no longer stand in the description.",
  [DESCRIPTION_COMMENT_REFUSAL.NOT_YOURS]: "Only its writer may change that comment.",
  [DESCRIPTION_COMMENT_REFUSAL.NO_ENTRY]: "The thread holds no such comment.",
  [DESCRIPTION_COMMENT_REFUSAL.KEY_TAKEN]: "The write was already taken on another thread.",
  [DESCRIPTION_COMMENT_REFUSAL.TOO_MANY_FILES]:
    "The comment would carry more files, or more bytes of them, than one message may.",
};

const taskArgument = Argument.String("task").pipe(
  Argument.withDescription("The task, by its id, its number, or its key such as ACME-42"),
);

const threadArgument = Argument.String("thread").pipe(
  Argument.withDescription("The thread's id, as comment list prints it"),
);

const wordsFlag = Flag.String("file").pipe(
  Flag.withAlias("F"),
  Flag.withDescription("The comment, from a file or - for stdin"),
);

/** Who wrote an entry, as a line names them. */
function writerOf(entry: DescriptionCommentEntry): string {
  const { writer } = entry;

  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.AGENT)
    return `Agent ${writer.agentId ?? ""}`.trim();

  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.APP) return PRODUCT_NAME;

  return writer.by?.name ?? "A former member";
}

/** One entry's lines: a comment's writer and words, or a line of what happened to the thread. */
function entryLines(entry: DescriptionCommentEntry): readonly string[] {
  const writer = writerOf(entry);

  switch (entry.kind) {
    case DESCRIPTION_COMMENT_ENTRY.COMMENT:
      return [
        `  ${writer}:`,
        ...(entry.words ?? "").split("\n").map((line) => `    ${line}`),
        ...(entry.files ?? []).map((file) => `    [file] ${file.name}`),
      ];
    case DESCRIPTION_COMMENT_ENTRY.ASKED:
      return [`  ${writer} sent it to ${entry.asked?.agentId ?? PRODUCT_NAME}`];
    case DESCRIPTION_COMMENT_ENTRY.RESOLVED:
      return [`  ${writer} resolved it`];
    case DESCRIPTION_COMMENT_ENTRY.REOPENED:
      return [`  ${writer} reopened it`];
  }
}

/** Where a thread stands: the description's words, or a page's element or whole page. */
function placeOf(thread: DescriptionCommentThread): string {
  if (thread.page !== undefined) {
    const on = thread.page.element === undefined ? "the whole page" : thread.page.element;

    return `page ${thread.page.id} v${thread.page.version}, ${on}`;
  }

  const deleted = thread.anchor === undefined ? ", words since deleted" : "";

  return thread.section === "" ? `description${deleted}` : `${thread.section}${deleted}`;
}

/** A thread's lines: its id, where it stands, its quote, and its entries. */
function threadLines(thread: DescriptionCommentThread): readonly string[] {
  return [
    `${thread.id}  [${thread.status}]  ${placeOf(thread)}`,
    `  > ${thread.quote.replaceAll("\n", " ")}`,
    ...thread.entries.flatMap(entryLines),
    "",
  ];
}

/** The thread a write left, as each reader takes it, or why nothing was taken. */
const written = Effect.fnUntraced(function* (
  saved: DescriptionCommentThreadAnswer,
  line: (thread: DescriptionCommentThread) => string,
) {
  if ("refused" in saved) {
    return yield* new CommandFailed({
      exit: CLI_EXIT.REFUSED,
      message: REFUSAL_WORDS[saved.refused],
    });
  }

  if ("deleted" in saved) {
    return yield* new CommandFailed({ exit: CLI_EXIT.REFUSED, message: "The thread was deleted." });
  }

  const unsent = saved.unsent ?? [];
  yield* answer({
    json: { thread: saved.thread, unsent },
    lines: [
      line(saved.thread),
      ...(unsent.length === 0
        ? []
        : [
            `Not sent to ${unsent.map((to) => to.agentId ?? PRODUCT_NAME).join(", ")}: they could not take it.`,
          ]),
    ],
    ids: [saved.thread.id],
  });
});

/** One thing done to a thread of the task, answered as the thread now stands. */
const actedOn = Effect.fnUntraced(function* (
  task: string,
  thread: string,
  body: DescriptionCommentActionRequest,
  line: (thread: DescriptionCommentThread) => string,
) {
  const id = yield* resolveTaskId(task);
  const { hosted } = yield* session;

  const saved = yield* askService(hosted.descriptionComments.act, {
    params: { id, thread },
    body,
  });

  yield* written(saved, line);
});

const listCommand = Command.make(
  "list",
  {
    task: taskArgument,
    page: Flag.String("page").pipe(
      Flag.optional,
      Flag.withDescription("One of the task's pages, by its id, to read its threads instead"),
    ),
    status: Flag.Literals("status", Object.values(LISTED)).pipe(
      Flag.withDefault(LISTED.OPEN),
      Flag.withDescription("Which threads: open (default), resolved, or all"),
    ),
  },
  ({ task, page, status }) =>
    Effect.gen(function* () {
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;

      const read = yield* askService(hosted.descriptionComments.read, {
        id,
        ...(Option.isSome(page) ? { page: page.value } : undefined),
      });

      const threads = read.threads.filter(
        (thread) => status === LISTED.ALL || thread.status === status,
      );

      yield* answer({
        json: { threads },
        lines: threads.length === 0 ? ["No threads."] : threads.flatMap(threadLines),
        ids: threads.map((thread) => thread.id),
      });
    }),
).pipe(
  Command.withDescription("Print a task's comment threads, on its description or one of its pages"),
  Command.withExamples([
    { command: "vespin comment list ACME-42", description: "The open threads on the description" },
    {
      command: "vespin comment list ACME-42 --page <page-id> --status all",
      description: "Every thread on a page",
    },
  ]),
);

const addCommand = Command.make(
  "add",
  {
    task: taskArgument,
    on: Flag.String("on").pipe(
      Flag.withDescription(
        "The words of the description the thread stands on, copied exactly, as much as stands there once",
      ),
    ),
    file: wordsFlag,
  },
  ({ task, on, file }) =>
    Effect.gen(function* () {
      const words = yield* readInput(file);
      const id = yield* resolveTaskId(task);
      const { hosted } = yield* session;
      const { plan } = yield* askService(hosted.plans.open, { id });
      const text = plan.document.body;
      const anchor = locatedPhrase(text, on);

      if (anchor === undefined) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.REFUSED,
          message:
            "The description does not hold those words exactly once; copy them, or more of them, from vespin description show.",
        });
      }

      const started = yield* askService(hosted.descriptionComments.start, {
        params: { id },
        body: {
          clientKey: randomUUID(),
          scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
          quote: text.slice(anchor.from, anchor.to),
          anchor,
          text,
          words,
        },
      });

      yield* written(started.body, (thread) => `Started thread ${thread.id}.`);
    }),
).pipe(
  Command.withDescription("Start a comment thread on words of a task's description"),
  Command.withExamples([
    {
      command: 'echo "Is this still true?" | vespin comment add ACME-42 --on "Ships Friday" -F -',
      description: "Comment on words of the description",
    },
  ]),
);

const replyCommand = Command.make(
  "reply",
  { task: taskArgument, thread: threadArgument, file: wordsFlag },
  ({ task, thread, file }) =>
    Effect.gen(function* () {
      const words = yield* readInput(file);
      yield* actedOn(
        task,
        thread,
        { action: DESCRIPTION_COMMENT_ACTION.REPLY, clientKey: randomUUID(), words },
        (saved) => `Replied on thread ${saved.id}.`,
      );
    }),
).pipe(
  Command.withDescription("Reply in a comment thread; every agent in it is sent the reply"),
  Command.withExamples([
    {
      command: 'echo "Done, take another look" | vespin comment reply ACME-42 <thread> -F -',
      description: "Reply from stdin",
    },
  ]),
);

const resolveCommand = Command.make(
  "resolve",
  { task: taskArgument, thread: threadArgument },
  ({ task, thread }) =>
    actedOn(
      task,
      thread,
      { action: DESCRIPTION_COMMENT_ACTION.RESOLVE },
      (saved) => `Resolved thread ${saved.id}.`,
    ),
).pipe(
  Command.withDescription("Resolve a comment thread once what it asked is settled"),
  Command.withExamples([
    { command: "vespin comment resolve ACME-42 <thread>", description: "Resolve a thread" },
  ]),
);

const reopenCommand = Command.make(
  "reopen",
  { task: taskArgument, thread: threadArgument },
  ({ task, thread }) =>
    actedOn(
      task,
      thread,
      { action: DESCRIPTION_COMMENT_ACTION.REOPEN },
      (saved) => `Reopened thread ${saved.id}.`,
    ),
).pipe(
  Command.withDescription("Reopen a resolved comment thread"),
  Command.withExamples([
    { command: "vespin comment reopen ACME-42 <thread>", description: "Reopen a thread" },
  ]),
);

/** The comment group: list, add, reply, resolve, and reopen. */
export const commentCommand = Command.make("comment").pipe(
  Command.withDescription("Read, start, answer, and resolve comment threads on a task"),
  Command.withSubcommands([listCommand, addCommand, replyCommand, resolveCommand, reopenCommand]),
  Command.withExamples([
    { command: "vespin comment list ACME-42", description: "The open threads on the description" },
  ]),
);
