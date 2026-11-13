// app-sidebar.tsx -- a wide window's sidebar, as iPad apps stand theirs: the workspace switcher at its head, the Inbox with its count, Tasks, and Search, then Pinned, Following, and the member's sections, each a collection of tasks with its count, as Mail lists its mailboxes; and New task, the list column's compose button.

import {
  AccountBarItem,
  type BarAction,
  type ColumnBar,
  GLYPH,
  GroupRow,
  LIST_LOOK,
  type ListLook,
  ListSection,
  MARK_SIZE,
  RowList,
  SWITCHER_LOOK,
  WorkspaceSwitcherItem,
} from "@repo/ui-native";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useInboxBadge } from "../inbox/use-inbox.js";
import { useSettingsAccount } from "../settings-button.js";
import { keepSidebarPlace, keepTasksCollection, useTasksCollection } from "../sidebar-pick.js";
import { useSidebarShown } from "../sidebar-shown.js";
import { useThreeColumns } from "../use-window-size-class.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";

/** The places the sidebar's first rows open, each a tab's root. */
export const SIDEBAR_PLACE = {
  INBOX: "inbox",
  TASKS: "tasks",
  SEARCH: "search",
} as const;

export type SidebarPlace = (typeof SIDEBAR_PLACE)[keyof typeof SIDEBAR_PLACE];

/**
 * Each place's row and the tab root it opens, in the sidebar's order. Note
 * that Search carries the Search tab's own id, since the sidebar stands for
 * the tab bar a regular window hides, so a flow finds it the same way in
 * either window.
 */
const PLACES = [
  {
    id: SIDEBAR_PLACE.INBOX,
    title: "Inbox",
    symbol: GLYPH.INBOX,
    route: "/inbox",
    testId: undefined,
  },
  {
    id: SIDEBAR_PLACE.TASKS,
    title: "Tasks",
    symbol: GLYPH.TASK,
    route: "/tasks",
    testId: undefined,
  },
  {
    id: SIDEBAR_PLACE.SEARCH,
    title: "Search",
    symbol: GLYPH.SEARCH,
    route: "/search",
    testId: "search-tab",
  },
] as const;

/** New task as a list's bar offers it, under the compose glyph, as the tab bar's round + names it. */
const NEW_TASK = { label: "New task", symbol: GLYPH.NEW_TASK } as const;

/** The collections of tasks the sidebar lists under its places: Pinned, Following, and each of the member's sections. */
export type SidebarTasks = {
  /** A `GroupRow` for each, with its count, which takes a task dropped on it where it can hold one. */
  readonly rows: ReactNode;
  /** Each one's key, so a collection picked before and gone since, such as a deleted section, stands as Tasks. */
  readonly keys: ReadonlySet<string>;
};

/** The list a tab's split view stands beside its detail, and its bar: its title, its menu, and its search. */
type ListColumn = { readonly view: ReactNode; readonly bar: ColumnBar };

/** Whether the first column stands, and how a person shows or hides it, as every split view takes it. */
type SidebarVisibility = {
  readonly sidebarShown: boolean;
  readonly onSidebarShownChange: (shown: boolean) => void;
};

/** A split view's first column and its bar. */
type FirstColumn = SidebarVisibility & {
  readonly sidebar: ReactNode;
  readonly sidebarBar: ColumnBar;
};

/** Whether a picked row's id names one of the places rather than a collection of tasks. */
function placeOf(id: string): (typeof PLACES)[number] | undefined {
  return PLACES.find((place) => place.id === id);
}

/** The place a route stands in, by its first segment, as the sidebar's rows name them. */
export function placeOfRoute(segment: string | undefined): SidebarPlace | undefined {
  return placeOf(segment ?? "")?.id;
}

/** The tab root a place opens. */
export function placeRoute(place: SidebarPlace): string {
  return PLACES.find((each) => each.id === place)?.route ?? "/inbox";
}

/**
 * New task as every list column's bar offers it in a regular window, its one
 * trailing act beside the list's search and ⋯, as Mail's compose button
 * stands over its list; ⌘N opens it from the menu bar too. A compact
 * window keeps the tab bar's round + instead.
 */
export function useComposeAction(): BarAction {
  const router = useRouter();

  return { ...NEW_TASK, onPress: () => router.push("/start-task") };
}

/**
 * A regular window's first column where it is too narrow for three, a
 * portrait iPad's or the unfolded Duo's, which keeps the system's tab bar:
 * the tab's list, under the switcher's tile at its bar's leading edge beside
 * the list's title, as the compact bar stands it. Note that the photo leads
 * only until the workspaces are read, as the compact bar's does, so Settings
 * is never out of reach.
 */
export function useListColumn(list: ListColumn): FirstColumn {
  const compose = useComposeAction();
  const account = useSettingsAccount();
  const switcher = useWorkspaceSwitcher();
  const { shown, setShown } = useSidebarShown();

  const leading =
    switcher !== undefined ? (
      <WorkspaceSwitcherItem
        {...switcher}
        look={SWITCHER_LOOK.TILE}
        tileSize={MARK_SIZE.COLUMN_BAR_FACE}
      />
    ) : account === undefined ? undefined : (
      <AccountBarItem {...account} />
    );

  return {
    sidebar: list.view,
    // Note that an action the list's bar names, such as Select mode's Done, stands in New task's place.
    sidebarBar: { ...list.bar, leading, action: list.bar.action ?? compose },
    sidebarShown: shown,
    onSidebarShownChange: setShown,
  };
}

/**
 * The app sidebar of a window wide enough for three columns, an iPad's in
 * landscape, which stands where the system's tab bar would, which that
 * window hides, as Mail stands its mailboxes: the Inbox with its count,
 * Tasks, and Search, then Pinned, Following, and each of the member's
 * sections as one row with its count. A row fills the list column (Tasks
 * every task, a collection only its own), so no task stands both as a
 * sidebar row and in the list beside it, and the row picked is drawn
 * selected, with the list's own selection beside it. A task dragged onto
 * Pinned or a section is put there, as onto the Tasks list's headers. The
 * pick is kept, so a rotation or the next launch comes back to it
 * (`sidebar-pick.ts`). The switcher heads the list rather than the bar, as
 * Notion's iPad sidebar names its workspace, because a second leading item
 * folds into the bar's overflow beside the sidebar's own button; the bar
 * holds nothing else, since New task stands over the list it starts from
 * and Settings opens from the switcher's menu and ⌘,, as Notion's and
 * Linear's iPad sidebars keep it. Until the workspaces are read and the
 * switcher can draw, the account's photo leads the bar, so Settings is
 * never out of reach. Note that the tabs' layout draws it once, for every
 * tab, so a tab's switch moves its selection and nothing else, and that it
 * tells `onPick` the place a row picks before it navigates there, so the
 * split view can stand the pick at once.
 */
export function useAppSidebar(
  place: SidebarPlace,
  tasks: SidebarTasks,
  onPick: (picked: SidebarPlace) => void,
): FirstColumn {
  const router = useRouter();
  const waiting = useInboxBadge();
  const account = useSettingsAccount();
  const switcher = useWorkspaceSwitcher();
  const collection = useTasksCollection();
  const { shown, setShown } = useSidebarShown();
  const header = switcher === undefined ? undefined : <WorkspaceSwitcherItem {...switcher} />;

  const selected =
    place === SIDEBAR_PLACE.TASKS && collection !== undefined && tasks.keys.has(collection)
      ? collection
      : place;

  const pick = (id: string) => {
    const picked = placeOf(id)?.id ?? SIDEBAR_PLACE.TASKS;

    keepSidebarPlace(picked);

    // Note that Tasks picks every task, a collection's row its own key, and the Inbox and Search leave the collection where it was.
    if (picked === SIDEBAR_PLACE.TASKS)
      keepTasksCollection(placeOf(id) === undefined ? id : undefined);

    onPick(picked);
    router.navigate(placeRoute(picked));
  };

  return {
    sidebar: (
      <RowList look={LIST_LOOK.SIDEBAR} selected={selected} onSelect={pick}>
        {header === undefined ? null : <ListSection>{header}</ListSection>}
        <ListSection>
          {PLACES.map((each) => (
            <GroupRow
              key={each.id}
              id={each.id}
              title={each.title}
              symbol={each.symbol}
              testId={each.testId}
              count={each.id === SIDEBAR_PLACE.INBOX && waiting > 0 ? waiting : undefined}
            />
          ))}
        </ListSection>
        {tasks.keys.size === 0 ? null : <ListSection>{tasks.rows}</ListSection>}
      </RowList>
    ),
    sidebarBar: {
      // Note that the photo leads only until the switcher heads the list, so the bar never stands two leading items, which fold into its overflow.
      leading:
        switcher === undefined && account !== undefined ? (
          <AccountBarItem {...account} />
        ) : undefined,
    },
    sidebarShown: shown,
    onSidebarShownChange: setShown,
  };
}

/** How a tab's list stands: plain beside the app sidebar, in the sidebar's look where it stands first. */
export function useListLook(): ListLook {
  return useThreeColumns() ? LIST_LOOK.PLAIN : LIST_LOOK.SIDEBAR;
}
