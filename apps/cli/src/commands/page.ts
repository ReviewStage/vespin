/**
 * page.ts -- `vespin page list` and `page show`: the pages agents showed on a task, and one version of one printed as its HTML.
 *
 * A page stands on a task (`taskFiles.pages` and `taskFiles.page`), which
 * each command names with `--task`. `show` reads the newest version unless
 * `--version` names one, found off the task's list.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import { PAGE_SHOWER, type PageLine, type PageVersion } from "@repo/features/page-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns } from "../output.js";
import { askService, session } from "../session.js";
import { resolveTaskId } from "../tasks.js";

const taskFlag = Flag.String("task").pipe(
  Flag.withDescription("The task the page stands on, by its id, its number, or its key"),
);

/** The task's pages, each by its newest version, the most recently written first. */
const pagesOf = Effect.fnUntraced(function* (task: string) {
  const { hosted } = yield* session;
  const id = yield* resolveTaskId(task);
  const { pages } = yield* askService(hosted.taskFiles.pages, { id });
  return pages;
});

/** One version of one of the task's pages, with its HTML. */
const versionOf = Effect.fnUntraced(function* (task: string, page: string, version: number) {
  const { hosted } = yield* session;
  const id = yield* resolveTaskId(task);
  const read = yield* askService(hosted.taskFiles.page, { id, page, version: String(version) });
  return read.page;
});

/** Who showed a page's version, as a line names them. */
function shownByOf(line: PageLine): string {
  if (line.shownBy === undefined) return "";
  return line.shownBy.kind === PAGE_SHOWER.AGENT ? `agent ${line.shownBy.agentId}` : PRODUCT_NAME;
}

const listCommand = Command.make("list", { task: taskFlag }, ({ task }) =>
  Effect.gen(function* () {
    const pages = yield* pagesOf(task);
    yield* answer({
      json: { pages },
      lines:
        pages.length === 0
          ? ["No pages."]
          : columns(
              pages.map((page) => [
                page.id,
                `v${page.version}`,
                new Date(page.at).toISOString(),
                shownByOf(page),
                page.title,
              ]),
            ),
      ids: pages.map((page) => page.id),
    });
  }),
).pipe(
  Command.withDescription("List the pages agents showed on a task"),
  Command.withExamples([
    { command: "vespin page list --task ACME-42", description: "A task's pages" },
  ]),
);

const showCommand = Command.make(
  "show",
  {
    page: Argument.String("page").pipe(
      Argument.withDescription("The page's id, as page list prints it"),
    ),
    task: taskFlag,
    version: Flag.Int("version").pipe(
      Flag.optional,
      Flag.withDescription("The version to read (default: the newest)"),
    ),
  },
  ({ page, task, version }) =>
    Effect.gen(function* () {
      const pages = yield* pagesOf(task);
      const line = pages.find((each) => each.id === page);
      if (line === undefined) {
        return yield* new CommandFailed({ exit: CLI_EXIT.REFUSED, message: `No page ${page}.` });
      }
      const read: PageVersion = yield* versionOf(
        task,
        page,
        Option.getOrElse(version, () => line.version),
      );
      yield* answer({
        json: { page: read, newestVersion: line.version },
        lines: [read.html.replace(/\n+$/u, "")],
        ids: [read.id],
      });
    }),
).pipe(
  Command.withDescription("Print one version of a page as its HTML"),
  Command.withExamples([
    {
      command: "vespin page show <page-id> --task ACME-42 > page.html",
      description: "Save a page's newest version",
    },
    {
      command: "vespin page show <page-id> --task ACME-42 --version 1 --json",
      description: "Its first version, with its title",
    },
  ]),
);

/** The page group: list and show. */
export const pageCommand = Command.make("page").pipe(
  Command.withDescription("List and read the pages agents showed"),
  Command.withSubcommands([listCommand, showCommand]),
  Command.withExamples([
    { command: "vespin page list --task ACME-42", description: "A task's pages" },
  ]),
);
