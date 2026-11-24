// app-sidebar.tsx -- a regular window's tab roots: an iPad's own sidebar of places and tasks beside the tabs, with the workspace and account at its foot, each tab's list column beside its detail, and New task, the compose button leading the detail's bar where the tab bar has no round +.

import { IOS_TAB, type IosTab, iosTabOfGroup } from "@repo/features/ios-app-links";
import { MERGE_QUEUE_PAGE_WORDS } from "@repo/features/merge-queue-model";
import {
  AccountBarItem,
  type BarAction,
  type ColumnBar,
  GLYPH,
  LIST_LOOK,
  ListSection,
  MARK_SIZE,
  PlaceRow,
  RowList,
  SidebarColumn,
  SWITCHER_LOOK,
  WorkspaceSwitcherItem,
  WorkspaceSwitcherRow,
} from "@repo/ui-native";
import { useIsFocused, useRouter, useSegments } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import { useInboxShown } from "../inbox/inbox-shown.js";
import { useInboxBadge } from "../inbox/use-inbox.js";
import { MERGE_QUEUE_ROUTE, useMergeQueueOn } from "../merge-queue/merge-queue-on.js";
import { useSettingsAccount } from "../settings-button.js";
import { APP_SIDEBAR, useSidebarShown } from "../sidebar-shown.js";
import { useSidebarTasks } from "../sidebar-tasks.js";
import { showPickedPage } from "../split-columns.js";
import { SPLIT_TAB, useSplitPicked } from "../split-route.js";
import { tabGroupOf, useOnTab } from "../tab-route.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";

/** New task as the detail's bar offers it, under the compose glyph, as the tab bar's round + names it. */
const NEW_TASK = { label: "New task", symbol: GLYPH.NEW_TASK } as const;

/** The places an iPad's own sidebar goes to, by the ids its list picks them by, as the panel's sidebar heads its tasks with them. */
const SIDEBAR_PLACE = {
  SEARCH: "place-search",
  INBOX: "place-inbox",
  TASKS: "place-tasks",
  AUTOMATIONS: "place-automations",
  MERGE_QUEUE: "place-merge-queue",
} as const;

type SidebarPlace = (typeof SIDEBAR_PLACE)[keyof typeof SIDEBAR_PLACE];

/** Each place's name, as the panel's sidebar names it. */
const PLACE_WORDS = {
  [SIDEBAR_PLACE.SEARCH]: "Search",
  [SIDEBAR_PLACE.INBOX]: "Inbox",
  [SIDEBAR_PLACE.TASKS]: "Tasks",
  [SIDEBAR_PLACE.AUTOMATIONS]: "Automations",
  [SIDEBAR_PLACE.MERGE_QUEUE]: MERGE_QUEUE_PAGE_WORDS.TITLE,
} as const satisfies Record<SidebarPlace, string>;

/** The list a tab's split view stands beside its detail, and its bar: its title, its menu, and its search. */
type ListColumn = {
  readonly view: ReactNode;
  readonly bar: ColumnBar;
  /** Whether a row is picked, whose page stands in the detail; with none, the list always stands. */
  readonly chosen: boolean;
};

/** Whether the first column stands, and how a person shows or hides it, as every split view takes it. */
type SidebarVisibility = {
  readonly sidebarShown: boolean;
  readonly onSidebarShownChange: (shown: boolean) => void;
};

/** A split view's list column and its bar. */
type FirstColumn = SidebarVisibility & {
  readonly sidebar: ReactNode;
  readonly sidebarBar: ColumnBar;
};

/**
 * Whether the tab bar stands its round + for New task: on an iPhone, the
 * iPhone Duo's either posture included, and never on an iPad, read by the
 * device's idiom rather than the window. Note that the + is never hidden as
 * the window crosses between compact and regular, because expo-router keys
 * the tabs' view on the names of the tabs that stand, so a + coming or going
 * would mount every tab again and drop its pages and drafts on each fold,
 * rotation, or resize.
 */
export const PLUS_TAB = !APP_SIDEBAR;

/** The last segment of the Merge queue's route, by which the sidebar knows its page stands in front. */
const MERGE_QUEUE_SEGMENT = MERGE_QUEUE_ROUTE.split("/").at(-1);

/** The place a tab stands for in the sidebar, by the tab's group. */
const TAB_PLACE = {
  [IOS_TAB.INBOX]: SIDEBAR_PLACE.INBOX,
  [IOS_TAB.TASKS]: SIDEBAR_PLACE.TASKS,
  [IOS_TAB.AUTOMATIONS]: SIDEBAR_PLACE.AUTOMATIONS,
  [IOS_TAB.SEARCH]: SIDEBAR_PLACE.SEARCH,
} as const satisfies Record<IosTab, SidebarPlace>;

/**
 * What the sidebar stands selected: the tab in front's place, or on Tasks
 * the task picked beside it, by its id. Note that while no tab stands, as
 * under a sheet over the tabs, it keeps what it last stood on.
 */
function useSidebarHere(): string | undefined {
  const segments: readonly string[] = useSegments();
  const tab = iosTabOfGroup(tabGroupOf(segments));
  // Note that the Merge queue's page, pushed on a tab's stack, stands its own row selected, as the panel's sidebar stands its place.
  const queued = segments.at(-1) === MERGE_QUEUE_SEGMENT;
  const pickedTask = useSplitPicked(SPLIT_TAB.TASKS);

  const here = queued
    ? SIDEBAR_PLACE.MERGE_QUEUE
    : tab === undefined
      ? undefined
      : tab === IOS_TAB.TASKS
        ? (pickedTask ?? TAB_PLACE[tab])
        : TAB_PLACE[tab];

  const [kept, keep] = useState(here);

  useEffect(() => {
    if (here !== undefined) keep(here);
  }, [here]);

  return here ?? kept;
}

/**
 * An iPad's own sidebar, standing beside the tabs as the panel's sidebar
 * stands beside its pages, so every page, a pushed one included, keeps it
 * beside it: Hide Sidebar heading it; its places (Search, the Inbox with
 * what waits on the reader, Tasks, Automations, and Merge queue, while the
 * account has it on); then the tasks, as the Tasks list draws them, read once
 * above the tabs (`useSidebarTasks`); the place or task in front standing
 * selected (`useSidebarHere`), under the workspace switcher heading the
 * list, as the panel's sidebar heads itself; and at its foot, in the
 * system's glass, the account's photo and name opening its menu (Settings,
 * Send feedback) with Settings' gear at its end, as the panel's foot holds
 * them. Its list is the system's sidebar list, so it keeps the system's
 * keyboard focus, arrow keys and pointer hover. A place opens its tab; Tasks opens
 * on its whole list, and a task beside the sidebar on Tasks, as a link to
 * it does. It is drawn once, by the tabs' layout, and only on an iPad.
 */
export function AppSidebarPane() {
  const router = useRouter();
  const switcher = useWorkspaceSwitcher();
  const inboxShown = useInboxShown();
  const waiting = useInboxBadge();
  const tasks = useSidebarTasks();
  const here = useSidebarHere();
  const mergeQueueOn = useMergeQueueOn();
  const onTab = useOnTab();
  const compose = useComposeAction();

  const go = (id: string) => {
    switch (id) {
      case SIDEBAR_PLACE.SEARCH:
        return router.navigate("/search");
      case SIDEBAR_PLACE.INBOX:
        return router.navigate("/inbox");
      case SIDEBAR_PLACE.TASKS:
        return router.navigate(SPLIT_TAB.TASKS);
      case SIDEBAR_PLACE.AUTOMATIONS:
        return router.navigate("/automations");
      case SIDEBAR_PLACE.MERGE_QUEUE:
        return router.push(onTab(MERGE_QUEUE_ROUTE));
    }

    if (tasks?.opens(id) === true) return;

    // Note that a task opens beside the sidebar on Tasks, handed to its root as a link to it is, which pops any page pushed over the root.
    router.navigate({ pathname: SPLIT_TAB.TASKS, params: { selected: id } });
    showPickedPage();
  };

  return (
    <SidebarColumn
      view={
        <RowList look={LIST_LOOK.SIDEBAR} selected={here} onSelect={go}>
          {/* Note that the workspace heads the sidebar, as the panel's does, its menu holding the workspaces, Manage, and the account's Settings. */}
          {switcher === undefined ? null : (
            <WorkspaceSwitcherRow
              {...switcher}
              compose={{ label: compose.label, symbol: GLYPH.NEW_TASK, onPress: compose.onPress }}
            />
          )}
          <ListSection>
            <PlaceRow
              id={SIDEBAR_PLACE.SEARCH}
              symbol={GLYPH.SEARCH}
              label={PLACE_WORDS[SIDEBAR_PLACE.SEARCH]}
            />
            {inboxShown ? (
              <PlaceRow
                id={SIDEBAR_PLACE.INBOX}
                symbol={GLYPH.INBOX}
                label={PLACE_WORDS[SIDEBAR_PLACE.INBOX]}
                count={waiting}
              />
            ) : null}
            <PlaceRow
              id={SIDEBAR_PLACE.TASKS}
              symbol={GLYPH.TASK}
              label={PLACE_WORDS[SIDEBAR_PLACE.TASKS]}
            />
            <PlaceRow
              id={SIDEBAR_PLACE.AUTOMATIONS}
              symbol={GLYPH.AUTOMATION}
              label={PLACE_WORDS[SIDEBAR_PLACE.AUTOMATIONS]}
            />
            {/* Note that Merge queue stands only while the account has it on, as the panel's row does. */}
            {mergeQueueOn ? (
              <PlaceRow
                id={SIDEBAR_PLACE.MERGE_QUEUE}
                symbol={GLYPH.QUEUED}
                label={PLACE_WORDS[SIDEBAR_PLACE.MERGE_QUEUE]}
              />
            ) : null}
          </ListSection>
          {tasks?.sections}
        </RowList>
      }
    />
  );
}

/**
 * New task's compose: leading the detail's bar where the tab bar has no
 * round + (`PLUS_TAB`), as Mail's stands over its message, and ending the
 * Inbox's and Tasks' own bars in a compact window, as Messages' stands;
 * ⌘N opens it from the menu bar too.
 */
export function useComposeAction(): BarAction {
  const router = useRouter();

  return { ...NEW_TASK, onPress: () => router.push("/start-task") };
}

/**
 * The detail's bar beside a regular window's list column, led on an iPad by
 * New task's compose, as Mail's stands over its message. The open Duo keeps
 * the tab rail's round + instead, so no window offers New task twice.
 */
export function useDetailColumnBar(bar: ColumnBar | undefined): ColumnBar {
  const compose = useComposeAction();

  return PLUS_TAB ? { ...bar } : { ...bar, lead: [compose] };
}

/**
 * Which build of a tab's split view stands, as a key for the `Screen` that
 * hosts it: bumped once after an iPad turns, for a split view that stood
 * unselected since it was last built, and only once it is in front again.
 * Note that it rebuilds rather than lays out again, because SwiftUI's split
 * view, once its tab's view has left the window, keeps a bar's height above
 * its columns from before the turn, a band no inset of ours or re-layout
 * clears, while one built since and kept in front turns as it should. The
 * pick and the list's open groups are held above it, so they outlive the
 * rebuild; its list's scroll place does not.
 */
export function useSplitBuild(): number {
  const focused = useIsFocused();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const [build, setBuild] = useState(0);
  // Whether the split view has stood unselected since it was last built.
  const stale = useRef(!focused);
  // Which way the window stood when the split view was last built or last caught up in front.
  const builtLandscape = useRef(landscape);

  useEffect(() => {
    if (!focused) stale.current = true;
  }, [focused]);

  useEffect(() => {
    if (!focused || builtLandscape.current === landscape) return;

    builtLandscape.current = landscape;

    if (!stale.current) return;

    stale.current = false;
    setBuild((last) => last + 1);
  }, [focused, landscape]);

  return build;
}

/**
 * A regular window's list column, an iPad's beside its own sidebar
 * (`AppSidebarPane`) or the unfolded Duo's beside the system's tab sidebar:
 * the tab's list, under the switcher's tile at its bar's leading edge beside
 * the list's title, as the compact bar stands it, but on an iPad, whose
 * sidebar holds the switcher at its foot and whose list's bar leads with
 * Show Sidebar while the sidebar is folded. Note that the photo leads only
 * until the workspaces are read, as the compact bar's does, so Settings is
 * never out of reach. Note that an iPad's list always stands, as Mail's
 * message list does beside its mailboxes (`listFixed`).
 */
export function useListColumn(list: ListColumn): FirstColumn {
  const account = useSettingsAccount();
  const switcher = useWorkspaceSwitcher();
  const { shown, setShown } = useSidebarShown();
  const focused = useIsFocused();
  // Note that a tab behind another keeps the list as it last stood in front, because a split view handed a change off screen, such as the fold a portrait turn brings, never takes the change back once its tab returns.
  const [kept, keep] = useState(shown);

  useEffect(() => {
    if (focused) keep(shown);
  }, [focused, shown]);

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
    // Note that New task leads the detail's bar instead (`useDetailColumnBar`), as in Mail, so the narrow list's bar keeps only its own acts, such as Select mode's Done, and acts it leads with, such as Select all, stand in the switcher's place, as on the iPhone, since a second leading item folds into the bar's overflow; an iPad's sidebar holds the switcher, so its list's bar stands none.
    sidebarBar: {
      ...list.bar,
      leading: APP_SIDEBAR || (list.bar.lead ?? []).length > 0 ? undefined : leading,
    },
    // Note that the list always stands while no row is picked, as Mail opens a mailbox on its list, because the detail has no page to stand alone with; the split view folds its list on its own in a portrait window, which left a tab opening on "No item selected" alone.
    sidebarShown: !list.chosen || (focused ? shown : kept),
    // Note that only the split view in front with a row picked is heard, because a tab kept behind another lays its split view out off screen, which reports its list folded, and a fold with nothing picked is the split view's own, never the person's choice.
    onSidebarShownChange: (next) => {
      if (focused && list.chosen) setShown(next);
    },
  };
}
