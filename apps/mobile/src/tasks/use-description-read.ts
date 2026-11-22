/**
 * use-description-read.ts -- a task page's description blocks as its parse lands: whole at once where it is short or its parse is kept, and otherwise its head first, then slice by slice, so no one parse holds the thread.
 *
 * A long description's parse took seconds on a phone (a 175 KB one held the
 * task page's first draw about 1.6 s on the iPhone simulator, and its whole
 * parse a turn later about 1.5 s more), so the page draws the description's
 * head first (`descriptionHeadBlocks`), then parses it a slice at a time
 * between frames (`markdownSliceStarts`), drawing each slice's blocks as it
 * lands. The joined tree is kept (`keepMarkdownTree`) for the pictures, the
 * links and the edit sheet to share. A description that may not be cut is
 * one slice, parsed whole a turn after its head.
 */

import {
  DESCRIPTION_HEAD_MOST,
  type DescriptionBlock,
  descriptionBlocks,
  descriptionBlocksIn,
  descriptionHeadBlocks,
} from "@repo/features/description-blocks";
import {
  joinedMarkdownTree,
  markdownSliceStarts,
  markdownSliceTree,
} from "@repo/features/markdown-slices";
import { keepMarkdownTree, markdownTreeKept } from "@repo/features/markdown-tree";
import { useEffect, useMemo, useState } from "react";

/** How long one turn parses slices before it gives the thread back: about a frame and a half. */
const TURN_MOST_MS = 24;

/** How often the slices parsed so far are drawn, so the page redraws a few times a second rather than every turn. */
const DRAW_EVERY_MS = 150;

/** One slice's tree, its nodes placed in the whole body. */
type SliceTree = ReturnType<typeof markdownSliceTree>;

const NO_SLICES: readonly SliceTree[] = [];

/** The slices of one body parsed so far, in order. */
interface Landed {
  readonly body: string;
  readonly slices: readonly SliceTree[];
}

/** What a task page draws of its description: its blocks so far, and whether they are the whole. */
export interface DescriptionRead {
  readonly blocks: readonly DescriptionBlock[];
  readonly whole: boolean;
}

/** `body`'s blocks as its parse lands, its head first where it is long. */
export function useDescriptionRead(body: string): DescriptionRead {
  const [landed, setLanded] = useState<Landed | undefined>(undefined);
  const short = body.length <= DESCRIPTION_HEAD_MOST || markdownTreeKept(body);
  const starts = useMemo(() => (short ? [0] : markdownSliceStarts(body)), [body, short]);
  const slices = landed?.body === body ? landed.slices : NO_SLICES;
  const whole = short || slices.length === starts.length;

  const blocks = useMemo(() => {
    if (whole) return descriptionBlocks(body);

    if (slices.length === 0) return descriptionHeadBlocks(body);

    // Note that the slices landed so far are a prefix of the body, each node already placed in the whole.
    const landedText = body.slice(0, starts[slices.length]);

    return descriptionBlocksIn(landedText, joinedMarkdownTree(slices, landedText));
  }, [body, whole, slices, starts]);

  useEffect(() => {
    if (whole) return;
    const parsed = [...slices];
    const began = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Note that each turn waits on a timer, so the blocks the page drew reach the screen before it.
    const turn = () => {
      const turnBegan = Date.now();

      while (parsed.length < starts.length && Date.now() - turnBegan < TURN_MOST_MS) {
        const from = starts[parsed.length] ?? body.length;
        parsed.push(markdownSliceTree(body, from, starts[parsed.length + 1] ?? body.length));
      }

      if (parsed.length === starts.length) {
        keepMarkdownTree(body, joinedMarkdownTree(parsed, body));
        setLanded({ body, slices: parsed });
      } else if (Date.now() - began >= DRAW_EVERY_MS) {
        setLanded({ body, slices: parsed });
      } else {
        timer = setTimeout(turn, 0);
      }
    };

    timer = setTimeout(turn, 0);

    return () => clearTimeout(timer);
  }, [body, whole, slices, starts]);

  return { blocks, whole };
}
