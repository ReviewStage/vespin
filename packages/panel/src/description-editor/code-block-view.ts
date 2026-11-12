import { CODE_CARD_CLASS, CODE_LINES_CLASS } from "@repo/ui/code-face";
import { type AnyExtension, Extension, type NodeViewRenderer } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { Predicate } from "effect";
import { codeColoring } from "./code-coloring.js";
import type { CodeColorer, CodeHeaderDrawer, EditorCodeBlock } from "./contract.js";

/**
 * code-block-view.ts -- a fenced block open in the editor in the drawn text's code card: the card's own header, drawn by the panel, over the block's lines.
 *
 * The block stands in the card's frame (`tasks.css`), headed by the header
 * the drawn text's card wears (`@repo/ui`'s `CodeCardHeader`): its
 * language's icon and name and the one Copy, so the block reads the same
 * open as drawn and opening the text moves no block. Its title is a press
 * there, as a Notion code block's language is, which sets the block's
 * language. The header is drawn by the panel into an element of its own
 * that the editor neither edits nor reads (`./contract.ts`'s
 * `drawCodeHeader`), and drawn again as the block changes rather than taken
 * down, so its menu stays open while the lines change under it. A language
 * set is the block's own attribute, written to its fence as TipTap writes
 * one, with the caret kept where it stood in the block, or put at the end
 * of its lines from anywhere else.
 */

/** The node a fenced block is, as StarterKit names it. */
const CODE_BLOCK = "codeBlock";

/** The extension coloring the blocks' lines. */
const CODE_COLORING = "codeColoring";

/** The classes the block's frame and its header's element wear, which `tasks.css` styles, the frame with the drawn card's own beside them (`@repo/ui/code-face`). */
const FRAME_CLASS = `description-code-block ${CODE_CARD_CLASS}`;
const HEAD_CLASS = "description-code-head";

/** The class TipTap's own block names its language on its code with, which the editor keeps. */
const LANGUAGE_CLASS_PREFIX = "language-";

/** A block's language as its node holds it, none as empty. */
function languageOf(node: PmNode): string {
  return String(node.attrs.language ?? "");
}

/** The class naming a block's language on its code, as TipTap's own block names it; none for a block naming none. */
function languageClass(node: PmNode): string {
  const language = languageOf(node);

  return language === "" ? "" : `${LANGUAGE_CLASS_PREFIX}${language}`;
}

type Frame = { dom: HTMLElement; head: HTMLElement; code: HTMLElement };

/** The block's frame, its header's element, and its lines' element, which ProseMirror edits. */
function frameOf(node: PmNode): Frame {
  const dom = document.createElement("figure");
  dom.className = FRAME_CLASS;
  const head = document.createElement("div");
  head.className = HEAD_CLASS;
  head.contentEditable = "false";
  const pre = document.createElement("pre");
  pre.className = CODE_LINES_CLASS;
  const code = document.createElement("code");
  code.className = languageClass(node);
  pre.append(code);
  dom.append(head, pre);

  return { dom, head, code };
}

/** A fenced block's view, its header drawn by the panel. */
function codeBlockView(drawCodeHeader: CodeHeaderDrawer): NodeViewRenderer {
  return ({ node, editor, getPos }) => {
    const { dom, head, code } = frameOf(node);
    let current = node;

    const setLanguage = (language: string) => {
      const at = getPos();

      if (!editor.isEditable || !Predicate.isNumber(at)) return;
      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .command(({ tr }) => {
          tr.setNodeMarkup(at, undefined, {
            ...current.attrs,
            language: language === "" ? null : language,
          });
          // Note that a caret outside the block goes to its lines' end, so typing after a pick types in it.
          const end = at + current.nodeSize - 1;
          const { from, to } = tr.selection;

          if (from <= at || to > end) tr.setSelection(TextSelection.create(tr.doc, end));

          return true;
        })
        .run();
    };

    const blockOf = (held: PmNode): EditorCodeBlock => ({
      language: languageOf(held),
      code: held.textContent,
      setLanguage,
    });

    const drawing = drawCodeHeader(head, blockOf(node));

    return {
      dom,
      contentDOM: code,
      update: (next) => {
        if (next.type !== current.type) return false;

        const changed =
          languageOf(next) !== languageOf(current) || next.textContent !== current.textContent;

        current = next;

        if (changed) {
          code.className = languageClass(next);
          drawing.redraw(blockOf(next));
        }

        return true;
      },
      // Note that the header's own presses, keys, and menu are its own and not the editor's.
      stopEvent: (event) => event.target instanceof Node && head.contains(event.target),
      // Note that the header's drawing, and the language class set on the lines' element, are no edit of the text.
      ignoreMutation: (mutation) =>
        mutation.type !== "selection" &&
        (head.contains(mutation.target) ||
          (mutation.target === code && mutation.type === "attributes")),
      destroy: () => drawing.undraw(),
    };
  };
}

/**
 * StarterKit with its code block drawn in the code card where the panel
 * draws its header, its lines colored as the card colors them where the panel
 * colors them (`./code-coloring.ts`); as TipTap draws it where it draws none.
 */
export function withCodeHeaders(
  kit: AnyExtension,
  drawCodeHeader: CodeHeaderDrawer | undefined,
  colorCode: CodeColorer | undefined,
): AnyExtension {
  if (drawCodeHeader === undefined) return kit;

  const colors =
    colorCode === undefined
      ? []
      : [
          Extension.create({
            name: CODE_COLORING,
            addProseMirrorPlugins: () => [codeColoring(colorCode)],
          }),
        ];

  return kit.extend({
    addExtensions() {
      const own = (this.parent?.() ?? []).map((extension) =>
        extension.name === CODE_BLOCK
          ? extension.extend({ addNodeView: () => codeBlockView(drawCodeHeader) })
          : extension,
      );

      return [...own, ...colors];
    },
  });
}
