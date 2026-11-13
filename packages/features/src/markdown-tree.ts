// markdown-tree.ts -- Markdown read as its tree, in GitHub's dialect: the one parse every place that reads or draws a message's words without the panel's renderer shares, the iOS app's renderer among them.

import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** How many trees are kept: enough for a task's description and each of its blocks, or a thread's messages, with room to come back to the last few. */
const KEPT_TREES = 128;

/** The trees read lately, by their words, the one read longest ago first. */
const kept = new Map<string, Root>();

/**
 * Markdown read as its tree, each node with its place in the words: tables,
 * strikethrough, task lists, and autolinks, as the panel's renderer reads a
 * note (`@repo/ui`'s `markdown.tsx`). Note that a single tilde is left as the
 * character it is, as the panel leaves it, so two home-directory paths in one
 * sentence do not strike the words between them.
 *
 * The same words answer the same tree, which every reader shares, so a
 * reader must never change it. Note that we keep the last trees read,
 * because one page reads the same words several times (its blocks, its
 * pictures, its chips' pages, its suggestions), and on Hermes each parse of a
 * description costs tens of milliseconds on the tap that opens it.
 */
export function markdownTree(text: string): Root {
  const held = kept.get(text);

  // Note that a tree read again moves to the newest end, so the one let go is the one read longest ago.
  if (held !== undefined) {
    kept.delete(text);
    kept.set(text, held);

    return held;
  }

  const tree = fromMarkdown(text, {
    extensions: [gfm({ singleTilde: false })],
    mdastExtensions: [gfmFromMarkdown()],
  });

  kept.set(text, tree);
  const oldest = kept.size > KEPT_TREES ? kept.keys().next() : undefined;

  if (oldest !== undefined && oldest.done !== true) kept.delete(oldest.value);

  return tree;
}
