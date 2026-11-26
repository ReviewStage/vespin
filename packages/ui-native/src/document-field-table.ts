// document-field-table.ts -- a table a document's field does not edit, read into the rows its native grid draws as the read rows draw the table: each cell's words with their looks and links, each column's alignment.

import type { NativeTable, NativeTableRun } from "./document-field-native.js";
import {
  LINK_TARGET,
  MARKDOWN_BLOCK,
  MARKDOWN_RUN,
  type MarkdownReading,
  type MarkdownRun,
  markdownBlocks,
} from "./markdown-model.js";

/** The looks a cell's words carry, as the field's own runs name them (`INLINE_MARK`). */
const CELL_MARK = {
  STRONG: "strong",
  EMPHASIS: "emphasis",
  STRIKE: "strike",
  CODE: "code",
} as const;

/** A run of a cell as the grid draws it: its words with their looks, a link's words carrying its address, and a chip, a suggestion, or a picture's marker by its words. */
function cellRuns(run: MarkdownRun, link: string | undefined): readonly NativeTableRun[] {
  switch (run.kind) {
    case MARKDOWN_RUN.WORDS: {
      const marks = [
        ...(run.strong ? [CELL_MARK.STRONG] : []),
        ...(run.emphasis ? [CELL_MARK.EMPHASIS] : []),
        ...(run.struck ? [CELL_MARK.STRIKE] : []),
      ];

      return [{ text: run.text, marks, link }];
    }

    case MARKDOWN_RUN.CODE:
      return [{ text: run.text, marks: [CELL_MARK.CODE], link }];
    case MARKDOWN_RUN.LINK: {
      const address = run.target.kind === LINK_TARGET.NONE ? undefined : run.target.href;

      return run.runs.flatMap((inner) => cellRuns(inner, address));
    }

    case MARKDOWN_RUN.CHIP:
      return [{ text: run.chip.name, marks: [], link }];
    case MARKDOWN_RUN.SUGGESTION:
      return [{ text: run.suggestion.words, marks: [], link }];
    case MARKDOWN_RUN.PICTURE:
      return [{ text: run.name, marks: [], link }];
    case MARKDOWN_RUN.BREAK:
      return [{ text: "\n", marks: [], link }];
  }
}

/**
 * The table a locked block's `source` writes, as its grid draws it, read
 * by the parse the read rows draw the table from (`markdownBlocks`); none
 * where the source reads as no table, which then stands as its card.
 */
export function fieldTable(source: string, reading: MarkdownReading): NativeTable | undefined {
  const table = markdownBlocks(source, reading).find(
    (block) => block.kind === MARKDOWN_BLOCK.TABLE,
  );

  if (table?.kind !== MARKDOWN_BLOCK.TABLE) return undefined;

  return {
    source,
    align: table.align,
    rows: table.rows.map((row) => ({
      cells: row.map((cell) => ({ runs: cell.flatMap((run) => cellRuns(run, undefined)) })),
    })),
  };
}
