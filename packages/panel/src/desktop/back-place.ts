import type { NavigationHistory } from "../places/window-history.js";
import type { AwayStep } from "../places/window-steps.js";

/**
 * back-place.ts -- what a way back that takes a step of the window's history calls the place it goes to.
 */

/** What a step the window never named is called as a place to go back to. */
const UNNAMED_PLACE = "the previous page";

/**
 * The place the window's Back goes to, as a way back's hint names it
 * ("Back to {place}"): the step behind, named as the window called it there,
 * or `fallback`, the place a way back leaves for where no step stands behind.
 */
export function backPlaceOf(history: NavigationHistory, fallback: string): string {
  if (!history.canGoBack) return fallback;

  return history.steps.back[0]?.title?.label ?? UNNAMED_PLACE;
}

/**
 * The place a place's way out goes back to, past the place's own steps
 * (`WindowHistory`'s `away`), as its hint names it: that step, named as the
 * window called it there, or `fallback` where none stands behind.
 */
export function awayPlaceOf(away: AwayStep | undefined, fallback: string): string {
  if (away === undefined) return fallback;

  return away.title?.label ?? UNNAMED_PLACE;
}
