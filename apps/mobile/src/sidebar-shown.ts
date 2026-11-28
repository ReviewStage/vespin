// sidebar-shown.ts -- whether a regular window's list stands beside its detail, one answer for every tab's split view and the menu bar's Show or Hide Sidebar.

import { useWindowSizeClass, WINDOW_SIZE_CLASS } from "@repo/ui-native";
import { useEffect, useSyncExternalStore } from "react";
import { Platform, useWindowDimensions } from "react-native";

/**
 * Whether the app stands its own sidebar, the first column of the system's
 * split view at the root, as the panel's sidebar stands: on an iPad, read by
 * the device's idiom rather than the window, so nothing mounts again as the
 * window turns or resizes. The unfolded iPhone Duo keeps the system's tab
 * sidebar instead.
 */
export const APP_SIDEBAR = Platform.OS === "ios" && Platform.isPad;

/**
 * A person's choice, held with the window's shape it was made in, so a turn
 * from landscape to portrait or back lets it lapse; none until they make one.
 * Note that a portrait iPad's split view folds its list on its own, which it
 * reports as hidden, and without the shape that fold stood as the person's
 * choice once the window turned back to landscape.
 */
type Choice = { readonly landscape: boolean; readonly shown: boolean };

let held: Choice | undefined;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function choose(choice: Choice | undefined): void {
  held = choice;

  for (const listener of listeners) listener();
}

type UseSidebarShownResult = {
  readonly shown: boolean;
  readonly setShown: (shown: boolean) => void;
  readonly toggle: () => void;
};

/**
 * Whether a regular window's list stands beside its detail, and how to
 * show, hide, or toggle it. It stands until a person hides it, with the
 * system's sidebar button, a swipe, or the menu bar, and that choice holds
 * across the tabs, since every tab's split view reads this one answer,
 * until the window turns to the other orientation or compact
 * (`useSidebarChoiceLapse`).
 */
export function useSidebarShown(): UseSidebarShownResult {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const choice = useSyncExternalStore(subscribe, () => held);
  const shown = choice?.landscape === landscape ? choice.shown : true;
  const setShown = (next: boolean) => choose({ landscape, shown: next });

  return { shown, setShown, toggle: () => setShown(!shown) };
}

/**
 * Lets the list's choice lapse once the window turns compact, as a fold or
 * a narrow Split View does, so a list hidden before a fold stands again
 * after it. Called by the tabs layout, which stands in every window, since
 * no split view is drawn while the window is compact.
 */
export function useSidebarChoiceLapse(): void {
  const compact = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;

  useEffect(() => {
    if (compact && held !== undefined) choose(undefined);
  }, [compact]);
}
