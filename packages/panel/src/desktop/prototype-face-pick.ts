/**
 * prototype-face-pick.ts -- PROTOTYPE (round 3): which Manager's row stands open on its face's picker, as Change face opens a row's editor with its face well's picker open, the way Change icon opens a section's head.
 *
 * Throwaway, never merged.
 */

import { useSyncExternalStore } from "react";

let picking: string | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function read(): string | undefined {
  return picking;
}

/** Opens `agentId`'s face picker in its row's editor, or puts every one away. */
export function pickFaceOf(agentId: string | undefined): void {
  picking = agentId;

  for (const listener of listeners) listener();
}

/** Whether `agentId`'s row stands open on its face picker. */
export function usePickingFace(agentId: string): boolean {
  return useSyncExternalStore(subscribe, read, read) === agentId;
}
