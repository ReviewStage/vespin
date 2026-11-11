// sidebar-shown.ts -- whether a regular window's app sidebar stands beside its other columns, one answer for every tab's split view and the menu bar's Show or Hide Sidebar.

import { useSyncExternalStore } from "react";
import { useThreeColumns } from "./use-window-size-class.js";

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

/**
 * Whether the app sidebar stands, and how to show, hide, or toggle it. By
 * default it stands where the window is wide enough for three columns, as an
 * iPad's in landscape, and waits behind the system's sidebar button in a
 * narrower regular window, as Mail's does, so the list and the page keep the
 * room. A person's choice, with that button, a swipe, or the menu bar, holds
 * across the tabs, since every tab's split view reads this one answer, until
 * the window is resized past three columns or back.
 */
export function useSidebarShown(): {
  readonly shown: boolean;
  readonly setShown: (shown: boolean) => void;
  readonly toggle: () => void;
} {
  const threeColumns = useThreeColumns();
  const choice = useSyncExternalStore(subscribe, () => held);
  const shown = choice?.threeColumns === threeColumns ? choice.shown : threeColumns;
  const setShown = (next: boolean) => choose({ threeColumns, shown: next });
  return { shown, setShown, toggle: () => setShown(!shown) };
}
