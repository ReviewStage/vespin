// tree-hold.ts -- what the reader set on the Tasks list (its search, the parents opened, and the groups folded), held for the app's session rather than by a screen, so a remount of the tabs keeps it.

import { useSyncExternalStore } from "react";

/** What the Tasks list holds of its reader's choices. */
type Held = {
  readonly search: string;
  /** Each group's parents opened, by the group's key. */
  readonly opened: ReadonlyMap<string, ReadonlySet<string>>;
  /** The groups folded shut, by their keys. */
  readonly folded: ReadonlySet<string>;
};

/** No parent opened. */
const NONE: ReadonlySet<string> = new Set();

let now: Held = { search: "", opened: new Map(), folded: NONE };

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function set(next: Held): void {
  now = next;

  for (const listener of listeners) listener();
}

/** The Tasks list's hold as a screen reads and moves it. */
export type TreeHold = {
  readonly search: string;
  readonly setSearch: (search: string) => void;
  readonly opened: ReadonlyMap<string, ReadonlySet<string>>;
  readonly toggleParent: (group: string, taskId: string) => void;
  readonly folded: ReadonlySet<string>;
  readonly setFolded: (group: string, folded: boolean) => void;
};

/**
 * The Tasks list's hold. Note that it is kept outside React rather than in
 * the Tasks tab's root screen, because a change of the tab bar's tabs, as a
 * fold of the iPhone Duo or a rotation across the regular width drops or
 * returns New task, remounts every tab's screens, and what a screen held
 * would be lost with them.
 */
export function useTreeHold(): TreeHold {
  const held = useSyncExternalStore(subscribe, () => now);

  return {
    ...held,
    setSearch: (search) => set({ ...now, search }),
    toggleParent: (group, taskId) => {
      const parents = new Set(now.opened.get(group) ?? NONE);

      if (!parents.delete(taskId)) parents.add(taskId);
      set({ ...now, opened: new Map(now.opened).set(group, parents) });
    },
    setFolded: (group, shut) => {
      const folded = new Set(now.folded);

      if (shut) folded.add(group);
      else folded.delete(group);
      set({ ...now, folded });
    },
  };
}
