/**
 * use-whole-description.ts -- whether a task page draws its whole description yet: at once where it is short or its parse is kept, and otherwise just after the page first draws its head.
 *
 * A long description's parse took seconds on a phone (a 175 KB one held the
 * task page's first draw about 1.6 s on the iPhone simulator), so the page
 * draws the description's head first (`descriptionHeadBlocks`) and parses
 * the whole one turn later, keeping its tree (`keptMarkdownTree`) for the
 * blocks, the pictures, the links and the edit sheet to share.
 */

import { DESCRIPTION_HEAD_MOST } from "@repo/features/description-blocks";
import { keptMarkdownTree, markdownTreeKept } from "@repo/features/markdown-tree";
import { useEffect, useState } from "react";

/** Whether `body` is drawn whole yet, its whole parse begun just after the head first draws. */
export function useWholeDescription(body: string): boolean {
  // The body whose whole parse has landed.
  const [parsed, setParsed] = useState<string | undefined>(undefined);
  const whole = parsed === body || body.length <= DESCRIPTION_HEAD_MOST || markdownTreeKept(body);

  useEffect(() => {
    if (whole) return;

    // Note that the parse waits a turn, so the head the page drew reaches the screen before it.
    const timer = setTimeout(() => {
      keptMarkdownTree(body);
      setParsed(body);
    }, 0);

    return () => clearTimeout(timer);
  }, [body, whole]);

  return whole;
}
