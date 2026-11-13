// sidebar-shown.ts -- whether a regular window's first column stands beside its other columns, one answer for every tab's split view and the menu bar's Show or Hide Sidebar.

import { useThreeColumns } from "@repo/ui-native";
import { useSyncExternalStore } from "react";

/** A person's choice, held with the window it was made in, so it lapses once the window stands a different number of columns. */
type Choice = { readonly threeColumns: boolean; readonly shown: boolean };

/** The choice standing, for this launch. */
let held: Choice | undefined;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function choose(choice: Choice): void {
  held = choice;

  for (const listener of listeners) listener();
}

type UseSidebarShownResult = {
  readonly shown: boolean;
  readonly setShown: (shown: boolean) => void;
  readonly toggle: () => void;
};

/**
 * Whether a regular window's first column stands, the app sidebar in a
 * window wide enough for three columns or the list in a narrower one, and
 * how to show, hide, or toggle it. It stands until a person hides it, with
 * the system's sidebar button, a swipe, or the menu bar, and that choice
 * holds across the tabs, since every tab's split view reads this one
 * answer, until the window is resized past three columns or back.
 */
export function useSidebarShown(): UseSidebarShownResult {
  const threeColumns = useThreeColumns();
  const choice = useSyncExternalStore(subscribe, () => held);
  const shown = choice?.threeColumns === threeColumns ? choice.shown : true;
  const setShown = (next: boolean) => choose({ threeColumns, shown: next });

  return { shown, setShown, toggle: () => setShown(!shown) };
}
