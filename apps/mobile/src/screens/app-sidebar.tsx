// app-sidebar.tsx -- a regular window's sidebar, as Mail's and Linear's stand theirs: the workspace switcher at its head, the Inbox with its count, Tasks, and Search, then Pinned and the member's sections with their tasks, and Settings at its foot.

import {
  type ColumnBar,
  GroupRow,
  LIST_LOOK,
  ListSection,
  RowList,
  WorkspaceSwitcherMenu,
} from "@repo/ui-native";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useInboxBadge } from "../inbox/use-inbox.js";
import { useOpenSettings, useSettingsAccount } from "../settings-button.js";
import { useSidebarShown } from "../sidebar-shown.js";
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
  { id: SIDEBAR_PLACE.INBOX, title: "Inbox", symbol: "tray", route: "/inbox", testId: undefined },
  {
    id: SIDEBAR_PLACE.TASKS,
    title: "Tasks",
    symbol: "checklist",
    route: "/tasks",
    testId: undefined,
  },
  {
    id: SIDEBAR_PLACE.SEARCH,
    title: "Search",
    symbol: "magnifyingglass",
    route: "/search",
    testId: "search-tab",
  },
] as const;

/** The acts the sidebar's bar holds, as the tab bar's round + and the account's photo name them. */
const NEW_TASK = { label: "New task", symbol: "plus" } as const;
const SETTINGS = { label: "Settings", symbol: "gearshape" } as const;

/** The member's tasks the sidebar lists under its places: Pinned and each of their sections, as the Tasks tab draws them. */
export type SidebarTasks = {
  /** The sections, each a `ListSection` of task rows. */
  readonly sections: ReactNode;
  /** Every task those sections list, so a task picked elsewhere stands selected here only where the sidebar lists it. */
  readonly ids: ReadonlySet<string>;
  /** The question a row's Mark done asks first while the task's agents work, drawn beside the split view. */
  readonly ask: ReactNode;
};

/** What a tab's split view takes from the sidebar. */
type SidebarSplit = {
  readonly sidebar: ReactNode;
  readonly sidebarBar: ColumnBar;
  readonly sidebarShown: boolean;
  readonly onSidebarShownChange: (shown: boolean) => void;
};

/** Whether a picked row's id names one of the places rather than a task. */
function placeOf(id: string): (typeof PLACES)[number] | undefined {
  return PLACES.find((place) => place.id === id);
}

/**
 * The sidebar every tab's split view stands in a regular window, standing
 * where the system's tab bar would, which a regular window hides: the place
 * the tab is, or the task it has open where the sidebar lists it, drawn
 * selected. A place opens its tab, and a task opens on the Tasks tab beside
 * its list, as a link to it does. The account's photo and Settings both open
 * Settings, the photo where the iPhone stands it and Settings at the foot,
 * as Linear's iPad sidebar stands it; New task opens its sheet.
 */
export function useAppSidebar(
  place: SidebarPlace,
  tasks: SidebarTasks,
  openTask?: string | undefined,
): { readonly split: SidebarSplit; readonly ask: ReactNode } {
  const router = useRouter();
  const waiting = useInboxBadge();
  const account = useSettingsAccount();
  const openSettings = useOpenSettings();
  const switcher = useWorkspaceSwitcher();
  const { shown, setShown } = useSidebarShown();
  const selected = openTask !== undefined && tasks.ids.has(openTask) ? openTask : place;
  const pick = (id: string) => {
    const picked = placeOf(id);
    if (picked !== undefined) router.navigate(picked.route);
    else router.navigate({ pathname: "/tasks", params: { selected: id } });
  };
  const sidebar = (
    <RowList look={LIST_LOOK.SIDEBAR} selected={selected} onSelect={pick}>
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
  );
  return {
    split: {
      sidebar,
      sidebarBar: {
        account,
        header: switcher === undefined ? undefined : <WorkspaceSwitcherMenu {...switcher} />,
        action: { ...NEW_TASK, onPress: () => router.push("/start-task") },
        foot: [{ ...SETTINGS, onPress: openSettings }],
      },
      sidebarShown: shown,
      onSidebarShownChange: setShown,
    },
    ask: tasks.ask,
  };
}
