/**
 * narrow-backs.ts -- each place's way back from a pane it stands over another, read from its declaration and taken through the window's history.
 *
 * A narrow room, a phone's, stands the window one pane at a time
 * (`shell-room.ts`), and there each pane opened over another is a step of
 * its own (`window-history.ts`): the side panel over the plan, an Inbox
 * item over its list, a Settings page or a version over its list, and an
 * automation's runs over its setup. Which of a place's panes is such a step,
 * and in which rooms, is its declaration's answer (`ROUTED_PLACE`'s
 * `narrowBack`), and its way back is one rule for every place: a step back
 * where the list is the step behind, and otherwise the list standing in the
 * pane's step, as a link opened on an item leaves no list behind it to go
 * back to. A wide room holds no such step, so there each way back only
 * stands the list, but for an Inbox item, whose address is its own in every
 * room.
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
  /** The way back from `place`'s pane to its list at `list`, none where none stands under it; `stand` stands the list in the pane's place. */
  readonly list: (place: RoutedPlace, list: string | undefined, stand: () => void) => void;
  /** The way out of the side panel standing only full screen over `over`, the whole pane; `shut` shuts it. */
  readonly pane: (over: PaneOver, shut: () => void) => void;
  /** Escape's way out of an open task, the toolbar's Back: one step back, to the page it was opened from, and `leave` only where none stands behind. */
  readonly task: (leave: () => void) => void;
}

/** Whether a place's pane is a step of its own in a room `narrow` or not, as its declaration says. */
function stepIn(place: RoutedPlace, narrow: boolean): boolean {
  return (
    place.narrowBack === NARROW_BACK.EVERY_ROOM ||
    (narrow && place.narrowBack === NARROW_BACK.NARROW_ROOM)
  );
}

/** The ways back in a room `narrow` or not, reading the window's history as each is pressed. */
export function useNarrowBacks(narrow: boolean): NarrowBacks {
  const exits = useRoutedExits();
  const router = useRouter();

  return {
    list: (place, list, stand) => {
      if (!stepIn(place, narrow) || list === undefined || !exits.behind.backTo({ address: list })) {
        stand();
      }
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
    // Note that a task with no step behind it, as one a reloaded tab or a link loaded, is left as ever.
    task: (leave) => {
      if (!exits.behind.stepBack()) leave();
    },
  };
}
