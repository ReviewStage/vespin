// split-route.ts -- a tab's selection kept in its root route, so a link, a notification, or a fold lands on the item beside its list or pushed over it, as the window allows.

import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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

/** Each tab's item as its root last selected it, beside its list. */
const picked = new Map<SplitTab, string>();

/** An item just picked from the list, and the selection the route held when it was. */
type HeldPick = { readonly id: string; readonly over: string | undefined };

type UseSplitSelectionResult = {
  readonly selected: string | undefined;
  readonly select: (id: string) => void;
};

/**
 * The item a tab's root has selected, kept in the root route's `selected`
 * param rather than in the screen's state, so a route that names an item can
 * hand it over. Note that a compact window pushes a selection a regular one
 * left, because folding the iPhone Duo with a thread open beside the list
 * should keep that thread open, now over the list. Note that a regular
 * window falls back on the item the tab last selected while the route names
 * none, because a page pushed over the tabs' split view and gone back from
 * (Back or a swipe) can hand the root back without its param, and the tab
 * should stand as it was left, as it does after a tab switch. A window
 * turning compact pushes that item too, as it pushes the param's, but only
 * from the tab in front, so a tab behind keeps its item until it is shown.
 * Note that a pick stands selected at once, until the route's own selection
 * moves, because the route answers a few renders later, which iPadOS 26
 * drew as most of a second.
 */
export function useSplitSelection(tab: SplitTab): UseSplitSelectionResult {
  const router = useRouter();
  const { selected } = useLocalSearchParams<{ selected?: string }>();
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const focused = useIsFocused();
  const [held, hold] = useState<HeldPick | undefined>(undefined);
  const routed = selected ?? (regular ? picked.get(tab) : undefined);

  // Note that a moved route drops the hold outright, so a later return to the selection it was made over can't raise it again.
  useEffect(() => hold(undefined), [routed]);

  useEffect(() => {
    if (regular) {
      if (selected !== undefined) picked.set(tab, selected);

      return;
    }

    if (!focused) return;

    // Note that the item shown beside the list may be the tab's last pick rather than the param, so a fold pushes that one.
    const shown = selected ?? picked.get(tab);

    if (shown === undefined) return;
    // Note that the item now stands pushed over the list, so the tab no longer holds it beside the list.
    picked.delete(tab);

    if (selected !== undefined) router.setParams({ selected: undefined });
    router.push(itemRoute(tab, shown));
  }, [regular, focused, selected, router, tab]);

  return {
    selected: held !== undefined && held.over === routed ? held.id : routed,
    select: (id) => {
      hold({ id, over: routed });
      picked.set(tab, id);
      router.setParams({ selected: id });
    },
  };
}

/**
 * Whether an item's pushed route stands aside for its tab's split view. In a
 * regular window it hands its item back to the tab's root, which selects it
 * beside the list, rather than covering the list with a page of its own, so
 * a link, a notification, an unfold, or a related task opened from a page
 * lands where a tap on the list would. Nothing is handed while `id` is none,
 * as while a task a link names by number is still found.
 */
export function useHandToSplit(tab: SplitTab, id: string | undefined): boolean {
  const router = useRouter();
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  useEffect(() => {
    if (regular && id !== undefined) router.dismissTo({ pathname: tab, params: { selected: id } });
  }, [regular, router, tab, id]);

  return regular;
}
