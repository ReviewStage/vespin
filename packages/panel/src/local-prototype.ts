/**
 * local-prototype.ts -- PROTOTYPE, throwaway: which workspace the window lists, so the Vespin Local mockup can draw a Local workspace differently. Never merge.
 */

import { useSyncExternalStore } from "react";

/** The fixture's Local workspace (`tasks-fixture.ts`). */
export const LOCAL_PROTOTYPE_WORKSPACE_ID = "workspace-local";

let listed: string | undefined;
const listeners = new Set<() => void>();

/** Records the workspace the window lists. */
export function setPrototypeListed(id: string | undefined): void {
  if (id === listed) return;
  listed = id;
  for (const listener of listeners) listener();
}

/** Whether the window lists the Local workspace. */
export function useIsLocalPrototype(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => listed === LOCAL_PROTOTYPE_WORKSPACE_ID,
  );
}

/** Whether `id` names the Local workspace. */
export function isLocalPrototype(id: string | undefined): boolean {
  return id === LOCAL_PROTOTYPE_WORKSPACE_ID;
}
