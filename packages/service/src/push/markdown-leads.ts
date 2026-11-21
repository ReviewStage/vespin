// markdown-leads.ts -- Markdown cut short only where a block ends, so a cut never leaves a mark open: as a notification carries a post's words within Apple's bound.

import { markdownTree } from "@repo/features/markdown-tree";

/**
 * What a lead drops from its start: blank lines, and an indent under four
 * spaces, which means nothing. Note that four or more stay, since they make
 * the first block code.
 */
const LEADING_SPACE = /^(?:[ \t]*\r?\n)*(?: {0,3}(?=\S))?/u;

/**
 * Each way to keep the Markdown's start whole: the words through its first
 * block, through its second, and so on to the whole, shortest first, with no
 * blank line or idle indent before them and no space after. Note that a cut
 * stands only where a top-level block ends, never inside one, since a cut
 * inside a paragraph could leave `**` or a link's `[` open, which a reader
 * would draw as stray marks.
 */
export function markdownLeads(text: string): readonly string[] {
  const start = LEADING_SPACE.exec(text)?.[0].length ?? 0;

  return markdownTree(text).children.flatMap((block) => {
    const end = block.position?.end.offset;
    const lead = end === undefined || end <= start ? "" : text.slice(start, end).trimEnd();

    return lead === "" ? [] : [lead];
  });
}
