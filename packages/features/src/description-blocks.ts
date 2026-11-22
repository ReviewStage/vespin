/**
 * description-blocks.ts -- a description's Markdown read as its top-level blocks, as a client with no editor draws and comments on it: each paragraph, heading, list, quote, code block, table, rule, and picture, with where it stands in the text, the Markdown it is drawn from, and the words a thread on it quotes.
 *
 * A block comment is a thread anchored to one whole block
 * (`DESCRIPTION_COMMENT_SCOPE.BLOCK`), its span offsets into the
 * description's Markdown as the service measures them. The panel finds a
 * block's span from its editor or its drawn words; a client with no editor,
 * the iOS app, reads it here from the shared parse (`markdown-tree.ts`).
 */

import type { Nodes, Root } from "mdast";
import { DESCRIPTION_COMMENT_BOUNDS } from "./description-comment-wire.js";
import { keptMarkdownTree, markdownTree } from "./markdown-tree.js";

/** One block of a description: its span in the Markdown, the Markdown it is drawn from, and its words as a thread on it quotes them. */
export interface DescriptionBlock {
  readonly from: number;
  readonly to: number;
  /** The block's own Markdown, with the description's link definitions it uses after it, so a reference-style link or picture in it still finds its address when the block is drawn alone. */
  readonly drawn: string;
  /** Its words with no Markdown, each inner block on a line of its own, at most a quote's length; none where it holds no words to comment on, such as a rule or raw HTML. */
  readonly quote: string | undefined;
}

/** The most of a description a screen draws before its whole parse: more than a screen holds. */
export const DESCRIPTION_HEAD_MOST = 4000;

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

/** The link definitions a node's reference-style links and pictures name, by their normalized label. */
function referenced(node: Nodes): readonly string[] {
  const inner =
    "children" in node ? node.children.flatMap((child: Nodes) => referenced(child)) : [];

  return node.type === "linkReference" || node.type === "imageReference"
    ? [node.identifier, ...inner]
    : inner;
}

/**
 * The head of a description a screen draws first, at most
 * `DESCRIPTION_HEAD_MOST` characters, ending at a blank line where one
 * stands within it, so it cuts no paragraph; the whole where it is short.
 */
export function descriptionHead(text: string): string {
  if (text.length <= DESCRIPTION_HEAD_MOST) return text;
  const end = text.lastIndexOf("\n\n", DESCRIPTION_HEAD_MOST);

  return text.slice(0, end > 0 ? end : DESCRIPTION_HEAD_MOST);
}

/**
 * The description's blocks, in order: each top-level block but a link
 * definition, which draws nothing, with its span in `text`, the Markdown it
 * is drawn from, and its quote, cut to the longest quote a thread keeps.
 */
export function descriptionBlocks(text: string): readonly DescriptionBlock[] {
  return blocksIn(text, keptMarkdownTree(text));
}

/**
 * The blocks of the description's head (`descriptionHead`), as
 * `descriptionBlocks` reads them, each at its place in the whole: what a
 * page draws at once while the whole is parsed. Note that the head is parsed
 * on its own rather than kept, so it never pushes a whole document out of
 * the kept trees.
 */
export function descriptionHeadBlocks(text: string): readonly DescriptionBlock[] {
  const head = descriptionHead(text);

  return blocksIn(head, markdownTree(head));
}

/**
 * The blocks `tree`, the parse of `text` or of its first slices
 * (`markdown-slices.ts`), holds, as `descriptionBlocks` reads them: what a
 * page draws while the rest of a long description is read.
 */
export function descriptionBlocksIn(text: string, tree: Root): readonly DescriptionBlock[] {
  return blocksIn(text, tree);
}

/** The blocks `tree`, the parse of `text`, holds. */
function blocksIn(text: string, tree: Root): readonly DescriptionBlock[] {
  const nodes = tree.children;
  // Note that the parse counts offsets from after a leading byte-order mark, while the service counts them in the text as it is.
  const shift = text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK.length : 0;

  const spans = nodes.flatMap((node) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;

    return from === undefined || to === undefined
      ? []
      : [{ node, from: from + shift, to: to + shift }];
  });

  // Note that the first definition of a label is the one a link takes, as CommonMark reads it.
  const definitions = new Map<string, string>();

  for (const { node, from, to } of spans) {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, text.slice(from, to));
  }

  return spans
    .filter(({ node }) => node.type !== "definition")
    .map(({ node, from, to }) => {
      const quote =
        node.type === "html"
          ? ""
          : plainWords(node).trim().slice(0, DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS);

      // Note that a block carries only the definitions it names, so a long description is not drawn once over for every block.
      const used = [...new Set(referenced(node))].flatMap((label) => definitions.get(label) ?? []);
      const after = used.length === 0 ? "" : `\n\n${used.join("\n")}`;

      return { from, to, drawn: `${text.slice(from, to)}${after}`, quote: quote || undefined };
    });
}
