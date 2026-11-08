import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { codeTitle } from "../code-language.js";

/**
 * code-title.ts -- a fenced block open in the editor named by its language on its frame, as the drawn text's code card heads it (`../code-language.ts`), so the block reads the same open as drawn.
 */

/** The node a fenced block is, as StarterKit names it. */
const CODE_BLOCK = "codeBlock";

/** The attribute the block's frame reads its header's words from (`tasks.css`). */
const CODE_TITLE_ATTRIBUTE = "data-code-title";

const TITLES = new PluginKey<DecorationSet>("codeTitles");

/** Each fenced block of the text named by its language. */
function titlesOf(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== CODE_BLOCK) return true;
    const title = codeTitle(String(node.attrs.language ?? ""));
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { [CODE_TITLE_ATTRIBUTE]: title }));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** Names each fenced block's language on its frame, named afresh as the text changes. */
export const codeTitles = Extension.create({
  name: "codeTitles",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: TITLES,
        state: {
          init: (_config, state) => titlesOf(state.doc),
          apply: (tr, before) => (tr.docChanged ? titlesOf(tr.doc) : before),
        },
        props: {
          decorations: (state) => TITLES.getState(state),
        },
      }),
    ];
  },
});
