/**
 * tasks-page-choices.ts -- what the Tasks page keeps of how its reader reads it: which view it shows, each workspace's filter, each view's display, and the List's folds, kept on the account so every device shows the page alike.
 *
 * Each is one of the account's view choices, read through
 * `useAccountChoice` (`view-choices.ts`): the filter per workspace
 * (`VIEW_CHOICE_KEY.TASKS_FILTER`), since a creator and a repository are a
 * workspace's own, and the view, both displays, and the folds once for the
 * account. A display is kept with the properties its view offered then
 * (`KeptTasksDisplay`), so a property a view gains since is drawn as the
 * view's own display draws it rather than read as one turned off. A choice
 * this window kept itself before the account kept it moves up to the
 * account once. A fixture run keeps nothing, so its frames never wear a
 * developer's choices.
 */

import {
  BOARD_PROPERTIES,
  DEFAULT_BOARD_DISPLAY,
  DEFAULT_LIST_DISPLAY,
  type KeptTasksDisplay,
  keptTasksDisplay,
  NO_TASKS_FILTER,
  TASK_MAKER_ORDER,
  TASK_PROPERTY_ORDER,
  TASKS_PAGE_VIEW,
  type TaskMaker,
  type TaskProperty,
  type TasksDisplay,
  type TasksFilter,
  type TasksPageView,
} from "@repo/features/tasks-page-model";
import {
  keptTasksDisplaySchema,
  keptTasksFilterSchema,
  tasksListFoldsSchema,
  VIEW_CHOICE_KEY,
} from "@repo/features/view-choice-wire";
import { Schema, SchemaTransformation } from "effect";
import { useCallback, useMemo } from "react";
import { keptKey, useKept, useKeptLeaving } from "../use-kept.js";
import { useAccountChoice } from "../view-choices.js";

/** The maker Made by once offered for the app's own tasks, which a filter this window kept before it went may still name. */
const RETIRED_APP_MAKER = "app";

/**
 * The makers a filter this window kept, the retired app maker among them
 * dropped as it reads. Note that it reads rather than refuses, because a
 * value no longer read refuses the whole record, every workspace's filters
 * with it.
 */
const storedMakers = Schema.Array(Schema.Literals([...TASK_MAKER_ORDER, RETIRED_APP_MAKER])).pipe(
  Schema.decodeTo(
    Schema.Array(Schema.Literals(TASK_MAKER_ORDER)),
    SchemaTransformation.transform({
      decode: (makers): readonly TaskMaker[] =>
        makers.filter((maker): maker is TaskMaker => maker !== RETIRED_APP_MAKER),
      encode: (makers) => makers,
    }),
  ),
);

/** The filters as this window kept them: each workspace's by its id. */
const storedFilters = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    keptTasksFilterSchema.mapFields((fields) => ({
      ...fields,
      madeBy: Schema.optionalKey(storedMakers),
    })),
  ),
);

type StoredFilters = typeof storedFilters.Type;

/** The List's folded groups, each kind by the values its groups stand for. */
export type ListFolds = typeof tasksListFoldsSchema.Type;

/** Where an earlier build kept the page's choices in the renderer's storage, each moved up to the account as the page is drawn. */
const KEPT = {
  VIEW: keptKey(
    "app.tasksPageView",
    Schema.fromJsonString(Schema.Literals(Object.values(TASKS_PAGE_VIEW))),
  ),
  FILTERS: keptKey("app.tasksFilter", storedFilters),
  DISPLAY: {
    [TASKS_PAGE_VIEW.LIST]: keptKey(
      "app.tasksListDisplay",
      Schema.fromJsonString(keptTasksDisplaySchema),
    ),
    [TASKS_PAGE_VIEW.BOARD]: keptKey(
      "app.tasksBoardDisplay",
      Schema.fromJsonString(keptTasksDisplaySchema),
    ),
  },
  FOLDS: keptKey("app.tasksListFolds", Schema.fromJsonString(tasksListFoldsSchema)),
} as const;

/** The properties each view offers its rows or cards. */
const OFFERED = {
  [TASKS_PAGE_VIEW.LIST]: TASK_PROPERTY_ORDER,
  [TASKS_PAGE_VIEW.BOARD]: BOARD_PROPERTIES,
} as const satisfies Record<TasksPageView, readonly TaskProperty[]>;

/** Each view's display until its reader changes it. */
export const INITIAL_DISPLAY = {
  [TASKS_PAGE_VIEW.LIST]: DEFAULT_LIST_DISPLAY,
  [TASKS_PAGE_VIEW.BOARD]: DEFAULT_BOARD_DISPLAY,
} as const satisfies Record<TasksPageView, TasksDisplay>;

/** A display nothing kept, which stands at its view's own; one value for every draw. */
const NO_KEPT_DISPLAY: KeptTasksDisplay = {};

/** No group folded, one value for every draw. */
const NO_FOLDS: ListFolds = {};

/** The page's view, its filter for the listed workspace, each view's display, and the presses that change them. */
export interface TasksPageChoices {
  readonly view: TasksPageView;
  readonly onView: (view: TasksPageView) => void;
  readonly filter: TasksFilter;
  readonly onFilter: (filter: TasksFilter) => void;
  readonly displays: Readonly<Record<TasksPageView, TasksDisplay>>;
  readonly onDisplay: (view: TasksPageView, display: TasksDisplay) => void;
}

/** The page's choices in `workspaceId`, kept on the account as each is made, unless the run is `staged`. */
export function useTasksPageChoices(
  workspaceId: string | undefined,
  staged: boolean,
): TasksPageChoices {
  const view = useAccountChoice(
    VIEW_CHOICE_KEY.TASKS_PAGE_VIEW,
    null,
    TASKS_PAGE_VIEW.LIST,
    staged,
    useKeptLeaving(KEPT.VIEW),
  );

  const list = useAccountChoice(
    VIEW_CHOICE_KEY.TASKS_LIST_DISPLAY,
    null,
    NO_KEPT_DISPLAY,
    staged,
    useKeptLeaving(KEPT.DISPLAY[TASKS_PAGE_VIEW.LIST]),
  );

  const board = useAccountChoice(
    VIEW_CHOICE_KEY.TASKS_BOARD_DISPLAY,
    null,
    NO_KEPT_DISPLAY,
    staged,
    useKeptLeaving(KEPT.DISPLAY[TASKS_PAGE_VIEW.BOARD]),
  );

  // Note that the filters an earlier build kept are one record, so each workspace's leaves it as that workspace moves up.
  const [keptFilters, , changeKeptFilters] = useKept<StoredFilters>(KEPT.FILTERS, {});

  const forgetKeptFilter = useCallback(() => {
    if (workspaceId === undefined) return;
    changeKeptFilters(({ [workspaceId]: _moved, ...rest }) => rest);
  }, [workspaceId, changeKeptFilters]);

  const filter = useAccountChoice(
    VIEW_CHOICE_KEY.TASKS_FILTER,
    workspaceId,
    NO_TASKS_FILTER,
    staged,
    [workspaceId === undefined ? undefined : keptFilters[workspaceId], forgetKeptFilter],
  );

  // Note that each display keeps its identity until its choice changes, since the views' memos and effects lean on it.
  const displays = useMemo(
    () => ({
      [TASKS_PAGE_VIEW.LIST]: keptTasksDisplay(list.value, INITIAL_DISPLAY[TASKS_PAGE_VIEW.LIST]),
      [TASKS_PAGE_VIEW.BOARD]: keptTasksDisplay(
        board.value,
        INITIAL_DISPLAY[TASKS_PAGE_VIEW.BOARD],
      ),
    }),
    [list.value, board.value],
  );

  // Note that a display is kept with the properties its view offers now, so one a view gains later is drawn as its own display draws it.
  const onDisplay = (shown: TasksPageView, next: TasksDisplay) => {
    const kept = { ...next, offered: OFFERED[shown] };

    if (shown === TASKS_PAGE_VIEW.LIST) list.choose(kept);
    else board.choose(kept);
  };

  return {
    view: view.value,
    onView: view.choose,
    filter: filter.value,
    onFilter: filter.choose,
    displays,
    onDisplay,
  };
}

/** The List's folds, and the press that changes them over the folds standing as it is pressed. */
export interface ListFoldsChoice {
  readonly folds: ListFolds;
  readonly change: (changed: (standing: ListFolds) => ListFolds) => void;
}

/** The List's folded groups, kept on the account as each is pressed, unless the run is `staged`. */
export function useListFoldsChoice(staged: boolean): ListFoldsChoice {
  const folds = useAccountChoice(
    VIEW_CHOICE_KEY.TASKS_LIST_FOLDS,
    null,
    NO_FOLDS,
    staged,
    useKeptLeaving(KEPT.FOLDS),
  );

  return { folds: folds.value, change: folds.change };
}
