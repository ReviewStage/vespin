// markdown-tree.ts -- Markdown read as its tree, in GitHub's dialect: the one parse every place that reads or draws a message's words without the panel's renderer shares, the iOS app's renderer among them.

import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/**
 * Markdown read as its tree, each node with its place in the words: tables,
 * strikethrough, task lists, and autolinks, as the panel's renderer reads a
 * note (`@repo/ui`'s `markdown.tsx`). Note that a single tilde is left as the
 * character it is, as the panel leaves it, so two home-directory paths in one
 * sentence do not strike the words between them.
 */
export function markdownTree(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm({ singleTilde: false })],
    mdastExtensions: [gfmFromMarkdown()],
  });
}
