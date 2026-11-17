// place-columns.ts -- whether the view asking stands in front, inside a tab's split view whose detail may have a page pushed over it.

import { createContext, useContext } from "react";

/**
 * Whether the columns a view stands in are the ones in front: the detail's
 * root while no page is pushed over it, or the page on top. Every view
 * outside a split view stands in front of its own, as a screen does.
 */
const InFront = createContext(true);

/** Stands what it holds in front, or behind, for the hooks under it that ask (`useInFront`). */
export const InFrontProvider = InFront.Provider;

/** Whether the view calling it stands in front, so what it tells the system, such as a Handoff activity, is told only while it is seen. */
export function useInFront(): boolean {
  return useContext(InFront);
}
