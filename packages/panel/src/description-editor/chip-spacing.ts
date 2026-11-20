import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as PmNode } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

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
 *
 * The space laid after a chip is provisional, as the space iOS lays after a
 * predictive suggestion is (`chipSpacing`): while the caret stands right
 * after it, closing punctuation typed there takes its place, so `@Alex,`
 * comes out with no gap, and a space typed there merges into it, so none is
 * doubled. One undo brings the space back. The caret leaving it, or any
 * change that moves the caret, makes it an ordinary space, and a space the
 * writer typed is never provisional.
 */

const SPACE = " ";

/** The marks that close what stands before them, which no space comes before. */
const CLOSING_PUNCTUATION = /^[.,;:!?)\]}]$/u;

/** The marks that open what stands after them, which no space comes after. */
const OPENING_PUNCTUATION = /^[([{]$/u;

/** The marks typed right after a chip's provisional space that take its place; a straight quote is left out, since it opens as often as it closes. */
const TAKES_THE_SPACE = /^[.,;:!?)\]}\u2026'\u2019\u201D]$/u;

/** Where the space laid after a chip stands while it is provisional, or null. */
const PROVISIONAL_SPACE = new PluginKey<number | null>("chip-provisional-space");

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
  const laysSpace = !CLOSING_PUNCTUATION.test(next) && next !== SPACE;

  if (CLOSING_PUNCTUATION.test(next)) tr.setSelection(TextSelection.create(tr.doc, end));
  else {
    if (laysSpace) tr.insert(end, tr.doc.type.schema.text(SPACE));
    tr.setSelection(TextSelection.create(tr.doc, end + SPACE.length));
  }

  // Note that the caret set above moves on past a space laid in before the chips.
  const spaceBefore = endsWord(tr.doc.resolve(from).nodeBefore);

  if (spaceBefore) tr.insert(from, tr.doc.type.schema.text(SPACE));
  const space = spaceBefore ? end + SPACE.length : end;

  return tr.setMeta(PROVISIONAL_SPACE, laysSpace ? space : null);
}

/**
 * The provisional space carried through a change: where it now stands, or
 * null once the change took it out or left the caret anywhere but right
 * after it. Note that it is mapped rather than dropped on any change, so a
 * plugin's appended transaction that leaves the caret alone keeps it.
 */
function provisionalAfter(
  tr: Transaction,
  space: number | null,
  state: EditorState,
): number | null {
  const set: number | null | undefined = tr.getMeta(PROVISIONAL_SPACE);

  if (set !== undefined) return set;

  if (space === null) return null;
  const mapped = tr.mapping.mapResult(space, 1);
  const { selection, doc } = state;
  const standing = doc.textBetween(mapped.pos, Math.min(mapped.pos + 1, doc.content.size));

  if (mapped.deleted || standing !== SPACE) return null;

  return selection.empty && selection.from === mapped.pos + SPACE.length ? mapped.pos : null;
}

/** What keeps the space laid after a chip provisional while the caret stands right after it. */
const provisionalSpacePlugin = new Plugin<number | null>({
  key: PROVISIONAL_SPACE,
  state: {
    init: () => null,
    apply: (tr, space, _old, state) => provisionalAfter(tr, space, state),
  },
});

/** The extension every box that lays chips in takes, so the space after a chip is provisional in each (`typedAtChipSpace`). */
export const chipSpacing = Extension.create({
  name: "chipSpacing",
  addProseMirrorPlugins: () => [provisionalSpacePlugin],
});

/**
 * A key typed right after a chip's provisional space, taken: closing
 * punctuation written in the space's place, as its own step of the undo
 * history so one undo brings the space back, or a space merged into it and
 * made ordinary. Answers whether it was taken; anything else is typed as
 * ever, and makes the space ordinary as the caret moves on past it.
 */
export function typedAtChipSpace(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  const space = PROVISIONAL_SPACE.getState(view.state) ?? null;

  if (space === null || from !== to || from !== space + SPACE.length) return false;

  if (text === SPACE) {
    view.dispatch(view.state.tr.setMeta(PROVISIONAL_SPACE, null));

    return true;
  }

  if (!TAKES_THE_SPACE.test(text)) return false;
  const tr = closeHistory(view.state.tr).insertText(text, space, space + SPACE.length);
  view.dispatch(tr.setMeta(PROVISIONAL_SPACE, null).scrollIntoView());

  return true;
}

/** The chip given laid in over what is selected, spaced as every chip is (`spacedChip`). */
export function chipOverSelection(state: EditorState, chip: PmNode): Transaction {
  const laid = state.tr.replaceSelectionWith(chip, false);
  const end = laid.selection.from;

  return spacedChip(laid, end - chip.nodeSize, end);
}
