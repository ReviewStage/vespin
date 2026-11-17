// held-value.ts -- a value held outside React that every screen reads through `useSyncExternalStore` and is told of as it changes, or the telling alone, for a value kept elsewhere, such as the device's defaults.

import { useSyncExternalStore } from "react";

/** The screens listening for a change, told together. */
export interface ChangeSignal {
  /** Hears each change until the returned function stops it, as `useSyncExternalStore` subscribes. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Tells every listener that the value changed. */
  readonly tell: () => void;
}

/** A value held outside React, read by every screen and told to each as it is set. */
export interface HeldValue<T> extends ChangeSignal {
  readonly read: () => T;
  /** Holds `next` and tells every listener. */
  readonly set: (next: T) => void;
}

/** A value a screen reads through `useHeldValue`. */
type Readable<T> = Pick<HeldValue<T>, "subscribe" | "read">;

/** A signal with no listener yet. */
export function changeSignal(): ChangeSignal {
  const listeners = new Set<() => void>();

  return {
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    tell: () => {
      for (const listener of listeners) listener();
    },
  };
}

/** A value held from `initial`, with no listener yet. */
export function heldValue<T>(initial: T): HeldValue<T> {
  const signal = changeSignal();
  let held = initial;

  return {
    ...signal,
    read: () => held,
    set: (next) => {
      held = next;
      signal.tell();
    },
  };
}

/** The value as it stands, or what `select` reads of it, drawn anew as it changes. Note that `select` answers a value it keeps, such as a field, since one made anew each read never settles. */
export function useHeldValue<T>(value: Readable<T>): T;
export function useHeldValue<T, S>(value: Readable<T>, select: (held: T) => S): S;
export function useHeldValue<T, S>(value: Readable<T>, select?: (held: T) => S): T | S {
  return useSyncExternalStore(value.subscribe, () =>
    select === undefined ? value.read() : select(value.read()),
  );
}
