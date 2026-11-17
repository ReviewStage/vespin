/**
 * narrow-backs.ts -- each place's way back from a pane it stands over another, read from its declaration and taken through the window's history.
 *
 * A narrow room, a phone's, stands the window one pane at a time
 * (`shell-room.ts`), and there each pane opened over another is a step of
 * its own (`window-history.ts`): the side panel over the plan, an Inbox
 * item over its list, a Settings page or a version over its list, and an
 * automation's runs over its setup. Which of a place's panes is such a step,
 * and in which rooms, is its declaration's answer (`ROUTED_PLACE`'s
 * `narrowBack`), and its way back is one rule for every place, and every ‹
 * of the window's: it is the window's Back, one step back through the
 * history, whatever stands behind, and only where nothing does, as on a
 * pane a link or a reload opened, the list it names stands in the pane's
 * step (`useBackOr`, which every other ‹ takes the same way). A wide room
 * holds no such step, so there each way back only stands the list, but for
 * an Inbox item, whose address is its own in every room.
 *
 * The step behind is the window's history's to say, since TanStack Router's
 * history names only the entry standing, so the history is read through the
 * window's routed exits (`routed-exits.ts`), which the window fills in once
 * its history stands, as it fills in the leave and stay every route reads.
 * A step back goes through the history's own step, which asks first while a
 * page holds unsaved work, and the list's own move is its route's
 * navigation, which the leave guard's blocker holds.
 */

import { useRouter } from "@tanstack/react-router";
import { useRoutedExits } from "./routed-exits.js";
import { NARROW_BACK, type RoutedPlace } from "./routed-places.js";
import type { SideStep, TaskStep } from "./task-step.js";

/** A step a way back goes back to: a routed place's at its address, with the side panel its step holds beside it, or a task's own place by what its panes show. */
export type BackStep =
  | { readonly address: string; readonly side?: SideStep }
  | { readonly task: TaskStep };

/** The window's history as a way back reads it. */
export interface StepsBehind {
  /** Steps back to `to`, answering whether it was the step behind. */
  readonly backTo: (to: BackStep) => boolean;
  /** Up to `to` from a pane of its page over it: a step back where it is the step behind, else `stand`, whose step takes the pane's in place. */
  readonly upTo: (to: BackStep, stand: () => void) => void;
  /** One step back, answering whether one stood behind to take, though the leave ask may yet hold it. */
  readonly stepBack: () => boolean;
}

/** Whether the side panel stands over a routed place, an Inbox item, or the plan of the task bound, if any. */
interface PaneOver {
  readonly routed: boolean;
  readonly taskId: string | undefined;
}

/** Each place's ways back, as its doors take them. */
export interface NarrowBacks {
  /** The way back from `place`'s pane to its list at `list`, none where none stands under it: one step back where the pane is a step of its own, else `stand`, which stands the list in the pane's place. */
  readonly list: (place: RoutedPlace, list: string | undefined, stand: () => void) => void;
  /** The way out of the side panel standing only full screen over `over`, the whole pane; `shut` shuts it. */
  readonly pane: (over: PaneOver, shut: () => void) => void;
}

/** Whether a place's pane is a step of its own in a room `narrow` or not, as its declaration says. */
function stepIn(place: RoutedPlace, narrow: boolean): boolean {
  return (
    place.narrowBack === NARROW_BACK.EVERY_ROOM ||
    (narrow && place.narrowBack === NARROW_BACK.NARROW_ROOM)
  );
}

/**
 * A ‹ that is the window's Back: one step back, whatever stands behind, and
 * only where none does, `stand`, which stands the place the ‹ names in the
 * step's place, as a page a link opened has nothing behind it to go back to.
 */
export function useBackOr(): (stand: () => void) => void {
  const exits = useRoutedExits();

  return (stand) => {
    if (!exits.behind.stepBack()) stand();
  };
}

/**
 * A ‹ out of what it opened within a page, as ‹ Agents leaves the task's
 * description and ‹ Transcript an agent's threads: a step back where `to`,
 * what the page showed before, is the step behind, and otherwise `stand`,
 * which shows it in the step's place, so Back from there never opens what
 * the ‹ left again.
 */
export function useBackToOr(): (to: BackStep, stand: () => void) => void {
  const exits = useRoutedExits();

  return (to, stand) => {
    if (!exits.behind.backTo(to)) stand();
  };
}

/** The ways back in a room `narrow` or not, reading the window's history as each is pressed. */
export function useNarrowBacks(narrow: boolean): NarrowBacks {
  const exits = useRoutedExits();
  const router = useRouter();

  return {
    list: (place, list, stand) => {
      if (!stepIn(place, narrow) || list === undefined || !exits.behind.stepBack()) stand();
    },
    pane: (over, shut) => {
      // Note that a phone's panel a link opened over an Inbox item steps back to it shut, where that is the step behind.
      if (over.routed) {
        const standing = { address: router.history.location.href, side: null };

        if (!narrow || !exits.behind.backTo(standing)) shut();

        return;
      }

      if (over.taskId === undefined || !narrow) {
        shut();

        return;
      }

      // Note that the plan is the panel's page with the panel shut, so shutting it steps back there rather than adding a step Back would open the panel again from.
      exits.behind.upTo(
        { task: { taskId: over.taskId, panel: { open: false, tab: undefined } } },
        shut,
      );
    },
  };
}
