/**
 * prototype-face-direction.ts -- PROTOTYPE: which design direction the Manager faces are drawn in, and whether every face is shown at work.
 *
 * Throwaway, never merged. The direction is read once from the address's
 * `?faces=` (palette, emoji, mixed, lively), else this tab's storage, and
 * changed from the floating switcher or the picker's own bar; every face
 * and picker drawn reads it through `useFaceDirection`, so a switch redraws
 * them all at once. `?working=1` (or the switcher's Working) shows every
 * face at work, so the working state can be seen without a running agent.
 */

import { useSyncExternalStore } from "react";

/** The directions the prototype offers. */
export const FACE_DIRECTION = {
  PALETTE: "palette",
  EMOJI: "emoji",
  MIXED: "mixed",
  LIVELY: "lively",
} as const;

export type FaceDirection = (typeof FACE_DIRECTION)[keyof typeof FACE_DIRECTION];

/** What each direction is called in the switcher. */
export const FACE_DIRECTION_NAME = {
  [FACE_DIRECTION.PALETTE]: "A · Palette",
  [FACE_DIRECTION.EMOJI]: "B · Emoji",
  [FACE_DIRECTION.MIXED]: "C · Mixed",
  [FACE_DIRECTION.LIVELY]: "D · Lively",
} as const satisfies Record<FaceDirection, string>;

const DIRECTION_KEY = "prototype.faceDirection";
const DIRECTIONS: readonly string[] = Object.values(FACE_DIRECTION);

interface FaceState {
  readonly direction: FaceDirection;
  readonly working: boolean;
}

function isDirection(value: string | null): value is FaceDirection {
  return value !== null && DIRECTIONS.includes(value);
}

function initialState(): FaceState {
  if (typeof window === "undefined") return { direction: FACE_DIRECTION.PALETTE, working: false };
  const search = new URLSearchParams(window.location.search);
  const named = search.get("faces");
  let kept: string | null = null;

  try {
    kept = window.localStorage.getItem(DIRECTION_KEY);
  } catch {
    kept = null;
  }

  return {
    direction: isDirection(named) ? named : isDirection(kept) ? kept : FACE_DIRECTION.PALETTE,
    working: search.get("working") === "1",
  };
}

let state: FaceState = initialState();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function set(next: FaceState): void {
  state = next;

  try {
    window.localStorage.setItem(DIRECTION_KEY, next.direction);
    const url = new URL(window.location.href);
    url.searchParams.set("faces", next.direction);

    if (next.working) url.searchParams.set("working", "1");
    else url.searchParams.delete("working");
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // Note that a refused write leaves the switch standing for this page alone.
  }

  for (const listener of listeners) listener();
}

/** The direction faces are drawn in, and whether every face is shown at work. */
export function useFaceDirection(): FaceState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Switches every face and picker to `direction`. */
export function setFaceDirection(direction: FaceDirection): void {
  set({ ...state, direction });
}

/** Shows every face at work, or each as its Manager stands. */
export function setFacesWorking(working: boolean): void {
  set({ ...state, working });
}
