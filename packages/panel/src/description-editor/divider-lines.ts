/**
 * divider-lines.ts -- an empty line opened beside a divider as Notion opens one: under a divider selected whole on Enter, and past a divider standing at the text's start or end on a press beyond its line.
 *
 * A divider is pressed anywhere in the gap around its line and selected
 * whole (`tasks.css`), so a divider standing first or last in the text
 * leaves no words above or below it to press into. A press past its line on
 * the text's outer side, above a first divider or below a last one, opens
 * an empty line there instead, as a press under a Notion page's last block
 * does, and Enter on a divider selected whole opens one under it wherever
 * it stands. Note that ProseMirror's own Enter opens the line above a
 * divider that is the text's first block, which is why Enter is answered
 * here before it.
 */

import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** TipTap's name for a divider. */
const DIVIDER = "horizontalRule";

/** Answered before TipTap's own keys, whose Enter would open the line above a first divider. */
const BEFORE_TIPTAP_KEYS = 1000;

/** An empty line laid in at `at`, the caret in it, answering whether it was; none where the text takes no paragraph. */
function openLine(view: EditorView, at: number): boolean {
  const line = view.state.schema.nodes.paragraph?.create();

  if (line === undefined) return false;
  const tr = view.state.tr.insert(at, line);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());

  return true;
}

/** The empty lines a divider opens beside it. */
export const dividerLines = Extension.create({
  name: "dividerLines",
  priority: BEFORE_TIPTAP_KEYS,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;

        if (!(selection instanceof NodeSelection) || selection.node.type.name !== DIVIDER) {
          return false;
        }

        return openLine(editor.view, selection.to);
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("dividerLines"),
        props: {
          handleClickOn: (view, _pos, node, at, event, direct) => {
            const line = view.nodeDOM(at);

            if (!direct || node.type.name !== DIVIDER || !(line instanceof Element)) return false;
            const { top, bottom } = line.getBoundingClientRect();
            const after = at + node.nodeSize;

            const opens =
              after === view.state.doc.content.size && event.clientY > bottom
                ? after
                : at === 0 && event.clientY < top
                  ? 0
                  : undefined;

            return opens !== undefined && openLine(view, opens);
          },
        },
      }),
    ];
  },
});
