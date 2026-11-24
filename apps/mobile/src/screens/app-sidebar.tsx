// app-sidebar.tsx -- a regular window's tab roots: an iPad's own sidebar of places with the workspace and account at its foot, each tab's list column beside its detail, and New task, the compose button leading the detail's bar where the tab bar has no round +.

import {
  AccountBarItem,
  type AppColumn,
  type BarAction,
  type ColumnBar,
  GLYPH,
  LIST_LOOK,
  ListSection,
  MARK_SIZE,
  PlaceRow,
  RowList,
  SWITCHER_LOOK,
  WorkspaceSwitcherItem,
} from "@repo/ui-native";
import { useIsFocused, useRouter } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import { useInboxShown } from "../inbox/inbox-shown.js";
import { useInboxBadge } from "../inbox/use-inbox.js";
import { useSettingsAccount } from "../settings-button.js";
import { APP_SIDEBAR, useSidebarShown } from "../sidebar-shown.js";
import { useSidebarTasks } from "../sidebar-tasks.js";
import { SPLIT_TAB, showSplitList } from "../split-route.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";

/** New task as the detail's bar offers it, under the compose glyph, as the tab bar's round + names it. */
const NEW_TASK = { label: "New task", symbol: GLYPH.NEW_TASK } as const;

/** The places an iPad's own sidebar goes to, by the ids its list picks them by, as the panel's sidebar heads its tasks with them. */
export const SIDEBAR_PLACE = {
  SEARCH: "place-search",
  INBOX: "place-inbox",
  TASKS: "place-tasks",
  AUTOMATIONS: "place-automations",
} as const;

export type SidebarPlace = (typeof SIDEBAR_PLACE)[keyof typeof SIDEBAR_PLACE];

/** Each place's name, as the panel's sidebar names it. */
const PLACE_WORDS = {
  [SIDEBAR_PLACE.SEARCH]: "Search",
  [SIDEBAR_PLACE.INBOX]: "Inbox",
  [SIDEBAR_PLACE.TASKS]: "Tasks",
  [SIDEBAR_PLACE.AUTOMATIONS]: "Automations",
} as const satisfies Record<SidebarPlace, string>;

/** What a tab's root does with a press in its sidebar that it answers itself, rather than going to another tab. */
type SidebarDoors = {
  /** Stands Tasks' whole list, where Tasks is the tab in front. */
  readonly onTasks?: (() => void) | undefined;
  /** Picks a task beside the sidebar, where Tasks is the tab in front. */
  readonly onTask?: ((id: string) => void) | undefined;
};

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

/** A split view's list column and its bar, after an iPad's own sidebar where one stands. */
type FirstColumn = SidebarVisibility & {
  readonly app: AppColumn | undefined;
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

/**
 * An iPad's own sidebar, the first column of each tab's split view, as the
 * panel's sidebar stands: its places (Search, the Inbox with what waits on
 * the reader, Tasks, and Automations),
 * then the tasks, as the Tasks list draws them, read once for every tab
 * (`useSidebarTasks`), the place or task in front (`here`) standing
 * selected, and at its foot, in the system's glass, the workspace switcher
 * with the account's photo opening Settings beside it, as the panel's foot
 * holds the account. A press on Tasks while Tasks stands calls `onTasks`,
 * which stands its whole list again, and on a task `onTask`, which picks
 * it; from another tab each opens Tasks so. Note that a tab behind another
 * keeps the sidebar as it last stood in front, as its list does
 * (`useListColumn`). None stands but on an iPad (`APP_SIDEBAR`).
 */
export function useAppColumn(
  /** The place in front (`SIDEBAR_PLACE`), or the task picked beside the sidebar, by its id. */
  here: string | undefined,
  { onTasks, onTask }: SidebarDoors = {},
): AppColumn | undefined {
  const router = useRouter();
  const account = useSettingsAccount();
  const switcher = useWorkspaceSwitcher();
  const inboxShown = useInboxShown();
  const waiting = useInboxBadge();
  const tasks = useSidebarTasks();
  const { shown, setShown } = useSidebarShown();
  const focused = useIsFocused();
  const [kept, keep] = useState(shown);

  useEffect(() => {
    if (focused) keep(shown);
  }, [focused, shown]);

  if (!APP_SIDEBAR) return undefined;

  const go = (id: string) => {
    switch (id) {
      case SIDEBAR_PLACE.SEARCH:
        return router.navigate("/search");
      case SIDEBAR_PLACE.INBOX:
        return router.navigate("/inbox");
      case SIDEBAR_PLACE.TASKS:
        if (onTasks !== undefined) return onTasks();

        showSplitList(SPLIT_TAB.TASKS);

        return router.navigate("/tasks");
      case SIDEBAR_PLACE.AUTOMATIONS:
        return router.navigate("/automations");
    }

    if (tasks?.opens(id) === true) return;

    // Note that a task opens beside the sidebar on Tasks, picked where Tasks stands and handed to its root from another tab, as a link to it is.
    if (onTask !== undefined) return onTask(id);

    router.navigate({ pathname: SPLIT_TAB.TASKS, params: { selected: id } });
  };

  // Note that the switcher's menu ends in Settings too, so the account's photo beside it stands only once the workspaces are read, and the photo alone stands until then.
  const bottom =
    switcher !== undefined
      ? {
          leading: <WorkspaceSwitcherItem {...switcher} look={SWITCHER_LOOK.NAMED} />,
          trailing: account === undefined ? undefined : <AccountBarItem {...account} />,
        }
      : account === undefined
        ? undefined
        : { leading: <AccountBarItem {...account} /> };

  return {
    view: (
      <RowList look={LIST_LOOK.PLAIN} selected={here} onSelect={go}>
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
        </ListSection>
        {tasks?.sections}
      </RowList>
    ),
    bar: { bottom },
    shown: focused ? shown : kept,
    // Note that only the split view in front is heard, because a tab kept behind another lays its split view out off screen.
    onShownChange: (next) => {
      if (focused) setShown(next);
    },
  };
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
 * A regular window's list column, an iPad's after its own sidebar
 * (`useAppColumn`, which `place` names the place in front of) or the
 * unfolded Duo's beside the system's tab sidebar: the tab's list, under the
 * switcher's tile at its bar's leading edge beside the list's title, as the
 * compact bar stands it, but on an iPad, whose sidebar holds the switcher at
 * its foot. Note that the photo leads only until the workspaces are read, as
 * the compact bar's does, so Settings is never out of reach. Note that an
 * iPad's list always stands, as Mail's message list does beside its
 * mailboxes, so the system's sidebar button folds the sidebar alone.
 */
export function useListColumn(list: ListColumn, place: SidebarPlace): FirstColumn {
  const app = useAppColumn(place);
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
    app,
    sidebar: list.view,
    // Note that New task leads the detail's bar instead (`useDetailColumnBar`), as in Mail, so the narrow list's bar keeps only its own acts, such as Select mode's Done, and acts it leads with, such as Select all, stand in the switcher's place, as on the iPhone, since a second leading item folds into the bar's overflow.
    sidebarBar: {
      ...list.bar,
      leading: app !== undefined || (list.bar.lead ?? []).length > 0 ? undefined : leading,
    },
    // Note that the list always stands while no row is picked, as Mail opens a mailbox on its list, because the detail has no page to stand alone with; the split view folds its list on its own in a portrait window, which left a tab opening on "No item selected" alone.
    sidebarShown: app !== undefined || !list.chosen || (focused ? shown : kept),
    // Note that only the split view in front with a row picked is heard, because a tab kept behind another lays its split view out off screen, which reports its list folded, and a fold with nothing picked is the split view's own, never the person's choice.
    onSidebarShownChange: (next) => {
      if (app === undefined && focused && list.chosen) setShown(next);
    },
  };
}
