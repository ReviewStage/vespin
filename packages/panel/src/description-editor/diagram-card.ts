import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * diagram-card.ts -- a Mermaid code block open in the editor as the read view draws it: its diagram's card, the block's code standing in the picture's place while it is shown.
 *
 * The read view draws a Mermaid fence as its diagram, under a head whose
 * Show code puts the code in the picture's place (`description-diagram.tsx`).
 * The editor draws the block in that same card, drawn by the panel
 * (`./contract.ts`'s `drawDiagram`), with the block's own code card, the
 * lines ProseMirror edits, handed to it to stand in the code's place
 * (`./code-block-view.ts`), so opening the text moves no diagram. Its code is
 * shown by Show code, and the diagram again by Show diagram. The arrow keys
 * step over the diagram as over a picture, since the browser moves past the
 * hidden code; a caret that lands in it all the same, as an undo of an edit
 * there does, shows the code until it leaves. This module marks the block
 * the caret stands in, which its view reads.
 */

/** The language a code block names to be drawn as a diagram. */
export const DIAGRAM_LANGUAGE = "mermaid";

/** The node a fence opens as. */
const CODE_BLOCK = "codeBlock";

const CARET = new PluginKey<DecorationSet>("diagramCaret");

/** What a block the caret stands in is marked with, which its view reads among its decorations. */
const CARET_SPEC = { diagramCaret: true } as const;

/** What opened a diagram's code: a press on its Show code, which keeps it open, or the caret arriving in it, which closes it again as it leaves. */
export const CODE_OPENED = { PRESS: "press", CARET: "caret" } as const;

export type CodeOpened = (typeof CODE_OPENED)[keyof typeof CODE_OPENED];

/** Whether a block is drawn as its diagram's card. */
export function drawnAsDiagram(node: PmNode): boolean {
  return node.type.name === CODE_BLOCK && node.attrs.language === DIAGRAM_LANGUAGE;
}

/** Whether a block's decorations say the caret stands in it. */
export function caretIn(decorations: readonly Decoration[]): boolean {
  return decorations.some((decoration) => decoration.spec.diagramCaret === true);
}

/** The Mermaid block the selection's head stands in, marked; none where it stands in none. */
function caretMark(doc: PmNode, head: number): DecorationSet {
  const $head = doc.resolve(head);

  for (let depth = $head.depth; depth > 0; depth -= 1) {
    const node = $head.node(depth);

    if (drawnAsDiagram(node)) {
      const at = $head.before(depth);

      return DecorationSet.create(doc, [Decoration.node(at, at + node.nodeSize, {}, CARET_SPEC)]);
    }
  }

  return DecorationSet.empty;
}

/** The mark on the Mermaid block the caret stands in, which shows its code while it does. */
export const diagramCaret = Extension.create({
  name: "diagramCaret",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: CARET,
        state: {
          init: (_config, state) => caretMark(state.doc, state.selection.head),
          apply: (tr, mark) =>
            tr.docChanged || tr.selectionSet ? caretMark(tr.doc, tr.selection.head) : mark,
        },
        props: { decorations: (state) => CARET.getState(state) },
      }),
    ];
  },
});
