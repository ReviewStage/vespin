// notice-lift.ts -- how far above the window's foot the app's one notice stands: clear of the composer the screen in front pins there, as Mail and Messages stand Undo over their bars.

import { createContext, useContext, useEffect, useId, useMemo, useState } from "react";

/** Where a bar at a screen's foot stands, which the notice stands over. */
export interface NoticeLift {
  /** How tall the bar stands with its gap, in points: what the notice stands over where the bar rides the keyboard, or where nothing measured it in the window. */
  readonly room: number;
  /** How far the bar's top, with its gap, stands above the window's foot, measured with the keyboard down, in points; none until measured. It counts a tab bar the bar stands over, which its room alone does not. */
  readonly foot?: number | undefined;
}

/** A place the notice is drawn, the app's root or a sheet, and the bars standing in front in it. */
interface NoticeLifts {
  readonly raise: (bar: string, lift: NoticeLift) => void;
  readonly drop: (bar: string) => void;
}

const LiftBars = createContext<NoticeLifts | undefined>(undefined);

/** A place's bars, and the one in front, which its notice stands over. */
interface LiftBarsHeld {
  readonly bars: NoticeLifts;
  readonly lift: NoticeLift | undefined;
}

/**
 * The bars a place holds, for its notice to stand over: the one raised last
 * is the one in front, since a screen that comes forward raises its bar
 * again. A bar that grows keeps its place, and one that goes behind drops.
 */
export function useLiftBars(): LiftBarsHeld {
  const [raised, setRaised] = useState<ReadonlyArray<readonly [string, NoticeLift]>>([]);

  const bars = useMemo<NoticeLifts>(
    () => ({
      raise: (bar, lift) =>
        setRaised((were) =>
          were.some(([was]) => was === bar)
            ? were.map((was) => (was[0] === bar ? ([bar, lift] as const) : was))
            : [...were, [bar, lift] as const],
        ),
      drop: (bar) => setRaised((were) => were.filter(([was]) => was !== bar)),
    }),
    [],
  );

  return { bars, lift: raised.at(-1)?.[1] };
}

/** Hands a place's bars to the screens drawn in it, so a sheet's notice hears only the bars drawn in the sheet. */
export const LiftBarsProvider = LiftBars.Provider;

/**
 * Tells the notice of the place it is drawn in that a bar stands at the
 * screen's foot, so the notice stands over it rather than over the field
 * under the reader's thumb, while `shown` holds: while its screen is the one
 * in front. Note that a screen a page was pushed over, a tab not shown, or a
 * column kept behind the one shown stays drawn, so its bar says it is not
 * shown rather than leaving the notice over nothing; nothing is told outside
 * the notice's provider, as in a catalog's example.
 */
export function useNoticeLift(lift: NoticeLift, shown: boolean): void {
  const bars = useContext(LiftBars);
  const bar = useId();
  const { room, foot } = lift;

  useEffect(() => {
    if (bars === undefined) return;

    if (shown) bars.raise(bar, { room, foot });
    else bars.drop(bar);
  }, [bars, bar, shown, room, foot]);
  useEffect(() => () => bars?.drop(bar), [bars, bar]);
}
