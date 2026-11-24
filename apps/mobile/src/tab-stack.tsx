// tab-stack.tsx -- a tab's native stack: a large title in the ink on its root and inline ones on its pages, round glass back buttons and, on an iPad with its sidebar folded, Show Sidebar beside them, its items in the brand's copper, its bar clear over the brand's ground.

import { BAR_TITLE, SidebarStackButton, useBarScheme, useColors } from "@repo/ui-native";
import { Stack } from "expo-router";
import { useSidebarShowAction } from "./screens/app-sidebar.js";

/**
 * How many screens pushed over a screen in its own tab's stack let it rest
 * in React's Activity: two, so a screen two pages back rests. Note that it
 * is never one, because Expo Router rests a screen at one on focus alone
 * rather than on the pages over it (`useActivityMode`), so a sheet over the
 * tab, such as Settings, rested its root too, and the root's bar items,
 * which its effects declare, left the bar under the sheet and came back with
 * a jump as it closed.
 */
const COVERED_SCREENS_REST = 2;

/** The tab roots that stand a split view under no header of the stack's: the Inbox's and Tasks', by their routes in the stack. */
const SPLIT_ROOT = {
  INBOX: "inbox/index",
  TASKS: "tasks/index",
} as const;

const SPLIT_ROOTS: ReadonlySet<string> = new Set(Object.values(SPLIT_ROOT));

/** Every tab's root, by its route in the stack: the split roots and Search's, the screens that stand a large title. */
const TAB_ROOT = {
  ...SPLIT_ROOT,
  SEARCH: "search/index",
  AUTOMATIONS: "automations/index",
} as const;

const TAB_ROOTS: ReadonlySet<string> = new Set(Object.values(TAB_ROOT));

/**
 * Every tab's stack: the system's own headers with no ground of their own
 * and no rule under them, and the back button the system's round glass
 * chevron alone, its items in the brand's tint. A tab's root names itself
 * in a large title under its bar, which collapses into the bar as its list
 * scrolls, as Mail, Notes and Reminders stand theirs (the developer, Nov 20,
 * 2026); a page pushed over it keeps its name small and inline. Note that the bar is left without a
 * ground, the screen's showing through it, because a bar painted opaque has
 * the system draw its buttons as flat discs rather than glass in the dark.
 * Note that a title, large or inline, is set in the ink rather than the
 * tint, which colors it too, because a page's name is words, not something
 * to press.
 *
 * A screen covered by pages pushed over it stands in React's Activity, as
 * Expo Router offers it (`activityEnabled`, SDK 58's replacement for
 * react-native-screens' `freezeOnBlur`): it stays drawn, so a back swipe
 * shows it as it was, but it renders after the screen in front, and its
 * effects stand down until it is in front again (`COVERED_SCREENS_REST`).
 *
 * The Inbox's and Tasks' roots stand no header of the stack's from their
 * first frame. Note that this is said here rather than only by the root's
 * own `Stack.Screen`, because that applies a frame after the root mounts, and
 * a split view mounting under the header's frame on iPadOS 26 kept its height
 * as a gap above both columns: Tasks', mounted on its first visit with its
 * rows already read, where the Inbox's mounts behind the launch's wait.
 *
 * On an iPad whose own sidebar is folded, a page pushed over a root stands
 * Show Sidebar after its back button, as the root's column does, so the
 * sidebar is one press away on every page.
 */
export function TabStack() {
  const colors = useColors();
  const scheme = useBarScheme();
  const show = useSidebarShowAction();

  return (
    <Stack
      activityEnabled={COVERED_SCREENS_REST}
      screenOptions={({ route }) => ({
        headerUserInterfaceStyle: scheme,
        headerTintColor: colors.TEXT,
        headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.GROUND },
        ...(TAB_ROOTS.has(route.name) && {
          headerLargeTitleEnabled: true,
          headerLargeTitleStyle: { color: colors.TEXT },
          headerLargeTitleShadowVisible: false,
        }),
        ...(SPLIT_ROOTS.has(route.name) && { headerShown: false }),
        ...(show !== undefined &&
          !TAB_ROOTS.has(route.name) && {
            headerBackVisible: true,
            headerLeft: () => <SidebarStackButton onPress={show.onPress} />,
          }),
      })}
    />
  );
}
