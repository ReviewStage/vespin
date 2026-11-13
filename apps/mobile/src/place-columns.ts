// place-columns.ts -- the list and the detail each tab's root hands the one split view a window wide enough for three columns stands, beside the app sidebar the tabs' layout draws.

import type { ColumnBar } from "@repo/ui-native";
import { type ReactNode, useLayoutEffect, useSyncExternalStore } from "react";
import type { SidebarPlace } from "./screens/app-sidebar.js";

/** What a tab's root stands beside the app sidebar: its list and the page it picked, each under its bar. */
export type PlaceColumns = {
  readonly content: ReactNode;
  readonly contentBar?: ColumnBar | undefined;
  readonly detail: ReactNode;
  readonly detailBar?: ColumnBar | undefined;
  /** The task the place has open, which the sidebar draws selected where it lists it. */
  readonly openTask?: string | undefined;
};

/** Each place's columns, as its root last drew them. */
const held = new Map<SidebarPlace, PlaceColumns>();

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function hold(place: SidebarPlace, columns: PlaceColumns | undefined): void {
  if (held.get(place) === columns) return;

  if (columns === undefined) held.delete(place);
  else held.set(place, columns);

  for (const listener of listeners) listener();
}

/**
 * Hands a tab root's columns to the split view as each draw commits, or
 * takes them back for none, as in a window too narrow for three columns,
 * where the root draws its own split view. Note that they are handed in a
 * layout effect, so the split view draws them in the same frame the root
 * changed them, as a row picked in the list. Note that the root's hooks stay
 * where they are, under the tab's own route, and only what they draw stands
 * in the split view.
 */
export function useHandColumns(place: SidebarPlace, columns: PlaceColumns | undefined): void {
  useLayoutEffect(() => hold(place, columns));
  useLayoutEffect(() => () => hold(place, undefined), [place]);
}

/** A place's columns as its root last handed them; none before it has. */
export function usePlaceColumns(place: SidebarPlace): PlaceColumns | undefined {
  return useSyncExternalStore(subscribe, () => held.get(place));
}
