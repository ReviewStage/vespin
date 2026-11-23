// diff-view-model.ts -- a changed file's patch as the app's native diff view takes it: one row per line of the diff, a hunk's header included, and a row for each review thread under the line it is on, handed as columns rather than an object per row, so a diff of thousands of lines crosses to the view as a handful of values.

import { DIFF_SIDE, type DiffSide, type ReviewThread } from "@repo/features/agent-wire";
import { DIFF_ROW, type DiffRowKind, patchHunks } from "@repo/features/diff-hunks";

/** What a row of the drawn diff is, one letter each, as the view reads them: a hunk's header, a line of context, one added, one removed, or git's note on the line above it. */
export const DRAWN_ROW = {
  HUNK: "h",
  CONTEXT: "c",
  ADDED: "a",
  REMOVED: "r",
  NOTE: "n",
  THREAD: "t",
} as const;

type DrawnRow = (typeof DRAWN_ROW)[keyof typeof DRAWN_ROW];

/** The letter each kind of a hunk's row is drawn as. */
const ROW_LETTER = {
  [DIFF_ROW.CONTEXT]: DRAWN_ROW.CONTEXT,
  [DIFF_ROW.ADDED]: DRAWN_ROW.ADDED,
  [DIFF_ROW.REMOVED]: DRAWN_ROW.REMOVED,
  [DIFF_ROW.NOTE]: DRAWN_ROW.NOTE,
} as const satisfies Record<DiffRowKind, DrawnRow>;

/** The line number a row stands with where it stands on no side of it, which the view draws as an empty gutter. */
export const NO_LINE = 0;

/** What stands between a thread row's title and its detail in its words, which the view draws as two lines. */
export const THREAD_PARTS = "\u001f";

/** What a thread row says where it stands on no line the diff shows, before its detail. */
const UNPLACED_WORDS = "On a line this diff doesn't show";

/** How many columns a tab is drawn as, so a row's width is its length in characters, as the view counts it. */
const TAB_COLUMNS = 4;

/**
 * A patch's rows as the view takes them, each column one value: the rows'
 * kinds, a letter each (`DRAWN_ROW`); their line numbers on the old side
 * and the new, `NO_LINE` where a row stands on no side of it; and their
 * words, a row to a line, a tab spelled as `TAB_COLUMNS` spaces, so every
 * character stands one column wide in the monospaced face.
 */
export interface DiffColumns {
  readonly kinds: string;
  readonly oldLines: readonly number[];
  readonly newLines: readonly number[];
  readonly text: string;
}

/** The diff's columns, and each thread row's thread, by its row; never handed to the view, which tells a press on a thread by its row. */
export interface DrawnDiff {
  readonly columns: DiffColumns;
  readonly threads: ReadonlyMap<number, ReviewThread>;
}

/** What a thread's row says: who started it and the first line of their words, then how many replies follow it, and whether it is resolved or outdated. */
function threadWords(thread: ReviewThread, placed: boolean): string {
  const first = thread.comments[0];
  const opening = first?.body.split("\n").find((line) => line.trim() !== "") ?? "";
  const replies = thread.comments.length - 1 + thread.more;

  const marks = [
    placed ? undefined : UNPLACED_WORDS,
    replies === 0 ? undefined : `${replies} ${replies === 1 ? "reply" : "replies"}`,
    thread.resolved ? "Resolved" : undefined,
    thread.outdated ? "Outdated" : undefined,
  ].filter((mark) => mark !== undefined);

  return `${first?.by.login ?? ""} · ${opening}${THREAD_PARTS}${marks.join(" · ")}`;
}

/**
 * A patch as the view's columns: each hunk's header as a row, then its
 * rows, as GitHub draws a file's diff, and a row for each of the file's review
 * threads under the row of the line it stands on, on the side it counts on,
 * as GitHub stands a thread under its line; a thread on no line the diff
 * shows, outdated or past its hunks, stands above the first hunk, saying so.
 * None where the patch does not read as a unified diff, which the screen
 * says rather than drawing nothing. Note that only the threads on `path`
 * are drawn.
 */
export function drawnDiff(
  patch: string,
  threads: readonly ReviewThread[],
  path?: string | undefined,
): DrawnDiff | undefined {
  const hunks = patchHunks(patch);

  if (hunks === undefined) return undefined;

  const kinds: string[] = [];
  const oldLines: number[] = [];
  const newLines: number[] = [];
  const lines: string[] = [];
  const placedThreads = new Map<number, ReviewThread>();
  const tab = " ".repeat(TAB_COLUMNS);
  const own = threads.filter((thread) => thread.path === path && thread.comments.length > 0);

  // The threads by the line they stand on, on each side, where they stand on one.
  const onOld = new Map<number, ReviewThread[]>();
  const onNew = new Map<number, ReviewThread[]>();
  const shown = new Set<ReviewThread>();

  for (const thread of own) {
    if (thread.line === null || thread.outdated) continue;
    const bySide = thread.side === DIFF_SIDE.LEFT ? onOld : onNew;
    bySide.set(thread.line, [...(bySide.get(thread.line) ?? []), thread]);
  }

  for (const hunk of hunks) {
    for (const row of hunk.rows) {
      for (const thread of [
        ...(row.oldLine === undefined ? [] : (onOld.get(row.oldLine) ?? [])),
        ...(row.newLine === undefined ? [] : (onNew.get(row.newLine) ?? [])),
      ]) {
        shown.add(thread);
      }
    }
  }

  const pushThread = (thread: ReviewThread) => {
    placedThreads.set(kinds.length, thread);
    kinds.push(DRAWN_ROW.THREAD);
    oldLines.push(NO_LINE);
    newLines.push(NO_LINE);
    lines.push(threadWords(thread, shown.has(thread)));
  };

  for (const thread of own) if (!shown.has(thread)) pushThread(thread);

  for (const hunk of hunks) {
    kinds.push(DRAWN_ROW.HUNK);
    oldLines.push(NO_LINE);
    newLines.push(NO_LINE);
    lines.push(hunk.header);

    for (const row of hunk.rows) {
      kinds.push(ROW_LETTER[row.kind]);
      oldLines.push(row.oldLine ?? NO_LINE);
      newLines.push(row.newLine ?? NO_LINE);
      lines.push(row.text.replaceAll("\t", tab));

      // A removed row stands the old side's threads under it, an added row the new side's, and a row of context both.
      const under = [
        ...(row.kind === DIFF_ROW.ADDED || row.oldLine === undefined
          ? []
          : (onOld.get(row.oldLine) ?? [])),
        ...(row.kind === DIFF_ROW.REMOVED || row.newLine === undefined
          ? []
          : (onNew.get(row.newLine) ?? [])),
      ];

      for (const thread of under) pushThread(thread);
    }
  }

  return {
    columns: { kinds: kinds.join(""), oldLines, newLines, text: lines.join("\n") },
    threads: placedThreads,
  };
}

/** The words of one line of a patch, on the side it counts on, as a comment on it quotes them; none where the patch shows no such line. */
export function diffLineText(patch: string, line: number, side: DiffSide): string | undefined {
  for (const hunk of patchHunks(patch) ?? []) {
    for (const row of hunk.rows) {
      const at = side === DIFF_SIDE.LEFT ? row.oldLine : row.newLine;

      if (
        at === line &&
        (side === DIFF_SIDE.LEFT ? row.kind !== DIFF_ROW.ADDED : row.kind !== DIFF_ROW.REMOVED)
      ) {
        return row.text;
      }
    }
  }

  return undefined;
}
