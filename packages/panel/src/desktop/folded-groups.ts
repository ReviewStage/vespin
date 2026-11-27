import {
  INBOX_RUNS,
  INBOX_SHOW,
  INBOX_WHOSE,
  type InboxRun,
  type InboxShow,
  type InboxWhose,
  MINE,
} from "@repo/features/inbox-list-model";
import {
  openedTasksBounded,
  openedTasksToggled,
  VIEW_CHOICE_KEY,
  type ViewChoiceKey,
  type ViewChoiceValue,
} from "@repo/features/view-choice-wire";
import { Schema } from "effect";
import { useCallback, useMemo } from "react";
import { useSteadyDoor } from "../steady-door.js";
import { selectFixtureStaged, useAppStateSlice } from "../use-app-state.js";
import { type KeptKey, keptKey, useKept, useKeptLeaving } from "../use-kept.js";
import { type AccountChoice, useAccountChoice } from "../view-choices.js";

/**
 * folded-groups.ts -- which of the sidebar's groups the developer folded, Managers, Pinned, Following, the Tasks head's, and the repositories', kept on the account, what the Inbox lists kept the same way, and how wide its list stands kept on this Mac.
 *
 * A fold is the reader's reading of their own sidebar, as Slack and Notion
 * keep a sidebar's folds, so it is one of the account's view choices
 * (`view-choices.ts`): a group folded on one Mac stands folded on every
 * device, the iPhone's Tasks tab among them. A group is kept by its
 * repository's full name, and the tasks with no repository by null. A
 * repository whose last task goes leaves its entry behind: it is a few
 * bytes, and a task on it later comes back folded as it was left. Pinned is
 * kept under a key of its own, since it is no repository, as are Following
 * and the Tasks head, which folds the sections and the list together
 * whoever's tasks it names, and so are the account's own sections, each by
 * its id. A task's child tasks nested under its row stand folded until it
 * is opened, so the tasks opened are kept, each by its id, under a key of
 * their own, the latest `MAX_OPENED_TASKS` of them (`openedTasksToggled`). A fold this Mac kept
 * itself before the account kept it moves up once (`useKeptMovedUp`). A
 * fixture run starts with every group open and keeps nothing, so its
 * frames never wear a developer's folds. The Inbox's view choices are the
 * account's on the same terms, the scope it shows, whom the items it lists
 * are addressed to, a teammate by their account's id, whether its pinned
 * tasks' items stand first, and which of those runs are folded, so the
 * iPhone's Inbox lists what the Mac's does; a task's own Inbox lists every
 * item it holds, and keeps no choice. A choice kept under a value this
 * build no longer names reads as none, the default, until the next choice
 * is kept. A fixture run keeps none of them. The Inbox list's width stays
 * on this Mac, as a window's sizes do. A fixture run draws no
 * inbox, so it has nothing staged to keep apart. An automation's Runs panel keeps its width and whether it
 * stands on the same terms, one for every automation, as the side panel
 * keeps one for every plan, and so does the tree beside every File and
 * Changes tab, one width for them all, and a page's comments pane, one
 * width for every page.
 */

/** Where the choices are kept in the renderer's storage, the folds kept there before the account kept them. */
const STORAGE_KEY = {
  GROUPS: "app.sidebarFoldedGroups",
  PINNED: "app.sidebarPinnedFolded",
  FOLLOWING: "app.sidebarFollowingFolded",
  TASKS: "app.sidebarTasksFolded",
  MANAGERS: "app.sidebarManagersFolded",
  SECTIONS: "app.sidebarFoldedSections",
  OPENED_TASKS: "app.sidebarOpenedTasks",
  INBOX_SHOW: "app.inboxShow",
  INBOX_WHOSE: "app.inboxWhose",
  INBOX_PINNED_FIRST: "app.inboxPinnedFirst",
  INBOX_FOLDED_RUNS: "app.inboxFoldedRuns",
  INBOX_LIST_WIDTH: "app.inboxListWidth",
  RUNS_PANEL: "app.automationRunsPanel",
  FILE_TREE_WIDTH: "app.fileTreeWidth",
  PAGE_COMMENTS_WIDTH: "app.pageCommentsWidth",
} as const;

/** How wide an automation's Runs panel may stand, as the side panel is bounded. */
/**
 * How wide the tree beside a File or Changes tab may be dragged, in CSS
 * pixels, and where it starts, as stage-cli's file picker is: wide enough
 * for a nested name, never so wide that it takes the diff's room.
 */
export const FILE_TREE_WIDTH = {
  MIN: 220,
  MAX: 480,
  DEFAULT: 264,
} as const;

/**
 * How wide a page's comments pane may be dragged, in CSS pixels, and where
 * it starts: a comment card and the list's insets, as the description's margin
 * holds one, and never so wide that the page beside it loses its reading
 * width's worth of room.
 */
export const PAGE_COMMENTS_WIDTH = {
  MIN: 280,
  MAX: 560,
  DEFAULT: 320,
} as const;

export const RUNS_PANEL_WIDTH = {
  MIN: 280,
  MAX: 560,
  DEFAULT: 340,
} as const;

/**
 * How wide the Inbox's list may be dragged, in CSS pixels, and where it
 * starts: a mail app's message list, as narrow as Linear's Inbox list may
 * be, never so narrow that its head, with the folded sidebar's buttons
 * standing over its start, cannot name the Inbox beside its own buttons,
 * and never so wide that it takes the room the item it reads needs.
 */
export const INBOX_LIST_WIDTH = {
  MIN: 300,
  MAX: 440,
  DEFAULT: 320,
} as const;

/** The folded groups, each by its repository, its creator, or its assignee, null for the plans with none. */
const storedFolds = Schema.fromJsonString(Schema.Array(Schema.NullOr(Schema.String)));

/** Whether Pinned, Following, the Tasks head, or Managers is folded. */
const storedFlag = Schema.fromJsonString(Schema.Boolean);

/** The account's sections folded, or the tasks opened, by id. */
const storedTasks = Schema.fromJsonString(Schema.Array(Schema.String));

/** The Inbox's runs folded, Pinned or everything else. */
const storedRuns = Schema.fromJsonString(Schema.Array(Schema.Literals(INBOX_RUNS)));

/** How wide the Inbox's list stands. */
const storedWidth = Schema.fromJsonString(Schema.Finite);

/** How wide the Runs panel stands, and whether it stands at all. */
const storedRunsPanel = Schema.fromJsonString(
  Schema.Struct({ width: Schema.Finite, open: Schema.Boolean }),
);

/** Whom the items the Inbox lists are addressed to. */
const storedWhose = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal(INBOX_WHOSE.EVERYONE) }),
    Schema.Struct({ kind: Schema.Literal(INBOX_WHOSE.MINE) }),
    Schema.Struct({
      kind: Schema.Literal(INBOX_WHOSE.PERSON),
      userId: Schema.String,
      name: Schema.String,
    }),
  ]),
);

/** Which scope the Inbox shows. */
const storedShow = Schema.fromJsonString(Schema.Literals(Object.values(INBOX_SHOW)));

/** The choices this Mac keeps, each under its own key, and the folds it kept before they moved up to the account. */
const KEPT = {
  INBOX_SHOW: keptKey<InboxShow>(STORAGE_KEY.INBOX_SHOW, storedShow),
  WHOSE: keptKey<InboxWhose>(STORAGE_KEY.INBOX_WHOSE, storedWhose),
  PINNED_FIRST: keptKey(STORAGE_KEY.INBOX_PINNED_FIRST, storedFlag),
  FOLDED_RUNS: keptKey<readonly InboxRun[]>(STORAGE_KEY.INBOX_FOLDED_RUNS, storedRuns),
  FOLDED_GROUPS: keptKey(STORAGE_KEY.GROUPS, storedFolds),
  PINNED_FOLDED: keptKey(STORAGE_KEY.PINNED, storedFlag),
  FOLLOWING_FOLDED: keptKey(STORAGE_KEY.FOLLOWING, storedFlag),
  TASKS_FOLDED: keptKey(STORAGE_KEY.TASKS, storedFlag),
  MANAGERS_FOLDED: keptKey(STORAGE_KEY.MANAGERS, storedFlag),
  FOLDED_SECTIONS: keptKey(STORAGE_KEY.SECTIONS, storedTasks),
  OPENED_TASKS: keptKey(STORAGE_KEY.OPENED_TASKS, storedTasks),
  INBOX_LIST_WIDTH: keptKey(STORAGE_KEY.INBOX_LIST_WIDTH, storedWidth),
  FILE_TREE_WIDTH: keptKey(STORAGE_KEY.FILE_TREE_WIDTH, storedWidth),
  PAGE_COMMENTS_WIDTH: keptKey(STORAGE_KEY.PAGE_COMMENTS_WIDTH, storedWidth),
  RUNS_PANEL: keptKey(STORAGE_KEY.RUNS_PANEL, storedRunsPanel),
} as const;

/** The folds with `held` folded where it was open, and open where it was folded. */
function toggled<K extends string | null>(folded: readonly K[], held: K): K[] {
  return folded.includes(held) ? folded.filter((each) => each !== held) : [...folded, held];
}

/** Whether each group is folded, and the presses that fold or unfold one. */
export interface FoldedGroups {
  folded: (repository: string | null) => boolean;
  toggle: (repository: string | null) => void;
  pinnedFolded: boolean;
  togglePinned: () => void;
  followingFolded: boolean;
  toggleFollowing: () => void;
  /** Whether the Tasks head folds the sections and the list under it. */
  tasksFolded: boolean;
  toggleTasks: () => void;
  managersFolded: boolean;
  toggleManagers: () => void;
  /** Whether one of the account's sections is folded, by its id. */
  sectionFolded: (sectionId: string) => boolean;
  toggleSection: (sectionId: string) => void;
  /** Whether a task's child tasks stand open under its row, by its id; folded until first opened. */
  taskOpened: (taskId: string) => boolean;
  toggleTask: (taskId: string) => void;
}

/** No group folded, and no task opened. */
const NONE: readonly never[] = [];

/** One of the account's own choices, a sidebar fold or the Inbox's, moved up from the name this window kept it under. */
function useMovedUp<Key extends ViewChoiceKey>(
  key: Key,
  kept: KeptKey<ViewChoiceValue<Key>>,
  fallback: ViewChoiceValue<Key>,
  staged: boolean,
): AccountChoice<Key> {
  return useAccountChoice(key, null, fallback, staged, useKeptLeaving(kept));
}

/** Each of the sidebar's folds, as the account keeps it. */
interface FoldChoices {
  readonly groups: AccountChoice<typeof VIEW_CHOICE_KEY.SIDEBAR_FOLDED_GROUPS>;
  readonly pinned: AccountChoice<typeof VIEW_CHOICE_KEY.SIDEBAR_PINNED_FOLDED>;
  readonly following: AccountChoice<typeof VIEW_CHOICE_KEY.SIDEBAR_FOLLOWING_FOLDED>;
  /** The Tasks head's, which folds the sections and the list under it. */
  readonly tasks: AccountChoice<typeof VIEW_CHOICE_KEY.SIDEBAR_TASKS_FOLDED>;
  readonly managers: AccountChoice<typeof VIEW_CHOICE_KEY.SIDEBAR_MANAGERS_FOLDED>;
  /** The account's own sections folded, by id. */
  readonly sections: AccountChoice<typeof VIEW_CHOICE_KEY.SIDEBAR_FOLDED_SECTIONS>;
  /** The tasks whose child tasks stand open under them, by id. */
  readonly opened: AccountChoice<typeof VIEW_CHOICE_KEY.SIDEBAR_OPENED_TASKS>;
}

/** The sidebar's folds, each kept on the account as it is pressed, unless the run is `staged`. */
export function useFoldedGroups(staged: boolean): FoldedGroups {
  const KEY = VIEW_CHOICE_KEY;
  const [openedLeft, forgetOpened] = useKeptLeaving(KEPT.OPENED_TASKS);

  const choices: FoldChoices = {
    groups: useMovedUp(KEY.SIDEBAR_FOLDED_GROUPS, KEPT.FOLDED_GROUPS, NONE, staged),
    pinned: useMovedUp(KEY.SIDEBAR_PINNED_FOLDED, KEPT.PINNED_FOLDED, false, staged),
    following: useMovedUp(KEY.SIDEBAR_FOLLOWING_FOLDED, KEPT.FOLLOWING_FOLDED, false, staged),
    tasks: useMovedUp(KEY.SIDEBAR_TASKS_FOLDED, KEPT.TASKS_FOLDED, false, staged),
    managers: useMovedUp(KEY.SIDEBAR_MANAGERS_FOLDED, KEPT.MANAGERS_FOLDED, false, staged),
    sections: useMovedUp(KEY.SIDEBAR_FOLDED_SECTIONS, KEPT.FOLDED_SECTIONS, NONE, staged),
    opened: useAccountChoice(KEY.SIDEBAR_OPENED_TASKS, null, NONE, staged, [
      openedLeft === undefined ? undefined : openedTasksBounded(openedLeft),
      forgetOpened,
    ]),
  };

  // Note that each press reaches the folds through a steady door and changes the fold standing as it is pressed, so the folds stand as one object until one of them moves, and a list drawn through them is drawn again only then.
  const press = useSteadyDoor((pressed: (folds: FoldChoices) => void) => pressed(choices));
  const groups = choices.groups.value;
  const pinned = choices.pinned.value;
  const following = choices.following.value;
  const tasks = choices.tasks.value;
  const managers = choices.managers.value;
  const sections = choices.sections.value;
  const opened = choices.opened.value;

  return useMemo(
    (): FoldedGroups => ({
      folded: (repository) => groups.includes(repository),
      toggle: (repository) =>
        press((all) => all.groups.change((held) => toggled(held, repository))),
      pinnedFolded: pinned,
      togglePinned: () => press((all) => all.pinned.change((held) => !held)),
      followingFolded: following,
      toggleFollowing: () => press((all) => all.following.change((held) => !held)),
      tasksFolded: tasks,
      toggleTasks: () => press((all) => all.tasks.change((held) => !held)),
      managersFolded: managers,
      toggleManagers: () => press((all) => all.managers.change((held) => !held)),
      sectionFolded: (sectionId) => sections.includes(sectionId),
      toggleSection: (sectionId) =>
        press((all) => all.sections.change((held) => toggled(held, sectionId))),
      taskOpened: (taskId) => opened.includes(taskId),
      toggleTask: (taskId) =>
        press((all) => all.opened.change((held) => openedTasksToggled(held, taskId))),
    }),
    [press, groups, pinned, following, tasks, managers, sections, opened],
  );
}

/** Which scope the window's Inbox shows, and the press that shows another. */
interface InboxShowChoice {
  show: InboxShow;
  onShow: (show: InboxShow) => void;
}

/** Which items the window's Inbox lists, by scope and whom they are addressed to, and the presses that change them, which a Manager's Inbox tab shares (`agent-threads.tsx`). */
export interface InboxScopeChoices extends InboxShowChoice, InboxWhoseChoice {}

/** How the window's Inbox orders what it lists: its pinned tasks' items first, and the runs folded under their headings. */
export interface InboxOrderChoices {
  /** Whether the pinned tasks' items stand first, under a heading of their own. */
  pinnedFirst: boolean;
  onPinnedFirst: (pinnedFirst: boolean) => void;
  /** The runs folded under their headings while the pinned tasks' items stand first. */
  folded: readonly InboxRun[];
  /** Folds a run, or opens it. */
  onFold: (run: InboxRun, folded: boolean) => void;
}

/** What the window's Inbox lists, and the presses that change it. */
export interface InboxViewChoices extends InboxScopeChoices, InboxOrderChoices {}

/** Whom the items the window's Inbox lists are addressed to, and the press that lists another's. */
export interface InboxWhoseChoice {
  whose: InboxWhose;
  onWhose: (whose: InboxWhose) => void;
}

/** No run folded. */
const NO_RUNS: readonly InboxRun[] = [];

/** The Inbox's view choices, Open addressed to the reader, its pinned tasks' items first with no run folded, until first changed, each kept on the account as it is pressed. A fixture run keeps none of them. */
export function useInboxViewChoices(): InboxViewChoices {
  const KEY = VIEW_CHOICE_KEY;
  const staged = useAppStateSlice(selectFixtureStaged) === true;
  const show = useMovedUp(KEY.INBOX_SHOW, KEPT.INBOX_SHOW, INBOX_SHOW.OPEN, staged);
  const whose = useMovedUp(KEY.INBOX_WHOSE, KEPT.WHOSE, MINE, staged);
  const pinnedFirst = useMovedUp(KEY.INBOX_PINNED_FIRST, KEPT.PINNED_FIRST, true, staged);
  const folded = useMovedUp(KEY.INBOX_FOLDED_RUNS, KEPT.FOLDED_RUNS, NO_RUNS, staged);

  // Note that a fold is made over the runs folded as it is pressed, so a menu left open never opens a run folded since.
  const { change: changeFolded } = folded;

  const onFold = useSteadyDoor((run: InboxRun, fold: boolean) =>
    changeFolded((held) =>
      fold ? [...held.filter((each) => each !== run), run] : held.filter((each) => each !== run),
    ),
  );

  // Note that the presses stand as the same doors across draws, so a row handed one draws again only when its choice does.
  const onShow = useSteadyDoor(show.choose);
  const onWhose = useSteadyDoor(whose.choose);
  const onPinnedFirst = useSteadyDoor(pinnedFirst.choose);

  return {
    show: show.value,
    onShow,
    whose: whose.value,
    onWhose,
    pinnedFirst: pinnedFirst.value,
    onPinnedFirst,
    folded: folded.value,
    onFold,
  };
}

/** A width held within the list's bounds, in whole pixels. */
function clampListWidth(width: number): number {
  return Math.min(INBOX_LIST_WIDTH.MAX, Math.max(INBOX_LIST_WIDTH.MIN, Math.round(width)));
}

/** How wide the Inbox's list stands, and the drag that asks for another width. */
export interface InboxListWidth {
  /** Always within {@link INBOX_LIST_WIDTH}. */
  width: number;
  /** Asks for a width; it is clamped to the bounds before it is kept. */
  onResize: (width: number) => void;
}

/** The Inbox list's width, the default until first dragged, and kept as it is. */
export function useInboxListWidth(): InboxListWidth {
  const [kept, keep] = useKept(KEPT.INBOX_LIST_WIDTH, INBOX_LIST_WIDTH.DEFAULT);

  return { width: clampListWidth(kept), onResize: (asked) => keep(clampListWidth(asked)) };
}

/** How wide the tree beside File and Changes tabs stands, and the drag that asks for another width. */
export interface FileTreeWidth {
  /** Always within {@link FILE_TREE_WIDTH}. */
  width: number;
  /** Asks for a width; it is clamped to the bounds before it is kept. */
  onResize: (width: number) => void;
}

/** A tree width held within its bounds, in whole pixels. */
function clampTreeWidth(width: number): number {
  return Math.min(FILE_TREE_WIDTH.MAX, Math.max(FILE_TREE_WIDTH.MIN, Math.round(width)));
}

/** The tree's width, the default until first dragged, and kept as it is. */
export function useFileTreeWidth(): FileTreeWidth {
  const [kept, keep] = useKept(KEPT.FILE_TREE_WIDTH, FILE_TREE_WIDTH.DEFAULT);
  // Note that the drag's door is the same door across draws, so the tree the panel hands every tab is the same tree while nothing changed.
  const onResize = useCallback((asked: number) => keep(clampTreeWidth(asked)), [keep]);

  return { width: clampTreeWidth(kept), onResize };
}

/** A page comments pane's width held within its bounds, in whole pixels. */
function clampPageCommentsWidth(width: number): number {
  return Math.min(PAGE_COMMENTS_WIDTH.MAX, Math.max(PAGE_COMMENTS_WIDTH.MIN, Math.round(width)));
}

/** The width of a page's comments pane, one for every page, the default until first dragged, and kept as it is. */
export function usePageCommentsWidth(): FileTreeWidth {
  const [kept, keep] = useKept(KEPT.PAGE_COMMENTS_WIDTH, PAGE_COMMENTS_WIDTH.DEFAULT);
  const onResize = useCallback((asked: number) => keep(clampPageCommentsWidth(asked)), [keep]);

  return { width: clampPageCommentsWidth(kept), onResize };
}

/** A Runs panel width held within its bounds, in whole pixels. */
function clampRunsWidth(width: number): number {
  return Math.min(RUNS_PANEL_WIDTH.MAX, Math.max(RUNS_PANEL_WIDTH.MIN, Math.round(width)));
}

/** An automation's Runs panel: how wide it stands, whether it stands, and the presses that change them. */
export interface RunsPanel {
  /** Always within {@link RUNS_PANEL_WIDTH}. */
  width: number;
  open: boolean;
  /** Asks for a width; it is clamped to the bounds before it is kept. */
  onResize: (width: number) => void;
  onToggle: () => void;
  /** Shows the panel where it is folded, and is kept so, as a press of its toggle would be. */
  onShow: () => void;
}

/** The Runs panel's width and fold, open at the default width until changed, and kept as they are. */
export function useRunsPanel(): RunsPanel {
  const [stored, keep] = useKept(KEPT.RUNS_PANEL, { width: RUNS_PANEL_WIDTH.DEFAULT, open: true });
  const kept = { width: clampRunsWidth(stored.width), open: stored.open };

  return {
    ...kept,
    onResize: (asked) => keep({ ...kept, width: clampRunsWidth(asked) }),
    onToggle: () => keep({ ...kept, open: !kept.open }),
    onShow: () => {
      if (!kept.open) keep({ ...kept, open: true });
    },
  };
}
