// app-sidebar.tsx -- a regular window's tab roots: each tab's list column beside its detail under the workspace switcher, and New task, the compose button leading the detail's bar where the tab bar has no round +.

import {
  AccountBarItem,
  type BarAction,
  type ColumnBar,
  GLYPH,
  MARK_SIZE,
  SWITCHER_LOOK,
  WorkspaceSwitcherItem,
} from "@repo/ui-native";
import { useIsFocused, useRouter } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { Platform } from "react-native";
import { useSettingsAccount } from "../settings-button.js";
import { useSidebarShown } from "../sidebar-shown.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";

/** New task as the detail's bar offers it, under the compose glyph, as the tab bar's round + names it. */
const NEW_TASK = { label: "New task", symbol: GLYPH.NEW_TASK } as const;

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

/**
 * Whether the tab bar stands its round + for New task: on an iPhone, the
 * iPhone Duo's either posture included, and never on an iPad, read by the
 * device's idiom rather than the window. Note that the + is never hidden as
 * the window crosses between compact and regular, because expo-router keys
 * the tabs' view on the names of the tabs that stand, so a + coming or going
 * would mount every tab again and drop its pages and drafts on each fold,
 * rotation, or resize.
 */
export const PLUS_TAB = !(Platform.OS === "ios" && Platform.isPad);

/**
 * New task where the tab bar has no round + (`PLUS_TAB`): the compose button
 * leading the detail's bar, as Mail's stands over its message, or in a
 * list's or Search's own bar where no detail stands beside it; ⌘N opens it
 * from the menu bar too.
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
 * A regular window's first column, an iPad's or the unfolded Duo's, beside
 * the system's tab sidebar: the tab's list, under the switcher's tile at its
 * bar's leading edge beside the list's title, as the compact bar stands it. Note that the photo leads
 * only until the workspaces are read, as the compact bar's does, so Settings
 * is never out of reach.
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
    // Note that New task leads the detail's bar instead (`useDetailColumnBar`), as in Mail, so the narrow list's bar keeps only its own acts, such as Select mode's Done, and acts it leads with, such as Select all, stand in the switcher's place, as on the iPhone, since a second leading item folds into the bar's overflow.
    sidebarBar: { ...list.bar, leading: (list.bar.lead ?? []).length > 0 ? undefined : leading },
    sidebarShown: focused ? shown : kept,
    // Note that only the split view in front is heard, because a tab kept behind another lays its split view out off screen, which reports its list folded, and that report stood as the person's choice once its tab came back.
    onSidebarShownChange: (next) => {
      if (focused) setShown(next);
    },
  };
}
