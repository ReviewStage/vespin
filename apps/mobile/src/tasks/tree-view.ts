/**
 * tree-view.ts -- how the Tasks tab stands the reader's tasks in each workspace, as its View options chose it, kept on this device across launches, as the panel keeps its task list's view on each Mac.
 *
 * What a view holds, and how it reads and is written, is
 * `@repo/features/task-tree-model`'s (`TaskTreeView`). Each workspace keeps a
 * view of its own, since a repository and a teammate are a workspace's own,
 * held in memory and kept in the app's `NSUserDefaults` through React
 * Native's `Settings` for the next launch, as the chosen workspace is
 * (`chosen-workspace.ts`), and every screen reading it hears a choice as it
 * is made, the iPad's list and its detail alike.
 */

import {
  DEFAULT_TASK_TREE_VIEW,
  type KeptTreeViews,
  keptTreeViews,
  readTreeViews,
  type TaskTreeView,
  treeViewIn,
} from "@repo/features/task-tree-model";
import { heldValue, useHeldValue } from "@repo/ui-native";
import { Predicate } from "effect";
import { useCallback, useMemo } from "react";
import { Settings } from "react-native";

/** The defaults key the views are kept under. */
const TREE_VIEWS_KEY = "tasksTreeViews";

/** The words the views were kept as at launch, none where nothing was ever kept. */
function launchWords(): string | undefined {
  const kept: unknown = Settings.get(TREE_VIEWS_KEY);

  return Predicate.isString(kept) ? kept : undefined;
}

/**
 * The views as the device holds them now. Note that they are held here
 * rather than read back from `Settings` after each choice, because that
 * module's copy of the defaults lands on the native side only later, and a
 * default another piece of the app wrote in between reported the old views
 * back over the new (`chosen-workspace.ts`); only this module writes them.
 */
const views = heldValue<KeptTreeViews>(readTreeViews(launchWords()));

/** A workspace's view and the choice of another, which is kept and heard by every screen reading it. */
export interface TreeViewControl {
  readonly view: TaskTreeView;
  readonly setView: (view: TaskTreeView) => void;
}

/** The view of the workspace the phone works in, the default before one is known. */
export function useTreeView(workspaceId: string | undefined): TreeViewControl {
  const kept = useHeldValue(views);

  // Note that the view and its setter hold their identity until a choice or the workspace changes them, because the list's whole tree is built again on a new one.
  const view = useMemo(
    () => (workspaceId === undefined ? DEFAULT_TASK_TREE_VIEW : treeViewIn(kept, workspaceId)),
    [kept, workspaceId],
  );

  const setView = useCallback(
    (next: TaskTreeView) => {
      if (workspaceId === undefined) return;
      const words = keptTreeViews(views.read(), workspaceId, next);

      Settings.set({ [TREE_VIEWS_KEY]: words });
      views.set(readTreeViews(words));
    },
    [workspaceId],
  );

  return { view, setView };
}
