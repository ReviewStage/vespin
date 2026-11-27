/**
 * tree-folds.ts -- which of the Tasks tab's groups stand folded and which parents stand open, the account's own folds of its sidebar, so a group folded on a Mac stands folded on the phone and every fold outlives a relaunch.
 *
 * The folds are the account's view choices the desktop's sidebar keeps
 * (`@repo/panel`'s `folded-groups.ts`), read here through
 * `../view-choices.ts`: Pinned, Following, and Managers each a flag of its
 * own; a section by its id; a repository's group by its full name, the
 * tasks with none by null; and the one list no heading names, which My
 * tasks heads, the sidebar's Tasks head. A parent's sub-tasks stand open
 * by the parent's id wherever it stands, as the sidebar opens them, the
 * latest `MAX_OPENED_TASKS` kept (`openedTasksBounded`). A press on a list
 * made before the account's list is read waits for it (`../fold-list.ts`). The groups only
 * the Tasks page's groupings draw (a status, a priority, an assignee) fold
 * as the Tasks page's List folds them (`tasksListFolds`, `./tree-view.ts`'s
 * `useTreeFolds`), since the Tasks tab follows the page's view.
 */

import {
  NO_REPOSITORY_KEY,
  TASK_TREE_GROUP,
  type TaskTreeGroup,
} from "@repo/features/task-tree-model";
import {
  openedTasksBounded,
  VIEW_CHOICE_KEY,
  type ViewChoiceKey,
  type ViewChoiceValue,
} from "@repo/features/view-choice-wire";
import { Option } from "effect";
import { useMemo } from "react";
import { useFoldList } from "../fold-list.js";
import { useViewChoice } from "../view-choices.js";
import { useTreeFolds } from "./tree-view.js";

/** What a fold that did not keep says in the failure notice. */
const FOLD_REFUSED = "Couldn't keep that fold.";

/** How the sidebar's folded groups and sections are read and written. */
const FOLDS = { refused: FOLD_REFUSED } as const;

/** How the parents opened are read and written, the latest `MAX_OPENED_TASKS` kept. */
const OPENED = { refused: FOLD_REFUSED, bounded: openedTasksBounded } as const;

/** What the tree holds of its own reading: the groups folded shut, Managers among them, and the parents opened. */
export interface TreeHold {
  readonly folded: (group: TaskTreeGroup) => boolean;
  readonly setFolded: (group: TaskTreeGroup, folded: boolean) => void;
  readonly managersFolded: boolean;
  readonly setManagersFolded: (folded: boolean) => void;
  /** The parents whose sub-tasks stand open, by id. */
  readonly opened: ReadonlySet<string>;
  readonly toggleParent: (taskId: string) => void;
}

/** One of the account's sidebar folds, `initial` where it keeps none, and the press that keeps another. */
function useFold<Key extends ViewChoiceKey>(
  key: Key,
  initial: ViewChoiceValue<Key>,
): readonly [ViewChoiceValue<Key>, (next: ViewChoiceValue<Key>) => void] {
  const { value, choose } = useViewChoice(key, null, FOLD_REFUSED);

  return [Option.getOrElse(value, () => initial), choose];
}

/** The repository a group folds by, as the sidebar keeps it: its full name, or null for the tasks with none. */
function repositoryOf(group: TaskTreeGroup): string | null {
  return group.key === NO_REPOSITORY_KEY ? null : group.key;
}

/**
 * The tree's hold, the account's sidebar folds and the parents it opened,
 * and the groups only the Tasks page's groupings draw folded as the page's
 * List folds them.
 * Note that it is held above the rows, since a recycled row draws another
 * task once scrolled past and a folded section drops its rows, and above
 * the Tasks tab's two layouts, since a fold or an unfold of the iPhone Duo,
 * or a rotation across the split's cutoff, swaps one layout for the other.
 */
export function useTreeHold(): TreeHold {
  const KEY = VIEW_CHOICE_KEY;
  const [pinned, keepPinned] = useFold(KEY.SIDEBAR_PINNED_FOLDED, false);
  const [following, keepFollowing] = useFold(KEY.SIDEBAR_FOLLOWING_FOLDED, false);
  const [tasks, keepTasks] = useFold(KEY.SIDEBAR_TASKS_FOLDED, false);
  const [managers, keepManagers] = useFold(KEY.SIDEBAR_MANAGERS_FOLDED, false);
  const [sections, foldSection] = useFoldList(KEY.SIDEBAR_FOLDED_SECTIONS, FOLDS);
  const [groups, foldGroup] = useFoldList(KEY.SIDEBAR_FOLDED_GROUPS, FOLDS);
  const [opened, openTask] = useFoldList(KEY.SIDEBAR_OPENED_TASKS, OPENED);
  const pageFolds = useTreeFolds();
  const openedSet = useMemo(() => new Set(opened), [opened]);

  const folded = (group: TaskTreeGroup): boolean => {
    if (group.title === undefined) return tasks;

    switch (group.kind) {
      case TASK_TREE_GROUP.PINNED:
        return pinned;
      case TASK_TREE_GROUP.FOLLOWING:
        return following;
      case TASK_TREE_GROUP.SECTION:
        return sections.includes(group.key);
      case TASK_TREE_GROUP.REPOSITORY:
        return groups.includes(repositoryOf(group));
      default:
        return group.head !== undefined && pageFolds.folded(group.head);
    }
  };

  const setFolded = (group: TaskTreeGroup, shut: boolean): void => {
    if (group.title === undefined) {
      keepTasks(shut);

      return;
    }

    switch (group.kind) {
      case TASK_TREE_GROUP.PINNED:
        keepPinned(shut);
        break;
      case TASK_TREE_GROUP.FOLLOWING:
        keepFollowing(shut);
        break;
      case TASK_TREE_GROUP.SECTION:
        foldSection(group.key, shut);
        break;
      case TASK_TREE_GROUP.REPOSITORY:
        foldGroup(repositoryOf(group), shut);
        break;
      default:
        if (group.head !== undefined) pageFolds.setFolded(group.head, shut);
    }
  };

  return {
    folded,
    setFolded,
    managersFolded: managers,
    setManagersFolded: keepManagers,
    opened: openedSet,
    toggleParent: (taskId) => openTask(taskId, !openedSet.has(taskId)),
  };
}
