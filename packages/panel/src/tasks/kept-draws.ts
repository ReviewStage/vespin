/**
 * kept-draws.ts -- what keeps a value or a press the same from draw to draw while what it says is unchanged, so what is drawn with it is not drawn again.
 */

import type { ComputerApp, ComputerApps } from "@repo/features/agent-parts";
import { useCallback, useRef } from "react";

/**
 * A press that stays the same function from draw to draw and calls the one
 * handed last, so what is drawn with it need not be drawn again when only
 * the closure changed; none where none is handed.
 */
export function useSteady<A extends unknown[]>(
  press: ((...args: A) => void) | undefined,
): ((...args: A) => void) | undefined {
  const latest = useRef(press);
  latest.current = press;
  const steady = useCallback((...args: A) => latest.current?.(...args), []);

  return press === undefined ? undefined : steady;
}

/**
 * The value handed, or the one handed before where `same` reads them alike,
 * so what a transcript hands down stays the same value from draw to draw,
 * and the messages kept as they were are not drawn again for it.
 */
export function useKept<T>(value: T, same: (a: T, b: T) => boolean): T {
  const kept = useRef(value);

  if (!same(kept.current, value)) kept.current = value;

  return kept.current;
}

/** Whether two lists hold the same ids in the same order. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Whether two maps of why lines did not go hold the same notes for the same lines. */
export function sameNotes<T>(a: ReadonlyMap<string, T>, b: ReadonlyMap<string, T>): boolean {
  return a.size === b.size && [...a].every(([id, note]) => b.get(id) === note);
}

/** Whether two sets hold the same members. */
export function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;

  if (a.size !== b.size) return false;

  for (const member of a) if (!b.has(member)) return false;

  return true;
}

/** Whether two plain records hold the same values, key by key, as an actor or a pair does. */
export function sameFields<T extends object>(a: T | undefined, b: T | undefined): boolean {
  if (a === b) return true;

  if (a === undefined || b === undefined) return false;
  const ours = Object.entries(a);
  const theirs = new Map(Object.entries(b));

  return (
    ours.length === theirs.size &&
    ours.every(([key, value]) => theirs.has(key) && Object.is(theirs.get(key), value))
  );
}

/** Whether two maps hold the same values under the same keys. */
export function sameEntries<V>(
  a: ReadonlyMap<string, V> | undefined,
  b: ReadonlyMap<string, V> | undefined,
): boolean {
  if (a === b) return true;

  if (a === undefined || b === undefined || a.size !== b.size) return false;

  for (const [key, value] of a) if (!b.has(key) || !Object.is(b.get(key), value)) return false;

  return true;
}

/** Whether two of a conversation's `computer` apps say the same of the app: its name, its icon, its window, and its machine. */
function sameApp(a: ComputerApp, b: ComputerApp): boolean {
  return (
    a === b ||
    (a.id === b.id &&
      a.name === b.name &&
      a.bundleId === b.bundleId &&
      a.icon === b.icon &&
      a.window === b.window &&
      sameFields(a.machine, b.machine))
  );
}

/** Whether two maps of apps hold the same apps under the same keys. */
function sameApps(
  a: ReadonlyMap<string, ComputerApp>,
  b: ReadonlyMap<string, ComputerApp>,
): boolean {
  if (a === b) return true;

  if (a.size !== b.size) return false;

  for (const [key, app] of a) {
    const theirs = b.get(key);

    if (theirs === undefined || !sameApp(app, theirs)) return false;
  }

  return true;
}

/** Whether two readings of a conversation's `computer` apps (`computerAppsOf`) say the same of every app, by its call, its spelling, and its machine. */
export function sameComputerApps(a: ComputerApps, b: ComputerApps): boolean {
  if (a === b) return true;

  if (!sameApps(a.byCall, b.byCall) || !sameApps(a.bySpelling, b.bySpelling)) return false;

  if (a.byMachine.size !== b.byMachine.size) return false;

  for (const [machine, apps] of a.byMachine) {
    const theirs = b.byMachine.get(machine);

    if (theirs === undefined || !sameApps(apps, theirs)) return false;
  }

  return true;
}
