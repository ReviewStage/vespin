// markdown-tree.ts -- Markdown read as its tree, in GitHub's dialect: the one parse every place that reads or draws a message's words without the panel's renderer shares, the iOS app's renderer among them.

import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** How many of the latest documents' trees are kept, so a page and the sheet it opens share one parse. */
const KEPT_MOST = 4;

/** The latest documents' trees, the newest read last. */
const KEPT = new Map<string, Root>();

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

/** Whether the tree of the document `text` is kept, so `keptMarkdownTree` hands it back with no parse. */
export function markdownTreeKept(text: string): boolean {
  return KEPT.has(text);
}

/**
 * A whole document read as `markdownTree` reads it, the trees of the latest
 * few kept, so a document read again, such as a task's description its page
 * drew and its edit sheet opens on, is parsed once: a long description's
 * parse is most of its open. Note that only whole documents are kept here,
 * so the many short words a page also draws never push its document out. A
 * tree handed back is shared, so no caller changes it.
 */
export function keptMarkdownTree(text: string): Root {
  const kept = KEPT.get(text);

  if (kept !== undefined) {
    // Note that a tree read again moves to the newest end, so the oldest is the one let go.
    KEPT.delete(text);
    KEPT.set(text, kept);

    return kept;
  }

  const tree = markdownTree(text);
  KEPT.set(text, tree);
  const oldest = KEPT.size > KEPT_MOST ? KEPT.keys().next().value : undefined;

  if (oldest !== undefined) KEPT.delete(oldest);

  return tree;
}
