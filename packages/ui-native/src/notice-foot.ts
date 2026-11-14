// notice-foot.ts -- how high the app's one notice stands over the window's foot: above the topmost of whatever stands there, a tab bar, a composer, or the keyboard it rides.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** How high the system's floating tab bar reaches over the bottom safe area in a compact window, in points, as iOS 26 draws its glass bar and the gap under it. */
const TAB_BAR_ROOM = 56;

/** Each piece standing at the window's foot, by a key of its own, with how high its top stands over the window's bottom edge, in points. */
const rooms = new Map<symbol, number>();
const listeners = new Set<() => void>();

/** The highest a piece at the foot stands, read again whenever one comes, goes, or moves. */
let topmost = 0;

function changed(): void {
  topmost = Math.max(0, ...rooms.values());

  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/**
 * Says how high a piece standing at the window's foot reaches over its
 * bottom edge, while it stands: a tab bar, a composer's dock with the
 * keyboard under it, or a split view's composer at its column's foot. None
 * for a piece that stands there no longer, such as a tab bar a conversation
 * hid.
 */
export function useNoticeFoot(height: number | undefined): void {
  const [key] = useState(() => Symbol("notice-foot"));

  useEffect(() => {
    if (height === undefined) return;

    rooms.set(key, height);
    changed();

    return () => {
      rooms.delete(key);
      changed();
    };
  }, [key, height]);
}

/** How high the topmost piece at the window's foot reaches over its bottom edge, which the notice stands just above; none while nothing stands there. */
export function useNoticeFootRoom(): number {
  return useSyncExternalStore(subscribe, () => topmost);
}

/** Says the system's tab bar stands at the window's foot, while `shown`, so the app's notice stands above it rather than over it. */
export function useTabBarNoticeFoot(shown: boolean): void {
  const { bottom } = useSafeAreaInsets();
  useNoticeFoot(shown ? bottom + TAB_BAR_ROOM : undefined);
}
