// split-route.ts -- a tab's selection kept in its root route, so a link, a notification, or a fold lands on the item beside its list or pushed over it, as the window allows.

import { iosRouteOnTab, iosRouteTab } from "@repo/features/ios-app-links";
import { useWindowSizeClass, WINDOW_SIZE_CLASS } from "@repo/ui-native";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { showPickedPage } from "./split-columns.js";
import { useOwnTab } from "./tab-route.js";

/** A tab whose root stands a split view in a regular window, by its root route. */
export const SPLIT_TAB = {
  INBOX: "/inbox",
  TASKS: "/tasks",
} as const;

export type SplitTab = (typeof SPLIT_TAB)[keyof typeof SPLIT_TAB];

/** An item's pushed route on its own tab's stack. */
function itemRoute(tab: SplitTab, id: string): string {
  return iosRouteOnTab(`${tab}/${encodeURIComponent(id)}`, undefined);
}

/** Each tab's item as its root last selected it, beside its list. */
const picked = new Map<SplitTab, string>();

/** Who hears a tab's pick change, such as an iPad's sidebar, which stands the picked task selected. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function told(): void {
  for (const listener of listeners) listener();
}

/** Keeps a tab's pick, or lets it go, telling whoever hears it. */
function keepPick(tab: SplitTab, id: string | undefined): void {
  if (picked.get(tab) === id) return;

  if (id === undefined) picked.delete(tab);
  else picked.set(tab, id);

  told();
}

/** The item a tab's root last picked beside its list, as an iPad's sidebar stands it selected; none while its whole list stands. */
export function useSplitPicked(tab: SplitTab): string | undefined {
  return useSyncExternalStore(subscribe, () => picked.get(tab));
}

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
  const navigation = useNavigation();
  const [held, hold] = useState<HeldPick | undefined>(undefined);
  const routed = selected ?? (regular ? picked.get(tab) : undefined);

  // Note that a moved route drops the hold outright, so a later return to the selection it was made over can't raise it again.
  useEffect(() => hold(undefined), [routed]);

  useEffect(() => {
    if (regular && selected !== undefined) keepPick(tab, selected);
  }, [regular, selected, tab]);

  // Note that the root hears its focus through an effect rather than reading it, because a read draws the root and its whole list again on every tab switch and every page pushed over it or popped.
  useFocusEffect(
    useCallback(() => {
      if (regular) return;

      // Note that the item shown beside the list may be the tab's last pick rather than the param, so a fold pushes that one.
      const shown = selected ?? picked.get(tab);

      if (shown === undefined) return;
      // Note that the item now stands pushed over the list, so the tab no longer holds it beside the list.
      keepPick(tab, undefined);

      if (selected !== undefined) router.setParams({ selected: undefined });
      router.push(itemRoute(tab, shown));
    }, [regular, selected, router, tab]),
  );

  return {
    selected: held !== undefined && held.over === routed ? held.id : routed,
    select: (id) => {
      hold({ id, over: routed });
      keepPick(tab, id);

      // Note that a pick from an iPad's list column under a page pushed over the root goes back to the root, as Mail's message list replaces the message, because the list stands beside every page of its place.
      if (navigation.isFocused()) router.setParams({ selected: id });
      else router.dismissTo({ pathname: tab, params: { selected: id } });

      showPickedPage();
    },
  };
}

/**
 * Whether an item's pushed route stands aside for its tab's split view. In a
 * regular window it hands its item back to the tab's root, which selects it
 * beside the list, rather than covering the list with a page of its own, so
 * a link, a notification, an unfold, or a related task opened from a page
 * lands where a tap on the list would. Nothing is handed while `id` is none,
 * as while a task a link names by number is still found. Note that an item
 * pushed onto another tab's stack, as a compact window opens a thread's task
 * on the Inbox's, stays a page there once the window turns regular, as an
 * agent's page does, because that tab's root has no list to select it in.
 * Note that only the screen in front hands over, as `useSplitSelection`
 * pushes only from it, because the hand-off pops every page above the root:
 * an unfold under a page pushed over this one, or under a sheet, would close
 * them and drop their drafts. A screen behind hands over once it next comes
 * in front, and keeps drawing until it does.
 */
export function useHandToSplit(tab: SplitTab, id: string | undefined): boolean {
  const router = useRouter();
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const own = useOwnTab();
  const handing = regular && (own === undefined || own === iosRouteTab(tab));

  // Note that the hand-off runs as a focus effect rather than on a read of focus, as the roots hear theirs (#9516), so a screen behind never redraws on a page pushed over it or popped.
  useFocusEffect(
    useCallback(() => {
      if (handing && id !== undefined)
        router.dismissTo({ pathname: tab, params: { selected: id } });
    }, [handing, router, tab, id]),
  );

  return handing;
}
