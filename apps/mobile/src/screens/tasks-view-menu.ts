/**
 * tasks-view-menu.ts -- the Tasks list's View options, the filter button in its bar: which statuses and whose tasks it holds, how it groups and orders them, which finished ones stand, and whether a sub-task stands beside its parent, as the panel's Filter and View options offer them.
 *
 * It is one native menu, as Mail's filter menu stands over its list: Status
 * and, in a shared workspace, Assigned to, the sidebar's own, first; then
 * Group by and Order by; then Show sub-tasks and Show completed; then Reset
 * view while the view is not the one the list starts as. Status keeps
 * several at once, each toggled where it stands; every other choice is one
 * of its kind. Each choice is the Tasks page's own, kept on the account
 * (`tree-view.ts`), and redraws the list at once.
 */

import { ASSIGNED_TO, ASSIGNED_TO_WORDS, type AssignedTo } from "@repo/features/task-list-model";
import {
  TASK_TREE_COMPLETED,
  TASK_TREE_GROUPINGS,
  type TaskTreeView,
} from "@repo/features/task-tree-model";
import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import {
  COMPLETED_WINDOW_WORDS,
  TASKS_GROUPING_WORDS,
  TASKS_ORDER,
  TASKS_ORDER_WORDS,
  TASKS_VIEW_WORDS,
} from "@repo/features/tasks-page-model";
import {
  type BarMenu,
  GLYPH,
  type Glyph,
  type MenuPhotoFile,
  personChoice,
  statusChoice,
} from "@repo/ui-native";
import type { ListedMember } from "../member-pictures.js";
import { sameAssignedTo } from "../tasks/tree-view.js";

/** One choice a menu checks. */
type MenuChoice = BarMenu["choices"][number];

/** What the menu is called, on its button and to VoiceOver. */
const VIEW_OPTIONS = "View options";

/** What the Status submenu is called, as the panel's Filter calls it. */
const STATUS = "Status";

/** The statuses Status offers, in the panel's order. */
const STATUSES: readonly TaskStatus[] = [
  TASK_STATUS.BACKLOG,
  TASK_STATUS.TODO,
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.DONE,
  TASK_STATUS.CANCELED,
];

/** What the menu reads and changes: the view, the presses that change it and put it back, whether it stands apart from the page's own, whether the workspace is shared, its members, and each one's photo. */
export interface TasksViewMenuInput {
  readonly view: TaskTreeView;
  readonly change: (change: Partial<TaskTreeView>) => void;
  readonly reset: () => void;
  readonly changed: boolean;
  readonly shared: boolean;
  readonly members: readonly ListedMember[];
  readonly photoOf: (userId: string) => MenuPhotoFile | undefined;
}

/** Assigned to's choices: Me, Following, Anyone, then each other member by face, as the sidebar's View options lists them, the one chosen checked. */
function assignedToChoices(input: TasksViewMenuInput): readonly MenuChoice[] {
  const { view, members, photoOf } = input;
  const reader = members.find((member) => member.you);

  const press = (assignedTo: AssignedTo) => ({
    on: sameAssignedTo(view.assignedTo, assignedTo),
    onPress: () => input.change({ assignedTo }),
  });

  const glyphChoice = (
    kind: typeof ASSIGNED_TO.FOLLOWING | typeof ASSIGNED_TO.ANYONE,
    symbol: Glyph,
  ): MenuChoice => ({ label: ASSIGNED_TO_WORDS[kind], symbol, ...press({ kind }) });

  return [
    personChoice(
      ASSIGNED_TO_WORDS[ASSIGNED_TO.ME],
      reader === undefined ? undefined : photoOf(reader.userId),
      press({ kind: ASSIGNED_TO.ME }),
    ),
    glyphChoice(ASSIGNED_TO.FOLLOWING, GLYPH.FOLLOW),
    glyphChoice(ASSIGNED_TO.ANYONE, GLYPH.PEOPLE),
    ...members
      .filter((member) => !member.you)
      .map((member) =>
        personChoice(member.name, photoOf(member.userId), {
          id: member.userId,
          detail: member.email,
          ...press({ kind: ASSIGNED_TO.MEMBER, userId: member.userId }),
        }),
      ),
  ];
}

/** The statuses with one turned on or off, kept in the panel's order. */
function toggledStatus(statuses: readonly TaskStatus[], status: TaskStatus): readonly TaskStatus[] {
  const on = statuses.includes(status);

  return STATUSES.filter((each) => (each === status ? !on : statuses.includes(each)));
}

/** The Tasks list's View options menu, for its bar. */
export function tasksViewMenu(input: TasksViewMenuInput): BarMenu {
  const { view, change, reset, changed, shared } = input;

  const status: BarMenu = {
    label: STATUS,
    symbol: GLYPH.STATUS,
    choices: STATUSES.map((each) =>
      statusChoice(each, {
        on: view.statuses.includes(each),
        onPress: () => change({ statuses: toggledStatus(view.statuses, each) }),
      }),
    ),
    actions: [],
  };

  const assignedTo: BarMenu = {
    label: ASSIGNED_TO_WORDS.HEAD,
    symbol: GLYPH.PERSON,
    choices: assignedToChoices(input),
    actions: [],
  };

  const groupBy: BarMenu = {
    label: TASKS_VIEW_WORDS.GROUP_BY,
    symbol: GLYPH.LIST,
    choices: TASK_TREE_GROUPINGS.map((grouping) => ({
      label: TASKS_GROUPING_WORDS[grouping],
      on: view.grouping === grouping,
      onPress: () => change({ grouping }),
    })),
    actions: [],
  };

  const orderBy: BarMenu = {
    label: TASKS_VIEW_WORDS.ORDER_BY,
    symbol: GLYPH.TIME,
    choices: Object.values(TASKS_ORDER).map((order) => ({
      label: TASKS_ORDER_WORDS[order],
      on: view.order === order,
      onPress: () => change({ order }),
    })),
    actions: [],
  };

  const completed: BarMenu = {
    label: TASKS_VIEW_WORDS.SHOW_COMPLETED,
    symbol: GLYPH.RESOLVED,
    choices: TASK_TREE_COMPLETED.map((window) => ({
      label: COMPLETED_WINDOW_WORDS[window],
      on: view.completed === window,
      onPress: () => change({ completed: window }),
    })),
    actions: [],
  };

  return {
    label: VIEW_OPTIONS,
    symbol: GLYPH.FILTER,
    choices: [],
    actions: [],
    submenus: shared ? [status, assignedTo] : [status],
    groups: [
      { items: [groupBy, orderBy] },
      {
        choices: [
          {
            label: TASKS_VIEW_WORDS.SHOW_SUB_TASKS,
            symbol: GLYPH.SUB_TASK,
            on: view.subTasks,
            onPress: () => change({ subTasks: !view.subTasks }),
          },
        ],
        items: [completed],
      },
      {
        items: [
          {
            label: TASKS_VIEW_WORDS.RESET_VIEW,
            symbol: GLYPH.RESTORE,
            disabled: !changed,
            onPress: reset,
          },
        ],
      },
    ],
  };
}
