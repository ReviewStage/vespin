// markdown-leads.ts -- Markdown cut short only where a block ends, so a cut never leaves a mark open: as a notification carries a post's words within Apple's bound.

import { markdownTree } from "./markdown-tree.js";

/**
 * Each way to keep the Markdown's start whole: the words through its first
 * block, through its second, and so on to the whole, shortest first, each
 * trimmed. Note that a cut stands only where a top-level block ends, never
 * inside one, since a cut inside a paragraph could leave `**` or a link's
 * `[` open, which a reader would draw as stray marks.
 */
export function markdownLeads(text: string): readonly string[] {
  return markdownTree(text).children.flatMap((block) => {
    const end = block.position?.end.offset;
    const lead = end === undefined ? "" : text.slice(0, end).trim();

    return lead === "" ? [] : [lead];
  });
}
