import type { Node as PmNode } from "@tiptap/pm/model";
import { type EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";

/**
 * chip-spacing.ts -- the spaces around a chip laid into the words, as a text editor's smart insert lays them, and the `@` word a pick replaces.
 *
 * Every chip the editors lay in, a file's, a skill's, or a mention's, picked
 * from a list, pasted, or handed in, in any composer or the description, is
 * spaced here (`spacedChip`), so each box spaces them alike. After the chip:
 * a space where a word, a line's end, or nothing follows, the caret past it;
 * none where a space follows, the caret past that one, so no space is
 * doubled; and none before closing punctuation, the caret right after the
 * chip, so `see [Picture 1].` keeps its period on the chip. Before the chip:
 * a space where a word or another chip ends right there, as when it is laid
 * in mid-word; none at a line's start, after a space, or after an opening
 * bracket, so `([Picture 1])` keeps its brackets on the chip.
 *
 * Both editors read the `@` word the caret stands in by one rule
 * (`atWordAround`): an `@` at the start of a word, then up to six words of
 * its own, since a section's heading has spaces in it, and a date's range
 * runs as long as `next fri at 3pm to 5pm`. A pick replaces it through the
 * caret to the word's end, so a dot inside a name, `session-store.ts`, goes
 * with it, but short of the closing punctuation the word ends on, so a pick
 * in `see @go|.` keeps the period the chip then stands against.
 */

const SPACE = " ";

/** The marks that close what stands before them, which no space comes before. */
const CLOSING_PUNCTUATION = /^[.,;:!?)\]}]$/u;

/** The marks that open what stands after them, which no space comes after. */
const OPENING_PUNCTUATION = /^[([{]$/u;

/** The closing punctuation a word ends on, which a pick leaves standing. */
const TRAILING_CLOSING = /[.,;:!?)\]}]+$/u;

/** The `@` word the caret ends: `@`, at the start of a word, then up to six words with no bracket, parenthesis, or `@` in them. */
const AT_WORD = /(^|\s)@((?:[^\s@[\]()]+(?: [^\s@[\]()]+){0,5})?)$/u;

/** The rest of an `@` word after the caret: up to a space, a bracket, a parenthesis, an `@`, or a chip read as the object character, which is no word's. */
const AT_WORD_REST = /^[^\s@[\]()\uFFFC]*/u;

/** The `@` word the caret stands in: what is typed of it after the `@`, and how many characters past the caret a pick replaces. */
export interface AtWord {
  readonly query: string;
  readonly rest: number;
}

/** Whether what stands right before a place ends a word, so a chip laid there needs a space before it. */
function endsWord(node: PmNode | null): boolean {
  if (node === null) return false;

  if (!node.isText) return node.isInline && node.type.spec.linebreakReplacement !== true;
  const last = node.text?.at(-1) ?? "";

  return last !== "" && !/\s/u.test(last) && !OPENING_PUNCTUATION.test(last);
}

/**
 * The change given, its chips standing from `from` to `end`, spaced from a
 * word before them and from what follows, the caret set after them.
 */
export function spacedChip(tr: Transaction, from: number, end: number): Transaction {
  const next = tr.doc.textBetween(end, Math.min(end + 1, tr.doc.content.size));

  if (CLOSING_PUNCTUATION.test(next)) tr.setSelection(TextSelection.create(tr.doc, end));
  else {
    if (next !== SPACE) tr.insert(end, tr.doc.type.schema.text(SPACE));
    tr.setSelection(TextSelection.create(tr.doc, end + SPACE.length));
  }

  // Note that the caret set above moves on past a space laid in before the chips.
  if (endsWord(tr.doc.resolve(from).nodeBefore)) tr.insert(from, tr.doc.type.schema.text(SPACE));

  return tr;
}

/** The chip given laid in over what is selected, spaced as every chip is (`spacedChip`). */
export function chipOverSelection(state: EditorState, chip: PmNode): Transaction {
  const laid = state.tr.replaceSelectionWith(chip, false);
  const end = laid.selection.from;

  return spacedChip(laid, end - chip.nodeSize, end);
}

/** The `@` word the caret stands in, read from its line's words before the caret and after it; nothing where the caret ends no `@` word. */
export function atWordAround(before: string, after: string): AtWord | undefined {
  const match = AT_WORD.exec(before);

  if (match === null) return undefined;
  const rest = AT_WORD_REST.exec(after)?.[0] ?? "";

  return { query: match[2] ?? "", rest: rest.replace(TRAILING_CLOSING, "").length };
}
