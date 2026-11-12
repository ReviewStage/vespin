// split-route.ts -- a tab's selection kept in its root route, so a link, a notification, or a fold lands on the item beside its list or pushed over it, as the window allows.

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { useWindowSizeClass } from "./use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "./window-size-class.js";

/** A tab whose root stands a split view in a regular window, by its root route. */
export const SPLIT_TAB = {
  INBOX: "/inbox",
  TASKS: "/tasks",
} as const;

export type SplitTab = (typeof SPLIT_TAB)[keyof typeof SPLIT_TAB];

/** An item's pushed route under its tab. */
function itemRoute(tab: SplitTab, id: string): string {
  return `${tab}/${encodeURIComponent(id)}`;
}

/**
 * The item a tab's root has selected, kept in the root route's `selected`
 * param rather than in the screen's state, so a route that names an item can
 * hand it over. Note that a compact window pushes a selection a regular one
 * left, because folding the iPhone Duo with a thread open beside the list
 * should keep that thread open, now over the list.
 */
export function useSplitSelection(tab: SplitTab): {
  readonly selected: string | undefined;
  readonly select: (id: string) => void;
} {
  const router = useRouter();
  const { selected } = useLocalSearchParams<{ selected?: string }>();
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  useEffect(() => {
    if (regular || selected === undefined) return;
    router.setParams({ selected: undefined });
    router.push(itemRoute(tab, selected));
  }, [regular, selected, router, tab]);

  return { selected, select: (id) => router.setParams({ selected: id }) };
}

/**
 * Whether an item's pushed route stands aside for its tab's split view. In a
 * regular window it hands its item back to the tab's root, which selects it
 * beside the list, rather than covering the list with a page of its own, so
 * a link, a notification, an unfold, or a related task opened from a page
 * lands where a tap on the list would.
 */
export function useHandToSplit(tab: SplitTab, id: string): boolean {
  const router = useRouter();
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  useEffect(() => {
    if (regular) router.dismissTo({ pathname: tab, params: { selected: id } });
  }, [regular, router, tab, id]);

  return regular;
}
