import { QUOTE_CLASS } from "@repo/ui/quote-face";
import type { AnyExtension } from "@tiptap/core";
import Blockquote from "@tiptap/extension-blockquote";
import { withoutTipTapChords } from "./writing-keys.js";

/**
 * quote-node.ts -- the quote both editors hold, the description's and every message box's: TipTap's own blockquote, in the quote's face, typed as `> ` and chorded as the writing vocabulary's Quote.
 *
 * Every message box mounts one editor (`composer-editor.ts`), and the
 * description its own (`description-editor.ts`), so this is the one place
 * the quote is made for both: the same node, the same look a sent quote and
 * the description draw (`@repo/ui/quote-face`), the same `> ` rule and keys,
 * and TipTap's own chord left out for the vocabulary's (`./writing-keys.ts`).
 * A message box's holds lines alone, since a message's quotes are read back
 * one level deep (`@repo/ui/reply-quote`); the description's holds any block.
 */

/** The quote node, holding lines alone where `linesAlone` says so, as a message box's does. */
export function quoteNode(linesAlone: boolean): AnyExtension {
  const quote = linesAlone ? Blockquote.extend({ content: "paragraph+" }) : Blockquote;

  return withoutTipTapChords(quote.configure({ HTMLAttributes: { class: QUOTE_CLASS } }));
}
