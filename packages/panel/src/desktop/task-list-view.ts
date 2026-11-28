import {
  ASSIGNED_TO,
  type AssignedTo,
  DEFAULT_TASK_LIST_VIEW,
  TASK_GROUPING,
  type TaskGrouping,
  type TaskListView,
} from "@repo/features/task-list-model";
import { VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import { Schema } from "effect";
import { useCallback } from "react";
import { keptKey, useKept } from "../use-kept.js";
import { useAccountChoice } from "../view-choices.js";

/**
 * task-list-view.ts -- how each workspace's task list is grouped, whose tasks it holds, and whether it shows finished sub-tasks, in the sidebar, kept per workspace on the account.
 *
 * The view is the reader's reading of a workspace's list, one of the
 * account's view choices (`VIEW_CHOICE_KEY.SIDEBAR_TASK_VIEW`,
 * `view-choices.ts`), so a list grouped on one device stands grouped so on
 * every other, and one workspace's view never changes another's. A
 * workspace with no view kept draws today's, by repository, the reader's
 * own tasks. A view this Mac kept itself before the account kept it moves
 * up once (`useKeptMovedUp`). A fixture run draws that view and keeps
 * nothing, so its frames never wear a developer's choices.
 *
 * Note that a view this Mac kept with no Assigned to moves up as Me, so
 * every reader opens on their own tasks, and one kept before the finished
 * sub-tasks were a choice moves up with them hidden, as it read.
 */

/** A kept grouping. */
const storedGrouping = Schema.Literals(Object.values(TASK_GROUPING));

/** A kept Assigned to. */
const storedAssignedTo = Schema.Union([
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.ME) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.FOLLOWING) }),
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

/** Where an earlier build kept the views in the renderer's storage, each moved up to the account as its workspace is listed. */
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

/** A view as an earlier build kept it on this Mac, Me where no Assigned to is, and the finished sub-tasks hidden where nothing says. */
function viewOf(kept: StoredViews[string]): TaskListView {
  return {
    grouping: kept.grouping,
    assignedTo: kept.assignee ?? DEFAULT_TASK_LIST_VIEW.assignedTo,
    finishedSubTasks: kept.finished ?? DEFAULT_TASK_LIST_VIEW.finishedSubTasks,
  };
}

/** The view of the workspace listed, kept on the account as each choice is made, unless the run is `staged`. */
export function useTaskListView(
  workspaceId: string | undefined,
  staged: boolean,
): TaskListViewControl {
  const [kept, , changeKept] = useKept<StoredViews>(KEPT.VIEWS, {});
  const keptView = workspaceId === undefined ? undefined : kept[workspaceId];

  const forget = useCallback(() => {
    if (workspaceId === undefined) return;
    changeKept(({ [workspaceId]: _moved, ...rest }) => rest);
  }, [workspaceId, changeKept]);

  // Note that every surface reading the choice draws it at once, so the sidebar and a person's page read and change the same view.
  const { value: view, change } = useAccountChoice(
    VIEW_CHOICE_KEY.SIDEBAR_TASK_VIEW,
    workspaceId,
    DEFAULT_TASK_LIST_VIEW,
    staged,
    [keptView === undefined ? undefined : viewOf(keptView), forget],
  );

  // Note that each choice is made over the view standing as it is pressed, so a menu left open never undoes another choice made since.
  return {
    view,
    onGrouping: (grouping) => change((standing) => ({ ...standing, grouping })),
    onAssignedTo: (assignedTo) => change((standing) => ({ ...standing, assignedTo })),
    onFinishedSubTasks: (finishedSubTasks) =>
      change((standing) => ({ ...standing, finishedSubTasks })),
  };
}
