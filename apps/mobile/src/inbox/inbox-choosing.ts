// inbox-choosing.ts -- the Inbox's Select mode, as Mail's: whether it stands in one and the threads chosen, held once for the Inbox's two layouts and read by the tabs' layout, which hides a compact window's tab bar while it does.

import { useSyncExternalStore } from "react";

/** The Inbox's Select mode as it stands: off, or on with the threads chosen, by their ids. */
type Choosing = { readonly on: false } | { readonly on: true; readonly chosen: readonly string[] };

const OFF: Choosing = { on: false };

let now: Choosing = OFF;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function set(next: Choosing): void {
  now = next;

  for (const listener of listeners) listener();
}

/** The Inbox's Select mode as a screen reads and moves it. */
interface InboxChoosing {
  readonly choosing: Choosing;
  /** Turns Select mode on, with nothing chosen. */
  readonly start: () => void;
  /** Turns it off, letting every thread chosen go. */
  readonly stop: () => void;
  /** Sets the threads chosen, as the list ticks them. */
  readonly choose: (chosen: readonly string[]) => void;
}

/** The Inbox's Select mode, held across its layouts, so a rotation or a fold keeps the threads chosen. */
export function useInboxChoosing(): InboxChoosing {
  const choosing = useSyncExternalStore(subscribe, () => now);

  return {
    choosing,
    start: () => set({ on: true, chosen: [] }),
    stop: () => set(OFF),
    choose: (chosen) => set({ on: true, chosen }),
  };
}

/** Whether the Inbox stands in Select mode, which hides a compact window's tab bar, as Photos hides it to stand its acts in a bar at the foot. */
export function useInboxChoosingOn(): boolean {
  return useSyncExternalStore(subscribe, () => now.on);
}
