// notice-lift.ts -- how far above the window's foot the app's one notice stands: clear of the composer a screen pins there, as Mail and Messages stand Undo over their bars.

import { createContext, useContext, useEffect, useId } from "react";

/** What a bar at a screen's foot tells the notice: how tall it stands while it is drawn, and that it went. */
export interface NoticeLifts {
  readonly raise: (bar: string, room: number) => void;
  readonly drop: (bar: string) => void;
}

export const NoticeLift = createContext<NoticeLifts | undefined>(undefined);

/**
 * Tells the app's notice that a bar `room` points tall stands at the screen's
 * foot, above the bottom safe area, so the notice stands over it rather than
 * over the field under the reader's thumb, for as long as the bar is drawn.
 * Note that the bar drawn last wins, since it is the one in front; nothing is
 * told outside the notice's provider, as in a catalog's example.
 */
export function useNoticeLift(room: number): void {
  const lifts = useContext(NoticeLift);
  const bar = useId();

  // Note that a bar that grows tells its new height in its place, and is let go only once it is gone.
  useEffect(() => lifts?.raise(bar, room), [lifts, bar, room]);
  useEffect(() => () => lifts?.drop(bar), [lifts, bar]);
}
