/**
 * tree-view.ts -- how the Tasks tab stands the reader's tasks: the Tasks page's own filter and List display, read and changed on the account, so the phone lists the tasks the Mac's Tasks page lists; and the List's folds.
 *
 * The phone follows the Tasks page, as Dean chose: it reads the page's filter
 * for the workspace (`VIEW_CHOICE_KEY.TASKS_FILTER`), whole, the fields it
 * offers no control for among it, and the page's List display
 * (`VIEW_CHOICE_KEY.TASKS_LIST_DISPLAY`). Its View options read them as a
 * `TaskTreeView` (`@repo/features/task-tree-model`), a value it does not offer
 * standing at its nearest, and a choice there writes back only the fields it
 * changed, over the value standing, so a choice the Mac made the phone
 * cannot show is never lost. A group the page's grouping heads folds on the
 * account too (`VIEW_CHOICE_KEY.TASKS_LIST_FOLDS`), as the page's List folds
 * it.
 *
 * A view an earlier build kept on this device (`tasksTreeViews` in
 * `NSUserDefaults`) moves up once for each workspace as it is listed, as the
 * page's filter and display where the account keeps none, and is let go
 * either way.
 */

import { ASSIGNED_TO, type AssignedTo } from "@repo/features/task-list-model";
import {
  displayReset,
  displayWithTreeView,
  filterWithTreeView,
  type KeptTreeViews,
  keptTreeViewMoved,
  keptTreeViewsSchema,
  type TaskTreeView,
  treeViewChanged,
  treeViewOf,
} from "@repo/features/task-tree-model";
import {
  foldedIn,
  type KeptTasksDisplay,
  NO_TASKS_FILTER,
  type TasksFilter,
  type TasksGroupHead,
  type TasksListFolds,
  toggledFold,
} from "@repo/features/tasks-page-model";
import { VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import { useHeldValue } from "@repo/ui-native";
import { Option } from "effect";
import { useEffect, useMemo } from "react";
import { Settings } from "react-native";
import { deviceKept, useViewChoice, type ViewChoiceControl } from "../view-choices.js";

/** What a view choice that did not keep says in the failure notice. */
const VIEW_REFUSED = "Couldn't change how Tasks are shown.";

/** What a fold that did not keep says in the failure notice. */
const FOLD_REFUSED = "Couldn't fold that group.";

/** A display nothing kept, which stands at the page's own; one value for every draw. */
const NO_KEPT_DISPLAY: KeptTasksDisplay = {};

/** No group folded, one value for every draw. */
const NO_FOLDS: TasksListFolds = {};

/** The views an earlier build kept on this device, each workspace's moved up as it is listed. */
const KEPT = deviceKept<KeptTreeViews>("tasksTreeViews", keptTreeViewsSchema);

/** The workspace's view as the View options read it, and the presses that change it. */
export interface TreeViewControl {
  readonly view: TaskTreeView;
  /** The page's filter, whole, which the tree keeps its tasks by. */
  readonly filter: TasksFilter;
  /** Whether the view stands apart from the page's own, so Reset view offers itself. */
  readonly changed: boolean;
  /** Keeps the fields `change` names over the view standing. */
  readonly change: (change: Partial<TaskTreeView>) => void;
  /** Puts the page's filter and the phone's choices of its display back to the page's own. */
  readonly reset: () => void;
}

/** Whether two Assigned to's name the same tasks; none names no pick of the phone's. */
export function sameAssignedTo(a: AssignedTo | undefined, b: AssignedTo): boolean {
  if (a === undefined) return false;

  if (a.kind !== ASSIGNED_TO.MEMBER || b.kind !== ASSIGNED_TO.MEMBER) return a.kind === b.kind;

  return a.userId === b.userId;
}

/**
 * Moves the view an earlier build kept for `workspaceId` up to the account
 * once both of the page's choices are read: each kept where the account
 * keeps none, and the device's let go either way.
 */
function useKeptViewMovedUp(
  workspaceId: string | undefined,
  readerId: string | undefined,
  filter: ViewChoiceControl<typeof VIEW_CHOICE_KEY.TASKS_FILTER>,
  display: ViewChoiceControl<typeof VIEW_CHOICE_KEY.TASKS_LIST_DISPLAY>,
): void {
  const left = useHeldValue(KEPT.left);
  const kept = workspaceId === undefined ? undefined : left?.[workspaceId];
  const answered = filter.answered && display.answered;
  const filterKept = Option.isSome(filter.value);
  const displayKept = Option.isSome(display.value);
  const { choose: chooseFilter } = filter;
  const { choose: chooseDisplay } = display;

  useEffect(() => {
    if (!answered || kept === undefined || workspaceId === undefined || readerId === undefined)
      return;

    const moved = keptTreeViewMoved(kept, readerId);

    if (!filterKept) chooseFilter(moved.filter);

    if (!displayKept) chooseDisplay(moved.display);

    const { [workspaceId]: _moved, ...rest } = KEPT.left.read() ?? {};
    const remaining = Object.keys(rest).length === 0 ? undefined : rest;
    Settings.set({ [KEPT.name]: remaining === undefined ? null : JSON.stringify(remaining) });
    KEPT.left.set(remaining);
  }, [answered, kept, workspaceId, readerId, filterKept, displayKept, chooseFilter, chooseDisplay]);
}

/** The view of the workspace the phone works in, the page's own before one is read. */
export function useTreeView(
  workspaceId: string | undefined,
  readerId: string | undefined,
): TreeViewControl {
  const filterChoice = useViewChoice(VIEW_CHOICE_KEY.TASKS_FILTER, workspaceId, VIEW_REFUSED);

  const displayChoice = useViewChoice(
    VIEW_CHOICE_KEY.TASKS_LIST_DISPLAY,
    workspaceId === undefined ? undefined : null,
    VIEW_REFUSED,
  );

  useKeptViewMovedUp(workspaceId, readerId, filterChoice, displayChoice);

  const filter = Option.getOrElse(filterChoice.value, () => NO_TASKS_FILTER);
  const display = Option.getOrElse(displayChoice.value, () => NO_KEPT_DISPLAY);

  const view = useMemo(() => treeViewOf(filter, display, readerId), [filter, display, readerId]);

  const { choose: chooseFilter } = filterChoice;
  const { choose: chooseDisplay } = displayChoice;

  // Note that the control holds its identity until what it reads or the workspace it writes to changes, since the Tasks tab builds its whole listing again on a new one; each choice it makes is made over the values it read then.
  return useMemo(() => {
    const change = (part: Partial<TaskTreeView>) => {
      if (readerId === undefined) return;

      if (part.statuses !== undefined || part.assignedTo !== undefined)
        chooseFilter(filterWithTreeView(filter, part, readerId));

      if (Object.keys(part).some((field) => field !== "statuses" && field !== "assignedTo"))
        chooseDisplay(displayWithTreeView(display, part));
    };

    const reset = () => {
      chooseFilter(null);
      chooseDisplay(displayReset(display));
    };

    return { view, filter, changed: treeViewChanged(filter, view), change, reset };
  }, [view, filter, display, readerId, workspaceId]);
}

/** Which of the List's groups stand folded on the account, and the press that folds or opens one. */
export interface TreeFolds {
  readonly folded: (head: TasksGroupHead) => boolean;
  readonly setFolded: (head: TasksGroupHead, folded: boolean) => void;
}

/** The List's folds as the page keeps them on the account, which the tree's groups under the page's grouping fold by. */
export function useTreeFolds(): TreeFolds {
  const choice = useViewChoice(VIEW_CHOICE_KEY.TASKS_LIST_FOLDS, null, FOLD_REFUSED);
  const folds = Option.getOrElse(choice.value, () => NO_FOLDS);

  return {
    folded: (head) => foldedIn(folds, head),
    setFolded: (head, folded) => {
      if (foldedIn(folds, head) !== folded) choice.choose(toggledFold(folds, head));
    },
  };
}
