/**
 * bare-addresses.ts -- a web address written as its own link drawn in the editor as the read view says it, without its scheme or trailing slash, but while the caret stands in it.
 *
 * The read view says a link whose words are its own address without its
 * `https://` or a trailing slash (`@repo/ui/link-face`), so the editor
 * folds those parts of the words away (`tasks.css`), and opening a
 * section to edit it moves none of its words. The words stay in the text
 * as written, and a link the caret or the selection touches is drawn whole,
 * so what is edited is always seen.
 */

import { saidSpanOf } from "@repo/ui/link-face";
import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** The link mark's name, as StarterKit spells it. */
const LINK_MARK = "link";

/** The class the folded parts of a bare address wear, which `tasks.css` hides. */
const ADDRESS_FOLD_CLASS = "description-address-fold";

const FOLD = { class: ADDRESS_FOLD_CLASS } as const;

/** One link's words in a block: where they stand, its target, and the words, however many runs of formatting or comment marks they are split into. */
interface LinkRun {
  readonly from: number;
  readonly to: number;
  readonly href: string;
  readonly words: string;
}

/** Each link's whole words in the block standing at `at`, runs under one target that meet read as one. */
function linkRunsOf(block: PmNode, at: number): readonly LinkRun[] {
  const runs: LinkRun[] = [];

  block.forEach((child, offset) => {
    const link = child.isText
      ? child.marks.find((mark) => mark.type.name === LINK_MARK)
      : undefined;

    if (link === undefined) return;
    const from = at + 1 + offset;
    const href = String(link.attrs.href ?? "");
    const last = runs.at(-1);
    const words = child.text ?? "";

    if (last !== undefined && last.href === href && last.to === from) {
      runs[runs.length - 1] = { ...last, to: from + words.length, words: last.words + words };
    } else {
      runs.push({ from, to: from + words.length, href, words });
    }
  });

  return runs;
}

/** The parts of each bare address in the text that its face leaves out, but in a link the selection touches. */
function foldsOf(state: EditorState): DecorationSet {
  const { from, to } = state.selection;
  const folds: Decoration[] = [];

  state.doc.descendants((node, at) => {
    if (!node.isTextblock) return true;

    for (const run of linkRunsOf(node, at)) {
      const said = saidSpanOf(run.href, run.words);

      if (said === undefined || (from <= run.to && to >= run.from)) continue;

      if (said.start > 0) folds.push(Decoration.inline(run.from, run.from + said.start, FOLD));

      if (said.end < run.words.length) {
        folds.push(Decoration.inline(run.from + said.end, run.to, FOLD));
      }
    }

    return false;
  });

  return DecorationSet.create(state.doc, folds);
}

const BARE_ADDRESSES = new PluginKey<DecorationSet>("bareAddresses");

/** Bare addresses drawn as the read view says them. */
export const bareAddresses = Extension.create({
  name: "bareAddresses",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: BARE_ADDRESSES,
        state: {
          init: (_config, state) => foldsOf(state),
          // Note that the folds are found again only when the words or the selection moved.
          apply: (tr, folds, _old, state) =>
            tr.docChanged || tr.selectionSet ? foldsOf(state) : folds,
        },
        props: {
          decorations: (state) => BARE_ADDRESSES.getState(state),
        },
      }),
    ];
  },
});
