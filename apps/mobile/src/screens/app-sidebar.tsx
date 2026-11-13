// app-sidebar.tsx -- a wide window's sidebar, as iPad apps stand theirs: the workspace switcher at its head, the Inbox with its count, Tasks, and Search, then Pinned, Following, and the member's sections with their tasks, and Settings at its foot.

import {
  AccountBarItem,
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
import { useOpenSettings, useSettingsAccount } from "../settings-button.js";
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

/** The acts the sidebar's bar holds, as the tab bar's round + and the account's photo name them. */
const NEW_TASK = { label: "New task", symbol: GLYPH.NEW_TASK } as const;
const SETTINGS = { label: "Settings", symbol: GLYPH.SETTINGS } as const;

/** The member's tasks the sidebar lists under its places: Pinned, Following, and each of their sections, as the Tasks tab draws them. */
export type SidebarTasks = {
  /** The sections, each a `ListSection` of task rows. */
  readonly sections: ReactNode;
  /** Every task those sections list, so a task picked elsewhere stands selected here only where the sidebar lists it. */
  readonly ids: ReadonlySet<string>;
  /** The question a row's Mark done asks first while the task's agents work, drawn beside the split view. */
  readonly ask: ReactNode;
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

/** Whether a picked row's id names one of the places rather than a task. */
function placeOf(id: string): (typeof PLACES)[number] | undefined {
  return PLACES.find((place) => place.id === id);
}

/** The place a route stands in, by its first segment, as the sidebar's rows name them. */
export function placeOfRoute(segment: string | undefined): SidebarPlace | undefined {
  return placeOf(segment ?? "")?.id;
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
    sidebarBar: { ...list.bar, leading },
    sidebarShown: shown,
    onSidebarShownChange: setShown,
  };
}

/**
 * The app sidebar of a window wide enough for three columns, an iPad's in
 * landscape, which stands where the system's tab bar would, which that
 * window hides: the place the window stands in, or the task it has open
 * where the sidebar lists it, drawn selected. A place opens its tab, and a
 * task opens on the Tasks tab beside its list, as a link to it does. The
 * switcher's account and Settings at the foot, where an iPad sidebar stands
 * it, both open Settings; New task opens its sheet. The switcher heads the
 * sidebar's list rather than its bar, as Notion's iPad sidebar names its
 * workspace, because a second leading item folds into the bar's overflow
 * beside the sidebar's own button. Note that the tabs' layout draws it once,
 * for every tab, so a tab's switch moves its selection and nothing else.
 */
export function useAppSidebar(
  place: SidebarPlace,
  tasks: SidebarTasks,
  openTask?: string | undefined,
): FirstColumn {
  const router = useRouter();
  const waiting = useInboxBadge();
  const openSettings = useOpenSettings();
  const switcher = useWorkspaceSwitcher();
  const { shown, setShown } = useSidebarShown();
  const header = switcher === undefined ? undefined : <WorkspaceSwitcherItem {...switcher} />;
  const selected = openTask !== undefined && tasks.ids.has(openTask) ? openTask : place;

  const pick = (id: string) => {
    const picked = placeOf(id);

    if (picked !== undefined) router.navigate(picked.route);
    else router.navigate({ pathname: "/tasks", params: { selected: id } });
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
        {tasks.sections}
      </RowList>
    ),
    sidebarBar: {
      action: { ...NEW_TASK, onPress: () => router.push("/start-task") },
      foot: [{ ...SETTINGS, onPress: () => openSettings() }],
    },
    sidebarShown: shown,
    onSidebarShownChange: setShown,
  };
}

/** How a tab's list stands: plain beside the app sidebar, in the sidebar's look where it stands first. */
export function useListLook(): ListLook {
  return useThreeColumns() ? LIST_LOOK.PLAIN : LIST_LOOK.SIDEBAR;
}
