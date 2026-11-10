import { TextSelection, type Transaction } from "@tiptap/pm/state";

/**
 * chip-spacing.ts -- the space after a chip laid into the words, as a text editor's smart insert lays one.
 *
 * Every chip the editors lay in, a file's, a skill's, or a mention's, picked
 * from a list, pasted, or handed in, is spaced from what follows it here, so
 * each box spaces them alike: a space where a word, a line's end, or nothing
 * follows, the caret past it; none where a space follows, the caret past that
 * one, so no space is doubled; and none before closing punctuation, the caret
 * right after the chip, so `see [Picture 1].` keeps its period on the chip.
 */

const SPACE = " ";

/** The marks that close what stands before them, which no space comes before. */
const CLOSING_PUNCTUATION = /^[.,;:!?)\]}]$/u;

/** The change given, its chip ending at `end`, spaced from what follows and the caret set after it. */
export function spacedAfterChip(tr: Transaction, end: number): Transaction {
  const { doc } = tr;
  const next = doc.textBetween(end, Math.min(end + 1, doc.content.size));
  if (CLOSING_PUNCTUATION.test(next)) return tr.setSelection(TextSelection.create(doc, end));
  if (next !== SPACE) tr.insert(end, doc.type.schema.text(SPACE));
  return tr.setSelection(TextSelection.create(tr.doc, end + SPACE.length));
}
