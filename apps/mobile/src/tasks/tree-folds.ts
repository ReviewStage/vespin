/**
 * tree-folds.ts -- which of the Tasks list's groups the reader folded, Managers, Pinned, Following, each section and each repository among them, kept on this device across launches, as the panel's sidebar keeps its folds on each Mac (`folded-groups.ts`).
 *
 * A group is kept by its key in the tree (`TaskTreeGroup`'s `key`): a
 * section by its id, a repository by its full name, Pinned and Following
 * by their kind. The folds are held in memory and kept in the app's
 * `NSUserDefaults` through React Native's `Settings` for the next launch,
 * as the Tasks list's view is (`tree-view.ts`), and every screen reading
 * them hears a fold as it is made, the iPad's list and the iPhone's alike.
 * A group whose last task goes leaves its key behind: it is a few bytes, and
 * the group comes back folded as it was left.
 */

import { heldValue, useHeldValue } from "@repo/ui-native";
import { Predicate } from "effect";
import { useCallback } from "react";
import { Settings } from "react-native";

/** The defaults key the folded groups are kept under. */
const FOLDED_KEY = "tasksFoldedGroups";

/** The groups folded at launch: every key kept, none where nothing was kept. */
function launchFolded(): ReadonlySet<string> {
  const kept: unknown = Settings.get(FOLDED_KEY);

  return new Set(Array.isArray(kept) ? kept.filter(Predicate.isString) : []);
}

/**
 * The groups folded as the device holds them now. Note that they are held
 * here rather than read back from `Settings` after each fold, because that
 * module's copy of the defaults lands on the native side only later
 * (`tree-view.ts`); only this module writes them.
 */
const folded = heldValue<ReadonlySet<string>>(launchFolded());

/** The groups folded, and the press that folds a group or opens it, kept and heard by every screen reading them. */
export interface TreeFolds {
  readonly folded: ReadonlySet<string>;
  readonly setFolded: (group: string, shut: boolean) => void;
}

/** The Tasks list's folded groups as the device keeps them, and the door that folds one or opens it. */
export function useTreeFolds(): TreeFolds {
  const kept = useHeldValue(folded);

  const setFolded = useCallback((group: string, shut: boolean) => {
    const next = new Set(folded.read());

    if (shut) next.add(group);
    else next.delete(group);

    Settings.set({ [FOLDED_KEY]: [...next] });
    folded.set(next);
  }, []);

  return { folded: kept, setFolded };
}
