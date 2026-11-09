import {
  ASSIGNED_TO,
  type AssignedTo,
  DEFAULT_TASK_LIST_VIEW,
  TASK_GROUPING,
  type TaskGrouping,
  type TaskListView,
} from "@repo/ui/task-list-model";
import { createStore, useSelector } from "@tanstack/react-store";
import { Schema } from "effect";
import { keptKey, useKept } from "../use-kept.js";

/**
 * task-list-view.ts -- how each workspace's task list is grouped, whose tasks it holds, and whether it shows finished sub-tasks, in the sidebar, kept per workspace on this Mac.
 *
 * The view is the developer's reading of a workspace's list, kept in the
 * renderer's own storage as the folds are, so a list grouped in one run on
 * one Mac stays grouped by repository on another, and one workspace's view
 * never changes another's. A workspace with no view kept draws today's, by
 * repository, the reader's own tasks. A fixture run draws that view and
 * keeps nothing, so its frames never wear a developer's choices.
 *
 * Note that Assigned to is kept as Me where it is absent, so every reader
 * opens on their own tasks, and a later choice of Anyone is kept as one;
 * that the finished sub-tasks are kept hidden where nothing is kept, so a
 * view kept before the choice existed reads as it did; and that a view
 * kept grouped by progress, before that grouping was removed, reads as
 * grouped by repository, the rest of its choices kept.
 */

/** A grouping a view may still hold from before it was removed. */
const RETIRED_GROUPING = { PROGRESS: "progress" } as const;

/** A kept grouping. */
const storedGrouping = Schema.Literals([
  ...Object.values(TASK_GROUPING),
  ...Object.values(RETIRED_GROUPING),
]);

/** A kept Assigned to. */
const storedAssignedTo = Schema.Union([
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.ME) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.ANYONE) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.MEMBER), userId: Schema.String }),
]);

/** Each workspace's view, by its id. */
const storedViews = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      grouping: storedGrouping,
      assignee: Schema.optionalKey(storedAssignedTo),
      finished: Schema.optionalKey(Schema.Boolean),
    }),
  ),
);

type StoredViews = typeof storedViews.Type;

/** Where the views are kept in the renderer's storage. */
const KEPT = { VIEWS: keptKey("app.sidebarTaskViews", storedViews) } as const;

/** The listed workspace's view, and the presses that change it. */
export interface TaskListViewControl {
  readonly view: TaskListView;
  readonly onGrouping: (grouping: TaskGrouping) => void;
  /** Lists the reader's tasks, anyone's, or one teammate's. */
  readonly onAssignedTo: (assignedTo: AssignedTo) => void;
  /** Shows each parent's finished sub-tasks under it, or leaves them out. */
  readonly onFinishedSubTasks: (shown: boolean) => void;
}

/** A fixture run's views, which keep nothing. One for the window, so the sidebar and a person's page, which lists their tasks there, read and change the same view. */
const stagedViewsStore = createStore<StoredViews>({});

/** A view as kept, Me where no Assigned to is, and the finished sub-tasks hidden where nothing says. */
function viewOf(kept: StoredViews[string] | undefined): TaskListView {
  if (kept === undefined) return DEFAULT_TASK_LIST_VIEW;
  return {
    grouping:
      kept.grouping === RETIRED_GROUPING.PROGRESS ? DEFAULT_TASK_LIST_VIEW.grouping : kept.grouping,
    assignedTo: kept.assignee ?? DEFAULT_TASK_LIST_VIEW.assignedTo,
    finishedSubTasks: kept.finished ?? DEFAULT_TASK_LIST_VIEW.finishedSubTasks,
  };
}

/** The view of the workspace listed, kept as each choice is made, unless the run is `staged`. */
export function useTaskListView(
  workspaceId: string | undefined,
  staged: boolean,
): TaskListViewControl {
  // Note that every surface holding the key draws a choice at once, so the sidebar and a person's page read and change the same view.
  const [kept, keep] = useKept<StoredViews>(KEPT.VIEWS, {});
  const stagedViews = useSelector(stagedViewsStore);
  const views = staged ? stagedViews : kept;
  const view = viewOf(workspaceId === undefined ? undefined : views[workspaceId]);
  const choose = (next: TaskListView) => {
    if (workspaceId === undefined) return;
    const all = {
      ...views,
      [workspaceId]: {
        grouping: next.grouping,
        assignee: next.assignedTo,
        finished: next.finishedSubTasks,
      },
    };
    if (staged) {
      stagedViewsStore.setState(() => all);
      return;
    }
    keep(all);
  };
  return {
    view,
    onGrouping: (grouping) => choose({ ...view, grouping }),
    onAssignedTo: (assignedTo) => choose({ ...view, assignedTo }),
    onFinishedSubTasks: (finishedSubTasks) => choose({ ...view, finishedSubTasks }),
  };
}
