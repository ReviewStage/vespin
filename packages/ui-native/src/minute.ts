// minute.ts -- the minute a row's age is said from, moved on once a minute while the app stands in front, as the panel's `useMinute` moves the window's, and the day it falls in.

import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

/** How often the age of a moment moves, in milliseconds: the finest unit it says. */
const MINUTE_MS = 60_000;

/**
 * The minute as one store every reader shares: read at once, then again at
 * each minute's boundary while anyone reads it, and at once when the app
 * comes back to the front, since iOS holds a background app's timers and a
 * row read on return would otherwise say its age as it stood when the app
 * left. Note that it sleeps to the boundary rather than a whole minute, so
 * every age moves on the same instant, and that the timer stops once no
 * one reads it.
 */
function minuteStore() {
  let now = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unwatch: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const tick = () => {
    now = Date.now();
    timer = setTimeout(tick, MINUTE_MS - (now % MINUTE_MS));

    for (const listener of listeners) listener();
  };

  const start = () => {
    tick();

    const watched = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      clearTimeout(timer);
      tick();
    });

    unwatch = () => watched.remove();
  };

  const stop = () => {
    clearTimeout(timer);
    unwatch?.();
    timer = undefined;
    unwatch = undefined;
  };

  return {
    subscribe(listener: () => void) {
      if (listeners.size === 0) start();
      listeners.add(listener);

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0) stop();
      };
    },
    read: () => now,
  };
}

const MINUTE = minuteStore();

/** The time a row's age counts from, moved on once a minute and on the app's return to the front. */
export function useMinute(): number {
  return useSyncExternalStore(MINUTE.subscribe, MINUTE.read);
}

/** The start of the minute's day in the reader's own zone, the same through the day. */
function dayOf(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);

  return day.getTime();
}

/**
 * The reader's day, by its first instant, moved on at midnight and on the
 * app's return to the front on a later day: for what changes only from one
 * day to the next, such as Remind me's Tomorrow, so its reader is drawn
 * again once a day rather than at every minute.
 */
export function useToday(): number {
  return useSyncExternalStore(MINUTE.subscribe, () => dayOf(MINUTE.read()));
}
