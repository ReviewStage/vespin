import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { LIST_VARIANT, List, ListRow } from "../list-row/list-row.js";
import { Menu, type MenuEntry, useMenu } from "../menu/menu.js";
import { splitBarFit } from "./split-bar-model.js";

/**
 * split-bar.tsx -- one bar split into equal segments, one for each thing it names, the ones that do not fit folded into a last segment naming how many, whose press lists them.
 *
 * A bar of one thing is its owner's to draw as a whole row; a bar of more
 * splits into equal segments, each a card of one row the owner draws
 * (`segment`), in the order it hands them. Every segment stands at least
 * `floor` wide, so a narrow bar shows fewer of them rather than cutting
 * each to nothing: those that do not fit fold into one last segment, at
 * its own width so its words are never cut, naming how many it holds,
 * whose press drops a menu of them, each entry the owner's
 * (`more.entries`). The owner is told whether each segment has room for a
 * row's metadata beside its words (`roomy`), from `roomy` wide.
 *
 * The floor and the roomy width are in the bar's own type size (`em`), so
 * a larger type keeps as many letters legible; the gap is the stylesheet's.
 * The bar is measured in the layout effect after each render and again as
 * it is resized, so it folds before it is painted.
 */

/** What the segment naming the folded things is drawn from. */
export interface SplitBarMore<Item> {
  /** Its glyph, leading its words. */
  readonly icon: ReactNode;
  /** Its words for how many it holds ("3 more"). */
  readonly words: (count: number) => string;
  /** What its menu lists, which names the menu. */
  readonly label: string;
  /** The menu's entries, one for each folded thing. */
  readonly entries: (folded: readonly Item[]) => readonly MenuEntry[];
}

/** The narrowest a segment stands, in the bar's type size: a glyph, a number, and a few letters. */
const SEGMENT_FLOOR_EM = 9;

/** The room the folded segment is reckoned at before it has been measured, in the bar's type size. */
const MORE_GUESS_EM = 7;

/** The type size a bar is reckoned in where its own cannot be read: the browser's default. */
const DEFAULT_EM = 16;

/** How wide the bar is, and how wide its parts are, as last measured. */
interface Measured {
  readonly width: number;
  readonly em: number;
  readonly gap: number;
  readonly more: number | undefined;
}

/** The bar's measures as they stand: its width, its type size, its gap, and the folded segment's width where one is drawn. */
function measure(bar: HTMLElement, more: HTMLElement | null): Measured {
  const style = getComputedStyle(bar);
  return {
    width: bar.clientWidth,
    em: Number.parseFloat(style.fontSize) || DEFAULT_EM,
    gap: Number.parseFloat(style.columnGap) || 0,
    more: more?.offsetWidth,
  };
}

/** Whether two measures stand alike, so a render that changed nothing measured stops. */
function sameMeasure(a: Measured, b: Measured): boolean {
  return a.width === b.width && a.em === b.em && a.gap === b.gap && a.more === b.more;
}

/** The segment naming the folded things, whose press drops a menu of them. */
function MoreSegment<Item>({
  folded,
  more,
  measured,
}: {
  folded: readonly Item[];
  more: SplitBarMore<Item>;
  measured: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const menu = useMenu(true);
  const trigger = menu.trigger();
  return (
    <div ref={measured} className="ui-split-bar-more">
      <List label={more.label} variant={LIST_VARIANT.CARD}>
        <ListRow
          leading={more.icon}
          title={more.words(folded.length)}
          onPress={(event) => trigger.onClick(event)}
          more={false}
        />
      </List>
      {menu.drawn === undefined ? null : (
        <Menu
          menu={menu.drawn}
          label={more.label}
          groups={[more.entries(folded)]}
          onClose={menu.close}
          replayUnmasked
        />
      )}
    </div>
  );
}

/** Things split into a bar of equal segments, those that do not fit its width folded into one that names them. */
export function SplitBar<Item>({
  label,
  items,
  keyOf,
  segment,
  more,
  roomy,
}: {
  /** What each segment is, which names its card. */
  label: string;
  items: readonly Item[];
  /** What tells one thing from the others, as a list's key. */
  keyOf: (item: Item) => string;
  /** Draws one thing's row (`ListRow`), told whether its segment has room for the row's metadata. */
  segment: (item: Item, roomy: boolean) => ReactNode;
  more: SplitBarMore<Item>;
  /** The width, in the bar's type size, from which a segment has room for its row's metadata. */
  roomy: number;
}): React.JSX.Element {
  const bar = useRef<HTMLDivElement | null>(null);
  const moreSegment = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<Measured | undefined>(undefined);
  const settle = useRef(() => {
    const element = bar.current;
    if (element === null) return;
    const next = measure(element, moreSegment.current);
    setMeasured((was) => (was !== undefined && sameMeasure(was, next) ? was : next));
  });
  // Note that every render measures again, since the folded segment's width moves with its count.
  useLayoutEffect(() => settle.current());
  useLayoutEffect(() => {
    const element = bar.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => settle.current());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const em = measured?.em ?? DEFAULT_EM;
  const fit = splitBarFit({
    width: measured?.width ?? Number.POSITIVE_INFINITY,
    count: items.length,
    floor: SEGMENT_FLOOR_EM * em,
    gap: measured?.gap ?? 0,
    more: measured?.more ?? MORE_GUESS_EM * em,
  });
  const shownRoomy = fit.segment >= roomy * em;
  return (
    <div ref={bar} className="ui-split-bar">
      {items.slice(0, fit.shown).map((item) => (
        <div key={keyOf(item)} className="ui-split-bar-segment">
          <List label={label} variant={LIST_VARIANT.CARD}>
            {segment(item, shownRoomy)}
          </List>
        </div>
      ))}
      {fit.shown < items.length ? (
        <MoreSegment folded={items.slice(fit.shown)} more={more} measured={moreSegment} />
      ) : null}
    </div>
  );
}
