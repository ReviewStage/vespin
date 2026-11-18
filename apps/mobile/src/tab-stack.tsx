// tab-stack.tsx -- a tab's native stack: inline titles in the ink and round glass back buttons, its items in the brand's copper, its bar clear over the brand's ground.

import { BAR_TITLE, useBarScheme, useColors } from "@repo/ui-native";
import { Stack } from "expo-router";

/** How many screens pushed over a screen let it rest in React's Activity: one, so the screen right under the one in front rests. */
const COVERED_SCREENS_REST = 1;

/** The tab roots that stand a split view under no header of the stack's: the Inbox's and Tasks', by their routes in the stack. */
const SPLIT_ROOT = {
  INBOX: "inbox/index",
  TASKS: "tasks/index",
} as const;

const SPLIT_ROOTS: ReadonlySet<string> = new Set(Object.values(SPLIT_ROOT));

/**
 * Every tab's stack: the system's own headers with no ground of their own
 * and no rule under them, never a large title, each screen's name small and
 * inline in the bar, and the back button the system's round glass chevron
 * alone, its items in the brand's tint. Note that the bar is left without a
 * ground, the screen's showing through it, because a bar painted opaque has
 * the system draw its buttons as flat discs rather than glass in the dark.
 * Note that a title is set in the ink rather than the tint, which colors it
 * too, because a page's name is words, not something to press.
 *
 * A screen covered by one pushed over it stands in React's Activity, as
 * Expo Router offers it (`activityEnabled`, SDK 58's replacement for
 * react-native-screens' `freezeOnBlur`): it stays drawn, so a back swipe
 * shows it as it was, but it renders after the screen in front, and its
 * effects stand down until it is in front again. Note that the threshold is
 * one screen rather than the stack's default of two, because the list a
 * thread or an agent is opened from stands right under it, and it
 * re-rendered whole on every change to the app's state, a keystroke in the
 * reply or a Send among them.
 *
 * The Inbox's and Tasks' roots stand no header of the stack's from their
 * first frame. Note that this is said here rather than only by the root's
 * own `Stack.Screen`, because that applies a frame after the root mounts, and
 * a split view mounting under the header's frame on iPadOS 26 kept its height
 * as a gap above both columns: Tasks', mounted on its first visit with its
 * rows already read, where the Inbox's mounts behind the launch's wait.
 */
export function TabStack() {
  const colors = useColors();
  const scheme = useBarScheme();

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
        ...(SPLIT_ROOTS.has(route.name) && { headerShown: false }),
      })}
    />
  );
}
