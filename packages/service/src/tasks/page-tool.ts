import { posix } from "node:path";
import type { DatabaseServices } from "@repo/database/core/query";
import { writePage } from "@repo/database/models/task-pages";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { PAGE_THEME_VARIABLE, PAGE_WIDE_CLASS } from "@repo/features/page-theme";
import {
  PAGE_BOUNDS,
  PAGE_OWNER,
  type PageShower,
  type PageWrite,
  pageTitleSchema,
} from "@repo/features/page-wire";
import { isSecretFile } from "@repo/features/task-wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { logStoreFailure } from "../http/store-failure.js";

/**
 * page-tool.ts -- `show_page`, every agent's one tool for a page: an interactive HTML document shown in the developer's side panel, its task's.
 *
 * A page is one self-contained HTML document, its scripts and styles inline
 * or from cdnjs, which the Mac draws in a sandbox that reaches no network
 * (`apps/desktop/src/main/window/page-protocol.ts`). A coding agent, which
 * builds pages as files, names one in its sandbox as `path`, read here
 * through the same door its own file tools reach the sandbox by, bounded and
 * never read whole past the bound. Naming a page shown before writes its next version, and naming
 * none makes a new page, so an agent revises a page rather than piling up
 * copies of it. The answer carries the page's id and version, and the id of
 * the task it stands on, which its link is built from
 * (`../agents/link-rule.ts`), and never the HTML, which the model wrote and
 * need not read again.
 *
 * Note that the account and the task the page stands on are the binding the
 * service built from the conversation, never an argument. Every outcome is a result the model reads, never a failure of the
 * call, and a refusal says how to mend the call.
 */

/** A sandbox as the tool reads a page from it: where its checkout stands, which a relative path is read from, and one file read as a stream of bytes, or nothing where there is no file. */
interface PageSandbox {
  readonly checkout: string;
  readonly readFile: (options: {
    readonly path: string;
  }) => PromiseLike<ReadableStream<Uint8Array> | null>;
}

/** Where a call's page is written: the account and the task that the service bound, and, for an agent with one, its sandbox, opened on first use. */
export interface PageToolBinding {
  readonly userId: string;
  readonly taskId: string;
  readonly sandbox?: () => Promise<PageSandbox>;
}

/** Why a call showed nothing, in words the model can act on. */
export const SHOW_PAGE_REFUSAL = {
  UNREADABLE_PATH: `Not shown: give a title of at most ${PAGE_BOUNDS.MAX_TITLE_CHARS} characters and the \`path\` of the page's HTML file in your sandbox. Write the page as a file and pass its path; \`html\` is not taken.`,
  NO_SANDBOX: "Not shown: you have no sandbox to read a path from.",
  SECRET: "Not shown: that file holds secrets, such as a `.env`, and is never shown.",
  NO_FILE: "Not shown: no such file in your sandbox:",
  EMPTY: "Not shown: the page is empty.",
  TOO_LARGE: `Not shown: the page is larger than ${PAGE_BOUNDS.MAX_HTML_CHARS / 1024} KB. Inline less data, or load a library from cdnjs rather than inlining it.`,
  NO_PAGE:
    "Not shown: this task has no page with that id. Leave `page` out to make a new page, or name one you showed on this task.",
  NO_TASK: "Not shown: this task no longer exists.",
  UNAVAILABLE: "Not shown: the page could not be saved just now. The call may be made again.",
} as const;

/** An agent's input: the page is always a file in its sandbox, so `path` is required and there is no `html`. */
const CODER_SHOW_PAGE_INPUT = Schema.Struct({
  title: describeWire(
    pageTitleSchema,
    "What the page is, in a few words: its tab's name in the developer's side panel.",
  ),
  path: describeWire(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(1_024)),
    "A file in your sandbox holding the page as one whole HTML document, relative to your working folder or absolute.",
  ),
  page: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      "The id a page you showed on this task answered with, to write its next version in its place. Leave it out to make a new page.",
    ),
  ),
});

const readCoderInput = readEither(CODER_SHOW_PAGE_INPUT);

/** Each variable a page may draw with, by its name, as an agent is told them. */
const THEME_VARIABLES_SAID = Object.values(PAGE_THEME_VARIABLE)
  .map((variable) => `\`${variable}\``)
  .join(", ");

/**
 * How a page is laid out to stand in the transcript it is drawn in, as T3
 * Code tells its agents of an inline render: on the transcript's own ground
 * in the app's theme (`@repo/features/page-theme`), as tall as its content.
 */
const PAGE_LAYOUT_WORDS =
  "It is drawn at its whole height on the transcript's own ground, and opens in the side panel: give " +
  "`html`, `body`, and the outermost element no background color, and add no outer card, border, banner title, " +
  "or side padding; a box that needs a ground of its own gets one inside. The body stands centered at reading width; " +
  "give an element that needs the room, such as a wide chart or a board of many columns, the class " +
  `\`${PAGE_WIDE_CLASS}\`, or the body itself for a page wide throughout. A wide flex row or grid ` +
  "centers what it holds unless it sets its own `justify-content`, and scrolls from its start where it overflows. " +
  "Draw with the app's theme, handed as CSS variables in its light or dark, " +
  `\`color-scheme\` set to match: ${THEME_VARIABLES_SAID}. ` +
  "Let the content set the height: no `vh` units or `height: 100%` on `html` or `body`, and a " +
  "chart a fixed height in pixels. ";

/** The tool as an agent is offered it: its name, its words, and its input schema, the page named by `path` alone. */
export const CODER_SHOW_PAGE_TOOL = {
  name: AGENT_TOOL.SHOW_PAGE,
  description:
    "Show the developer an interactive HTML page in your transcript, your task's, such as a chart, a table to " +
    "sort, a mockup, or a comparison to click through, when it says more than words would: one self-contained " +
    "HTML file in your sandbox, its scripts and styles inline and libraries only from https://cdnjs.cloudflare.com, " +
    "passed by its `path`. " +
    PAGE_LAYOUT_WORDS +
    "Make it read well on a phone: a viewport meta tag, a layout that reflows to one column, wide tables, code, " +
    "and charts that scroll inside their own box, and tap targets big enough for a finger. It runs sealed off: it cannot " +
    "fetch, post, open links or windows, store anything, or load images from the web, so put its " +
    "data in the page. Never put a secret in a page. Show the page or pictures of it with " +
    `\`${AGENT_TOOL.SHOW_MEDIA}\`, never both. Call it again with the \`page\` it answered to ` +
    "replace that page with a new version rather than making another.",
  inputSchema: CODER_SHOW_PAGE_INPUT,
} as const;

/** A call that showed nothing, and why. */
export function showPageRejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** The most bytes a page's file is read to: its bound in characters, at the most bytes UTF-8 spends on one. */
const MAX_FILE_BYTES = PAGE_BOUNDS.MAX_HTML_CHARS * 4;

/**
 * The stream read whole as text, or nothing where it runs past the bound.
 * The reader is canceled however the read ends, so a stream refused, or
 * one that failed mid-way, holds nothing open behind it.
 */
const readBoundedText = Effect.fnUntraced(function* (stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  return yield* Effect.gen(function* () {
    let text = "";
    let bytes = 0;

    while (true) {
      const next = yield* Effect.tryPromise(() => reader.read());

      if (next.done) return Option.some(text + decoder.decode());
      bytes += next.value.byteLength;

      if (bytes > MAX_FILE_BYTES) return Option.none<string>();
      text += decoder.decode(next.value, { stream: true });
    }
  }).pipe(Effect.ensuring(Effect.promise(() => reader.cancel().catch(() => undefined))));
});

/**
 * The page's HTML at the path, read from the agent's sandbox, or the one
 * sentence refusing it. A path is resolved from the sandbox's checkout:
 * inside it when relative, as written when absolute.
 */
function readPageFile(
  sandbox: NonNullable<PageToolBinding["sandbox"]>,
  path: string,
): Effect.Effect<Result.Result<string, string>> {
  return Effect.gen(function* () {
    const opened = yield* Effect.tryPromise(() => sandbox());
    // Note that the rule reads the path as resolved, because `x/.env/.` names the `.env` it spells around.
    const resolved = posix.resolve(opened.checkout, path);

    if (isSecretFile(resolved)) return Result.fail(SHOW_PAGE_REFUSAL.SECRET);
    const stream = yield* Effect.tryPromise(() => opened.readFile({ path: resolved }));

    if (stream === null) return Result.fail(`${SHOW_PAGE_REFUSAL.NO_FILE} ${path}`);
    const text = yield* readBoundedText(stream);

    return Option.match(text, {
      onNone: () => Result.fail(SHOW_PAGE_REFUSAL.TOO_LARGE),
      onSome: (html) => Result.succeed(html),
    });
  }).pipe(Effect.catch(() => Effect.succeed(Result.fail(SHOW_PAGE_REFUSAL.UNAVAILABLE))));
}

/** The page's HTML as read from the path the call names; the refusal where there is no sandbox or the file does not read. */
function htmlOf(
  binding: PageToolBinding,
  path: string,
): Effect.Effect<Result.Result<string, string>> {
  if (binding.sandbox === undefined)
    return Effect.succeed(Result.fail(SHOW_PAGE_REFUSAL.NO_SANDBOX));

  return readPageFile(binding.sandbox, path);
}

/** Why HTML read from a file cannot be a page's: empty, or past the bound in characters. */
function htmlRefusal(html: string): string | undefined {
  if (html.trim() === "") return SHOW_PAGE_REFUSAL.EMPTY;

  return html.length > PAGE_BOUNDS.MAX_HTML_CHARS ? SHOW_PAGE_REFUSAL.TOO_LARGE : undefined;
}

/** One call of `show_page` on what the service bound the page to, by the agent that makes it, answered as the result the model reads. */
export function runShowPage(
  binding: PageToolBinding,
  input: UnparsedWireValue,
  shownBy: PageShower,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const read = readCoderInput(input);

    if (Result.isFailure(read)) return showPageRejected(SHOW_PAGE_REFUSAL.UNREADABLE_PATH);
    const { title, page } = read.success;
    const html = yield* htmlOf(binding, read.success.path);

    if (Result.isFailure(html)) return showPageRejected(html.failure);
    const refusal = htmlRefusal(html.success);

    if (refusal !== undefined) return showPageRejected(refusal);

    const write: PageWrite =
      page === undefined
        ? { title, html: html.success }
        : { title, html: html.success, pageId: page };

    const { userId, taskId } = binding;

    const written = yield* writePage(
      userId,
      { kind: PAGE_OWNER.TASK, taskId },
      write,
      shownBy,
    ).pipe(Effect.tapError(logStoreFailure), Effect.option);

    if (Option.isNone(written)) return showPageRejected(SHOW_PAGE_REFUSAL.UNAVAILABLE);

    if (Option.isNone(written.value)) {
      // Note that a write that finds nothing names no such page where it named one, else no task.
      return showPageRejected(
        page === undefined ? SHOW_PAGE_REFUSAL.NO_TASK : SHOW_PAGE_REFUSAL.NO_PAGE,
      );
    }

    const { id, version } = written.value.value;

    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      page: { id, version, taskId },
    } satisfies WireRecord;
  });
}
