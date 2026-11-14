// minute.ts -- the minute a row's age is said from, moved on once a minute while the app stands in front, as the panel's `useMinute` moves the window's.

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
