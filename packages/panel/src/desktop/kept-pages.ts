/**
 * kept-pages.ts -- the page tabs a side panel keeps drawn, hidden, while another tab is shown, so a return finds each page as it was left.
 *
 * A page is HTML an agent wrote, drawn in a frame sandboxed with no storage,
 * so all it holds (a table sorted, a chart filtered, a mockup stepped on)
 * lives in that frame's document, and a frame taken out of the window loads
 * its page afresh. The panel therefore keeps the page tabs it last showed
 * drawn beside the tab it shows, each hidden under React's `Activity` while
 * another tab is shown, at most `KEPT_PAGES` of them, the one shown longest
 * ago let go first. Note that they are drawn in the order they were first
 * kept, never the order they were last shown, because a frame moved in the
 * document reloads as surely as one taken out.
 */

import { type PageStripTab, sameTab } from "@repo/ui/tab-strip-model";

/** How many page tabs a panel keeps drawn, the one shown among them: a page kept runs on while hidden, so a few. */
export const KEPT_PAGES = 3;

/** A page tab kept drawn, and when it was last shown, by the panel's count of shows. */
export interface KeptPage {
  readonly tab: PageStripTab;
  readonly shown: number;
}

/**
 * The page tabs kept after a draw, in the order they were first kept: those
 * still open, the one shown now (`shown`) marked shown last, and past
 * `KEPT_PAGES` the one shown longest ago let go; `kept` itself where nothing
 * changed, so a panel can hold the answer as its state.
 */
export function keptPagesAfter(
  kept: readonly KeptPage[],
  open: readonly PageStripTab[],
  shown: PageStripTab | undefined,
): readonly KeptPage[] {
  const standing = kept.filter((each) => open.some((tab) => sameTab(tab, each.tab)));
  const latest = Math.max(0, ...standing.map((each) => each.shown));
  const at = standing.findIndex((each) => sameTab(each.tab, shown));
  let next = standing;

  if (shown !== undefined && at === -1) next = [...standing, { tab: shown, shown: latest + 1 }];
  else if (at !== -1 && standing[at]?.shown !== latest) {
    next = standing.map((each, index) => (index === at ? { ...each, shown: latest + 1 } : each));
  }

  // Note that the page shown is the one shown last, so it is never the one let go.
  if (next.length > KEPT_PAGES) {
    const oldest = Math.min(...next.map((each) => each.shown));
    next = next.filter((each) => each.shown !== oldest);
  }

  const unchanged =
    next.length === kept.length && next.every((each, index) => each === kept[index]);

  return unchanged ? kept : next;
}
