/**
 * description-blocks.ts -- a description's Markdown read as its top-level blocks, as a client with no editor draws and comments on it: each paragraph, heading, list, quote, code block, table, rule, and picture, with where it stands in the text, the Markdown it is drawn from, and the words a thread on it quotes.
 *
 * A block comment is a thread anchored to one whole block
 * (`DESCRIPTION_COMMENT_SCOPE.BLOCK`), its span offsets into the
 * description's Markdown as the service measures them. The panel finds a
 * block's span from its editor or its drawn words; a client with no editor,
 * the iOS app, reads it here from the shared parse (`markdown-tree.ts`).
 */

import type { Nodes } from "mdast";
import { DESCRIPTION_COMMENT_BOUNDS } from "./description-comment-wire.js";
import { markdownTree } from "./markdown-tree.js";

/** One block of a description: its span in the Markdown, the Markdown it is drawn from, and its words as a thread on it quotes them. */
export interface DescriptionBlock {
  readonly from: number;
  readonly to: number;
  /** The block's own Markdown, with the description's link definitions after it, so a reference-style link or picture in it still finds its address when the block is drawn alone. */
  readonly drawn: string;
  /** Its words with no Markdown, each inner block on a line of its own, at most a quote's length; none where it holds no words to comment on, such as a rule or raw HTML. */
  readonly quote: string | undefined;
}

/** The byte-order mark a pasted body may open with, which the parse skips and counts no offset for. */
const BYTE_ORDER_MARK = "﻿";

/** The node kinds whose children stand on lines of their own in a quote. */
const BLOCK_PARENTS: ReadonlySet<string> = new Set([
  "list",
  "listItem",
  "blockquote",
  "table",
  "tableRow",
]);

/** A node's words with no Markdown: its text, inline code, pictures' alternative words, and a hard line break as a line, a block parent's children each on a line, a table row's cells apart by a tab. */
function plainWords(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code") return node.value;

  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";

  if (node.type === "break") return "\n";

  if (!("children" in node)) return "";
  const parts = node.children.map((child: Nodes) => plainWords(child));

  if (node.type === "tableRow") return parts.join("\t");

  return parts.join(BLOCK_PARENTS.has(node.type) ? "\n" : "");
}

/**
 * The description's blocks, in order: each top-level block but a link
 * definition, which draws nothing, with its span in `text`, the Markdown it
 * is drawn from, and its quote, cut to the longest quote a thread keeps.
 */
export function descriptionBlocks(text: string): readonly DescriptionBlock[] {
  const nodes = markdownTree(text).children;
  // Note that the parse counts offsets from after a leading byte-order mark, while the service counts them in the text as it is.
  const shift = text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK.length : 0;

  const spans = nodes.flatMap((node) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;

    return from === undefined || to === undefined
      ? []
      : [{ node, from: from + shift, to: to + shift }];
  });

  const definitions = spans
    .filter(({ node }) => node.type === "definition")
    .map(({ from, to }) => text.slice(from, to));

  const after = definitions.length === 0 ? "" : `\n\n${definitions.join("\n")}`;

  return spans
    .filter(({ node }) => node.type !== "definition")
    .map(({ node, from, to }) => {
      const quote =
        node.type === "html"
          ? ""
          : plainWords(node).trim().slice(0, DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS);

      return { from, to, drawn: `${text.slice(from, to)}${after}`, quote: quote || undefined };
    });
}
