// diff-view-model.ts -- a changed file's patch as the app's native diff view takes it: one row per line of the diff, a hunk's header included, handed as columns rather than an object per row, so a diff of thousands of lines crosses to the view as a handful of values.

import { DIFF_ROW, type DiffRowKind, patchHunks } from "@repo/features/diff-hunks";

/** What a row of the drawn diff is, one letter each, as the view reads them: a hunk's header, a line of context, one added, one removed, or git's note on the line above it. */
export const DRAWN_ROW = {
  HUNK: "h",
  CONTEXT: "c",
  ADDED: "a",
  REMOVED: "r",
  NOTE: "n",
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

/**
 * A patch as the view's columns: each hunk's header as a row, then its
 * rows, as GitHub draws a file's diff; none where the patch does not read as
 * a unified diff, which the screen says rather than drawing nothing.
 */
export function diffColumns(patch: string): DiffColumns | undefined {
  const hunks = patchHunks(patch);

  if (hunks === undefined) return undefined;

  const kinds: string[] = [];
  const oldLines: number[] = [];
  const newLines: number[] = [];
  const lines: string[] = [];
  const tab = " ".repeat(TAB_COLUMNS);

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
    }
  }

  return { kinds: kinds.join(""), oldLines, newLines, text: lines.join("\n") };
}
