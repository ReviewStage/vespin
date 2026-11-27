// review-thread-lines.ts -- the lines a pull request's review thread is on, as every client previews them: the end of the hunk GitHub froze for it, from a few rows above the first line of its range to its line, and the rows of its own range.

import { DIFF_SIDE, type DiffSide, type ReviewThread } from "./agent-wire.js";
import { type DiffRow, patchHunks } from "./diff-hunks.js";

/** How many rows a review thread's preview shows above the first line it is on. */
const THREAD_CONTEXT_ROWS = 3;

/** A hunk's header: where it starts on each side, what it counts, and the scope git writes after. */
export const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/u;

/**
 * A hunk GitHub froze for a review thread, its header counting the lines it
 * holds; none where it does not start with a header. Note that the header
 * is counted again, because GitHub keeps the whole hunk's counts while
 * cutting its lines at the thread's line, and jsdiff refuses a hunk whose
 * lines fall short of its header.
 */
function frozenHunk(diffHunk: string): string | undefined {
  const [header = "", ...written] = diffHunk.split("\n");
  const match = HUNK_HEADER.exec(header);

  if (match === null) return undefined;
  const lines = written.at(-1) === "" ? written.slice(0, -1) : written;
  const old = lines.filter((line) => !line.startsWith("+") && !line.startsWith("\\")).length;
  const now = lines.filter((line) => !line.startsWith("-") && !line.startsWith("\\")).length;
  const [, oldStart = "", newStart = "", scope = ""] = match;

  return [`@@ -${oldStart},${old} +${newStart},${now} @@${scope}`, ...lines].join("\n");
}

/** A row's number on the side given, none where it does not stand on that side. */
function lineOn(row: DiffRow, side: DiffSide): number | undefined {
  return side === DIFF_SIDE.LEFT ? row.oldLine : row.newLine;
}

/** The rows a review thread previews, and those of them its own range holds. */
interface PreviewRows {
  readonly kept: readonly DiffRow[];
  readonly own: readonly DiffRow[];
}

/** The rows a review thread previews, the end of the hunk from a few rows above its range to its line, and those of its range. */
function previewRows(
  rows: readonly DiffRow[],
  thread: Pick<ReviewThread, "originalLine" | "originalStartLine" | "side" | "startSide">,
): PreviewRows {
  const { originalLine: line, originalStartLine: startLine, side } = thread;
  const found = rows.findLastIndex((row) => line !== null && lineOn(row, side) === line);
  const end = found === -1 ? rows.length - 1 : found;
  const startSide = thread.startSide ?? side;

  const first = rows.findIndex(
    (row, at) => at <= end && startLine !== null && lineOn(row, startSide) === startLine,
  );

  const start = first === -1 ? end : first;

  return {
    kept: rows.slice(Math.max(0, start - THREAD_CONTEXT_ROWS), end + 1),
    own: rows.slice(start, end + 1),
  };
}

/** The lines a review thread is on, read from the hunk GitHub froze for it: its header as written, every row it holds, the rows a preview keeps, and those of the thread's own range among them. */
export interface ThreadLines {
  readonly header: string;
  readonly rows: readonly DiffRow[];
  readonly kept: readonly DiffRow[];
  readonly own: readonly DiffRow[];
}

/**
 * The lines a review thread is on, as the panel's card and the iOS app's
 * thread screen preview them: the end of the hunk GitHub froze for it, from
 * a few rows above the first line of its range to its line, each found on
 * the side it counts on, the hunk's last row where its line is not found,
 * since GitHub ends the hunk there. None where the hunk is empty or does not
 * read as a diff.
 */
export function threadLines(
  thread: Pick<
    ReviewThread,
    "diffHunk" | "originalLine" | "originalStartLine" | "side" | "startSide"
  >,
): ThreadLines | undefined {
  const hunk = frozenHunk(thread.diffHunk);

  if (hunk === undefined) return undefined;
  const parsed = patchHunks(hunk)?.at(-1);

  if (parsed === undefined) return undefined;
  const { kept, own } = previewRows(parsed.rows, thread);

  return kept.length === 0 ? undefined : { header: parsed.header, rows: parsed.rows, kept, own };
}
