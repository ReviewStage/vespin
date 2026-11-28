/**
 * view-choice-wire.ts -- the account's view choices: each declared once (its key, whether it is the account's or one workspace's, and the Schema its value reads through), and a write as `/api/account/view-choices` carries it.
 *
 * A view choice is how a member reads their own lists (a sort, a filter, a
 * fold), kept on their account so it follows them to every device, as Slack
 * keeps a sidebar's sort and Linear its display options. What is tied to a
 * window rather than to the person (a width, which tab is open) stays on the
 * device (`@repo/panel`'s `use-kept.ts`).
 *
 * Each choice is declared once in `VIEW_CHOICE`, which the service checks
 * every write against and every client reads through, so the service holds
 * no value a build could not have chosen. A choice of a workspace's is kept
 * for each workspace apart, by its id, and one of the account's once.
 *
 * Note that a value's shape never changes under its key: a choice whose
 * shape must change is declared again under a new key, because a released
 * client keeps reading the key it knows for weeks (AGENTS.md's "Breaking
 * the hosted wire"), and a value it cannot read only stands at its default.
 */

import { type WireValue, WireValueSchema } from "@repo/wire";
import { Option, Schema } from "effect";
import { AUTOMATIONS_ORDER } from "./automation-list-model.js";
import { AUTOMATION_LIST_GROUP } from "./automation-wire.js";
import { INBOX_RUNS, INBOX_SHOW, INBOX_WHOSE } from "./inbox-list-model.js";
import { managerFaceSchema } from "./manager-face.js";
import { mergeMethodSchema } from "./pull-request-write-wire.js";
import { wireUuidSchema } from "./service-wire.js";
import { ASSIGNED_TO, TASK_GROUPING } from "./task-list-model.js";
import { taskSectionIconSchema } from "./task-section-wire.js";
import {
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  TASK_STATUS_ORDER,
  workspaceIdSchema,
} from "./task-wire.js";
import {
  COMPLETED_WINDOW,
  TASK_MAKER_ORDER,
  TASK_PROPERTY_ORDER,
  TASKS_GROUPING,
  TASKS_ORDER,
  TASKS_PAGE_VIEW,
} from "./tasks-page-model.js";
import { MANAGER_SORT } from "./workspace-managers-model.js";

/** Whether a choice is the account's once, or one workspace's, kept for each apart. */
export const VIEW_CHOICE_SCOPE = {
  ACCOUNT: "account",
  WORKSPACE: "workspace",
} as const;

export type ViewChoiceScope = (typeof VIEW_CHOICE_SCOPE)[keyof typeof VIEW_CHOICE_SCOPE];

/** Each view choice's key, as the service stores it and the wire carries it. */
export const VIEW_CHOICE_KEY = {
  /** How a workspace's Managers are sorted in the sidebar (`MANAGER_SORT`). */
  MANAGER_SORT: "managerSort",
  /** How a workspace's sidebar Tasks list is grouped, whose tasks it holds, and whether it shows finished sub-tasks (`TaskListView`). */
  SIDEBAR_TASK_VIEW: "sidebarTaskView",
  /** The sidebar's task groups folded, each by its repository's full name, null for the tasks with none. */
  SIDEBAR_FOLDED_GROUPS: "sidebarFoldedGroups",
  /** Whether the sidebar's Pinned is folded. */
  SIDEBAR_PINNED_FOLDED: "sidebarPinnedFolded",
  /** Whether the sidebar's Following is folded. */
  SIDEBAR_FOLLOWING_FOLDED: "sidebarFollowingFolded",
  /** Whether the sidebar's Tasks head is folded, the sections and the list under it with it. */
  SIDEBAR_TASKS_FOLDED: "sidebarTasksFolded",
  /** Whether the sidebar's Managers is folded. */
  SIDEBAR_MANAGERS_FOLDED: "sidebarManagersFolded",
  /** The account's own sections folded in the sidebar, by id. */
  SIDEBAR_FOLDED_SECTIONS: "sidebarFoldedSections",
  /** The tasks whose sub-tasks stand open under them in the sidebar, by id, the latest opened last. */
  SIDEBAR_OPENED_TASKS: "sidebarOpenedTasks",
  /** Which scope the Inbox shows (`INBOX_SHOW`). */
  INBOX_SHOW: "inboxShow",
  /** Whom the items the Inbox lists are addressed to: the reader, anyone, or one teammate (`InboxWhose`). */
  INBOX_WHOSE: "inboxWhose",
  /** Whether the Inbox stands its pinned tasks' items first, under a heading of their own. */
  INBOX_PINNED_FIRST: "inboxPinnedFirst",
  /** The Inbox's runs folded while its pinned tasks' items stand first (`INBOX_RUNS`). */
  INBOX_FOLDED_RUNS: "inboxFoldedRuns",
  /** Which of the Automations list's groups stand folded (`AUTOMATION_LIST_GROUP`): each owner's, and Finished. */
  AUTOMATIONS_FOLDED: "automationsFolded",
  /** Which tasks a workspace's Tasks page holds: its Filter (`TasksFilter`). */
  TASKS_FILTER: "tasksFilter",
  /** Whether the Tasks page shows its List or its Board (`TASKS_PAGE_VIEW`). */
  TASKS_PAGE_VIEW: "tasksPageView",
  /** How the Tasks page's List lays its tasks out: its View options (`KeptTasksDisplay`). */
  TASKS_LIST_DISPLAY: "tasksListDisplay",
  /** How the Tasks page's Board lays its tasks out: its View options (`KeptTasksDisplay`). */
  TASKS_BOARD_DISPLAY: "tasksBoardDisplay",
  /** The Tasks page List's folded groups, each kind by the values its groups stand for. */
  TASKS_LIST_FOLDS: "tasksListFolds",
  /** How the Automations list orders each owner's automations (`AUTOMATIONS_ORDER`). */
  AUTOMATIONS_ORDER: "automationsOrder",
  /** Whether a task Overview's Archived agents stand open, one choice for every task. */
  ARCHIVED_AGENTS_OPEN: "archivedAgentsOpen",
  /** A pull request's Conversation filters and its two sections' folds, one choice for every pull request. */
  CONVERSATION_FILTERS: "conversationFilters",
  /** Whether Find in tab searches a transcript's details too. */
  FIND_DETAILS: "findDetails",
  /** The merge method last chosen in each repository, newest first. */
  MERGE_METHODS: "mergeMethods",
  /** The people a task's follow offer was turned down for, by task, newest first. */
  FOLLOW_OFFERS_DECLINED: "followOffersDeclined",
  /** The newest failed run seen of each of the account's own automations, by the automation. */
  FAILED_RUNS_SEEN: "failedRunsSeen",
  /** The section icons chosen last, newest first, which the icon picker offers under Recent. */
  RECENT_SECTION_ICONS: "recentSectionIcons",
  /** The Manager faces picked last, newest first, which the face picker offers under Recent. */
  RECENT_MANAGER_FACES: "recentManagerFaces",
} as const;

export type ViewChoiceKey = (typeof VIEW_CHOICE_KEY)[keyof typeof VIEW_CHOICE_KEY];

/** The Schema a view choice's value reads through, needing no service to read or write. */
type ViewChoiceSchema = Schema.Codec<unknown, unknown>;

/** A view choice as declared: its key, its scope, and the Schema its value reads through, whose encoded side is JSON. */
export interface ViewChoice<S extends ViewChoiceSchema> {
  readonly key: ViewChoiceKey;
  readonly scope: ViewChoiceScope;
  readonly schema: S;
}

/** Declares one view choice. */
function viewChoice<S extends ViewChoiceSchema>(
  key: ViewChoiceKey,
  scope: ViewChoiceScope,
  schema: S,
): ViewChoice<S> {
  return { key, scope, schema };
}

/** How many tasks may stand opened at once, the earliest opened let go first, so the list stays well under `MAX_VALUE_CHARS`. */
export const MAX_OPENED_TASKS = 200;

/** The tasks opened, the latest `MAX_OPENED_TASKS` of them where they run past the bound, as the account keeps them. */
export function openedTasksBounded(opened: readonly string[]): readonly string[] {
  return opened.length > MAX_OPENED_TASKS ? opened.slice(-MAX_OPENED_TASKS) : opened;
}

/** The tasks opened with `taskId` shut where it was opened, and opened last where it was not, within the bound. */
export function openedTasksToggled(opened: readonly string[], taskId: string): readonly string[] {
  return opened.includes(taskId)
    ? opened.filter((each) => each !== taskId)
    : openedTasksBounded([...opened, taskId]);
}

/** Whose tasks a list holds (`AssignedTo`). */
const assignedToSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.ME) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.FOLLOWING) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.ANYONE) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.MEMBER), userId: Schema.String }),
]);

/** Whom the items the Inbox lists are addressed to (`InboxWhose`), a teammate by id with the name the list last knew them by. */
const inboxWhoseSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal(INBOX_WHOSE.EVERYONE) }),
  Schema.Struct({ kind: Schema.Literal(INBOX_WHOSE.MINE) }),
  Schema.Struct({
    kind: Schema.Literal(INBOX_WHOSE.PERSON),
    userId: Schema.String,
    name: Schema.String,
  }),
]);

/** Whether a sidebar head stands folded. */
const foldedSchema = Schema.Boolean;

/** Ids folded or opened. */
const idsSchema = Schema.Array(Schema.String);

/** A Tasks page's filter as kept (`TasksFilter`): for each field, the values a task must hold one of. */
export const keptTasksFilterSchema = Schema.Struct({
  status: Schema.optionalKey(Schema.Array(Schema.Literals(Object.values(TASK_STATUS)))),
  priority: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PRIORITY_ORDER))),
  assignee: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
  creator: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
  follower: Schema.optionalKey(Schema.Array(Schema.String)),
  madeBy: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_MAKER_ORDER))),
  repository: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
});

/** A Tasks page view's display as kept (`KeptTasksDisplay`): each choice optional, and the properties its view offered. */
export const keptTasksDisplaySchema = Schema.Struct({
  grouping: Schema.optionalKey(Schema.Literals(Object.values(TASKS_GROUPING))),
  order: Schema.optionalKey(Schema.Literals(Object.values(TASKS_ORDER))),
  emptyGroups: Schema.optionalKey(Schema.Boolean),
  completed: Schema.optionalKey(Schema.Literals(Object.values(COMPLETED_WINDOW))),
  pinnedFirst: Schema.optionalKey(Schema.Boolean),
  subTasks: Schema.optionalKey(Schema.Boolean),
  properties: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PROPERTY_ORDER))),
  /** The properties the view offered when it was kept. */
  offered: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PROPERTY_ORDER))),
});

/** The Tasks page List's folded groups, each kind by the values its groups stand for; absent where none is. */
export const tasksListFoldsSchema = Schema.Struct({
  pinned: Schema.optionalKey(Schema.Boolean),
  sections: Schema.optionalKey(Schema.Array(Schema.String)),
  status: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_STATUS_ORDER))),
  priority: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PRIORITY_ORDER))),
  repository: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
  assignee: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
  creator: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
});

/**
 * How many entries a choice that keeps a list may hold, the newest kept
 * first, so its JSON stands well inside `VIEW_CHOICE_BOUNDS.MAX_VALUE_CHARS`
 * however long its names run: a repository's name is at most 140
 * characters, and a task's and a person's id under 40.
 */
export const VIEW_CHOICE_LIST_BOUNDS = {
  /** The repositories whose merge method is kept. */
  MERGE_REPOSITORIES: 50,
  /** The tasks whose turned-down follow offers are kept. */
  DECLINED_TASKS: 30,
  /** The people turned down on one task. */
  DECLINED_PEOPLE: 10,
  /** The icons or faces a picker offers under Recent. */
  RECENT: 10,
} as const;

/** A list of `item`, holding at most `most`. */
function listOf<S extends Schema.Top>(item: S, most: number) {
  return Schema.Array(item).check(Schema.isMaxLength(most));
}

/** Every view choice, by its key. */
export const VIEW_CHOICE = {
  [VIEW_CHOICE_KEY.MANAGER_SORT]: viewChoice(
    VIEW_CHOICE_KEY.MANAGER_SORT,
    VIEW_CHOICE_SCOPE.WORKSPACE,
    Schema.Literals(Object.values(MANAGER_SORT)),
  ),
  [VIEW_CHOICE_KEY.SIDEBAR_TASK_VIEW]: viewChoice(
    VIEW_CHOICE_KEY.SIDEBAR_TASK_VIEW,
    VIEW_CHOICE_SCOPE.WORKSPACE,
    Schema.Struct({
      grouping: Schema.Literals(Object.values(TASK_GROUPING)),
      assignedTo: assignedToSchema,
      finishedSubTasks: Schema.Boolean,
    }),
  ),
  [VIEW_CHOICE_KEY.SIDEBAR_FOLDED_GROUPS]: viewChoice(
    VIEW_CHOICE_KEY.SIDEBAR_FOLDED_GROUPS,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    Schema.Array(Schema.NullOr(Schema.String)),
  ),
  [VIEW_CHOICE_KEY.SIDEBAR_PINNED_FOLDED]: viewChoice(
    VIEW_CHOICE_KEY.SIDEBAR_PINNED_FOLDED,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    foldedSchema,
  ),
  [VIEW_CHOICE_KEY.SIDEBAR_FOLLOWING_FOLDED]: viewChoice(
    VIEW_CHOICE_KEY.SIDEBAR_FOLLOWING_FOLDED,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    foldedSchema,
  ),
  [VIEW_CHOICE_KEY.SIDEBAR_TASKS_FOLDED]: viewChoice(
    VIEW_CHOICE_KEY.SIDEBAR_TASKS_FOLDED,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    foldedSchema,
  ),
  [VIEW_CHOICE_KEY.SIDEBAR_MANAGERS_FOLDED]: viewChoice(
    VIEW_CHOICE_KEY.SIDEBAR_MANAGERS_FOLDED,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    foldedSchema,
  ),
  [VIEW_CHOICE_KEY.SIDEBAR_FOLDED_SECTIONS]: viewChoice(
    VIEW_CHOICE_KEY.SIDEBAR_FOLDED_SECTIONS,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    idsSchema,
  ),
  [VIEW_CHOICE_KEY.SIDEBAR_OPENED_TASKS]: viewChoice(
    VIEW_CHOICE_KEY.SIDEBAR_OPENED_TASKS,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    idsSchema.check(Schema.isMaxLength(MAX_OPENED_TASKS)),
  ),
  [VIEW_CHOICE_KEY.INBOX_SHOW]: viewChoice(
    VIEW_CHOICE_KEY.INBOX_SHOW,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    Schema.Literals(Object.values(INBOX_SHOW)),
  ),
  [VIEW_CHOICE_KEY.INBOX_WHOSE]: viewChoice(
    VIEW_CHOICE_KEY.INBOX_WHOSE,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    inboxWhoseSchema,
  ),
  [VIEW_CHOICE_KEY.INBOX_PINNED_FIRST]: viewChoice(
    VIEW_CHOICE_KEY.INBOX_PINNED_FIRST,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    Schema.Boolean,
  ),
  [VIEW_CHOICE_KEY.INBOX_FOLDED_RUNS]: viewChoice(
    VIEW_CHOICE_KEY.INBOX_FOLDED_RUNS,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    Schema.Array(Schema.Literals(INBOX_RUNS)),
  ),
  [VIEW_CHOICE_KEY.AUTOMATIONS_FOLDED]: viewChoice(
    VIEW_CHOICE_KEY.AUTOMATIONS_FOLDED,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    Schema.Array(Schema.Literals(Object.values(AUTOMATION_LIST_GROUP))),
  ),
  [VIEW_CHOICE_KEY.TASKS_FILTER]: viewChoice(
    VIEW_CHOICE_KEY.TASKS_FILTER,
    VIEW_CHOICE_SCOPE.WORKSPACE,
    keptTasksFilterSchema,
  ),
  [VIEW_CHOICE_KEY.TASKS_PAGE_VIEW]: viewChoice(
    VIEW_CHOICE_KEY.TASKS_PAGE_VIEW,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    Schema.Literals(Object.values(TASKS_PAGE_VIEW)),
  ),
  [VIEW_CHOICE_KEY.TASKS_LIST_DISPLAY]: viewChoice(
    VIEW_CHOICE_KEY.TASKS_LIST_DISPLAY,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    keptTasksDisplaySchema,
  ),
  [VIEW_CHOICE_KEY.TASKS_BOARD_DISPLAY]: viewChoice(
    VIEW_CHOICE_KEY.TASKS_BOARD_DISPLAY,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    keptTasksDisplaySchema,
  ),
  [VIEW_CHOICE_KEY.TASKS_LIST_FOLDS]: viewChoice(
    VIEW_CHOICE_KEY.TASKS_LIST_FOLDS,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    tasksListFoldsSchema,
  ),
  [VIEW_CHOICE_KEY.AUTOMATIONS_ORDER]: viewChoice(
    VIEW_CHOICE_KEY.AUTOMATIONS_ORDER,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    Schema.Literals(Object.values(AUTOMATIONS_ORDER)),
  ),
  [VIEW_CHOICE_KEY.ARCHIVED_AGENTS_OPEN]: viewChoice(
    VIEW_CHOICE_KEY.ARCHIVED_AGENTS_OPEN,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    Schema.Boolean,
  ),
  [VIEW_CHOICE_KEY.CONVERSATION_FILTERS]: viewChoice(
    VIEW_CHOICE_KEY.CONVERSATION_FILTERS,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    Schema.Struct({
      hideBots: Schema.Boolean,
      hideResolved: Schema.Boolean,
      descriptionOpen: Schema.Boolean,
      conversationOpen: Schema.Boolean,
    }),
  ),
  [VIEW_CHOICE_KEY.FIND_DETAILS]: viewChoice(
    VIEW_CHOICE_KEY.FIND_DETAILS,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    Schema.Boolean,
  ),
  [VIEW_CHOICE_KEY.MERGE_METHODS]: viewChoice(
    VIEW_CHOICE_KEY.MERGE_METHODS,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    listOf(
      Schema.Struct({ repository: Schema.String, method: mergeMethodSchema }),
      VIEW_CHOICE_LIST_BOUNDS.MERGE_REPOSITORIES,
    ),
  ),
  [VIEW_CHOICE_KEY.FOLLOW_OFFERS_DECLINED]: viewChoice(
    VIEW_CHOICE_KEY.FOLLOW_OFFERS_DECLINED,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    listOf(
      Schema.Struct({
        taskId: Schema.String,
        userIds: listOf(Schema.String, VIEW_CHOICE_LIST_BOUNDS.DECLINED_PEOPLE),
      }),
      VIEW_CHOICE_LIST_BOUNDS.DECLINED_TASKS,
    ),
  ),
  [VIEW_CHOICE_KEY.FAILED_RUNS_SEEN]: viewChoice(
    VIEW_CHOICE_KEY.FAILED_RUNS_SEEN,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    Schema.Record(Schema.String, Schema.String),
  ),
  [VIEW_CHOICE_KEY.RECENT_SECTION_ICONS]: viewChoice(
    VIEW_CHOICE_KEY.RECENT_SECTION_ICONS,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    listOf(taskSectionIconSchema, VIEW_CHOICE_LIST_BOUNDS.RECENT),
  ),
  [VIEW_CHOICE_KEY.RECENT_MANAGER_FACES]: viewChoice(
    VIEW_CHOICE_KEY.RECENT_MANAGER_FACES,
    VIEW_CHOICE_SCOPE.ACCOUNT,
    listOf(managerFaceSchema, VIEW_CHOICE_LIST_BOUNDS.RECENT),
  ),
} as const satisfies { readonly [Key in ViewChoiceKey]: ViewChoice<ViewChoiceSchema> };

/** The value a view choice holds, as a client reads it. */
export type ViewChoiceValue<Key extends ViewChoiceKey> =
  (typeof VIEW_CHOICE)[Key]["schema"]["Type"];

/** How long a value may stand, as its JSON, so no one key holds more than a view needs. */
export const VIEW_CHOICE_BOUNDS = {
  MAX_VALUE_CHARS: 16_384,
} as const;

/**
 * A view choice written: the id its row takes where it is first made in
 * its place, the client's own so it draws the row before the service
 * answers, and passed over where a row already stands there; its key; the
 * workspace it is kept for (null for the account's own); and its value as
 * JSON, which the service reads through the key's own Schema. Null forgets
 * the choice, which then stands at its default on every device.
 */
export const viewChoiceWriteSchema = Schema.Struct({
  id: wireUuidSchema,
  key: Schema.Literals(Object.values(VIEW_CHOICE_KEY)),
  workspaceId: Schema.NullOr(workspaceIdSchema),
  value: WireValueSchema,
});

export type ViewChoiceWrite = typeof viewChoiceWriteSchema.Type;

/** A write as the service answers it: the transaction it committed in, where it changed a row, which the account's live read of its view choices carries. */
export const viewChoiceWrittenSchema = Schema.Struct({
  txid: Schema.optionalKey(Schema.String),
});

export type ViewChoiceWritten = typeof viewChoiceWrittenSchema.Type;

/**
 * Whether `workspaceId` names a place `key` is kept: a workspace for a
 * workspace's choice, and none for the account's own.
 */
export function viewChoicePlaced(key: ViewChoiceKey, workspaceId: string | null): boolean {
  return (VIEW_CHOICE[key].scope === VIEW_CHOICE_SCOPE.WORKSPACE) === (workspaceId !== null);
}

/**
 * The value `key` holds as JSON, read through its Schema and written back
 * out through it, so what is stored is what a client of this build would
 * write; none where the value is not one the key holds, or its JSON runs
 * past the bound.
 */
export function viewChoiceStored(key: ViewChoiceKey, value: WireValue): WireValue | undefined {
  const schema: ViewChoiceSchema = VIEW_CHOICE[key].schema;

  const stored = Schema.decodeUnknownOption(schema)(value).pipe(
    Option.flatMap(Schema.encodeUnknownOption(schema)),
    Option.flatMap(Schema.decodeUnknownOption(WireValueSchema)),
    Option.filter((json) => JSON.stringify(json).length <= VIEW_CHOICE_BOUNDS.MAX_VALUE_CHARS),
  );

  return Option.getOrUndefined(stored);
}
