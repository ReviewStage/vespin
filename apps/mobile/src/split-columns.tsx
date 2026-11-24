// split-columns.tsx -- a tab's list and its page in a regular window: beside each other in the tab's own split view, or on an iPad the page alone in the last column of the system's split view at the root, whose middle column draws the list itself.

import { Screen, SplitView } from "@repo/ui-native";
import { Stack } from "expo-router";
import type { ComponentProps } from "react";
import { Dimensions } from "react-native";
import type { SplitHostCommands } from "react-native-screens/experimental";
import { APP_SIDEBAR } from "./sidebar-shown.js";
import { StackColumnBar } from "./stack-column-bar.js";

/** The system's split view at the root, once it stands, for the page to be brought forward. */
let splitHost: SplitHostCommands | null = null;

/** Keeps the root split view's commands, as its `ref`. */
export function keepSplitHost(commands: SplitHostCommands | null): void {
  splitHost = commands;
}

/**
 * Brings the picked row's page forward on an iPad held upright, where the
 * system's split view stands the sidebar and the list over the page rather
 * than beside it, as Mail's list steps aside once a message is picked.
 * Note that a window wider than tall leaves the columns as they stand,
 * since its page already stands beside the list.
 */
export function showPickedPage(): void {
  const { width, height } = Dimensions.get("window");

  if (!APP_SIDEBAR || width >= height) return;

  splitHost?.show("secondary");
}

/** A list that keeps no say over whether it stands, such as one only an iPad draws, which always stands. */
function keepListShown(): void {}

type SplitProps = ComponentProps<typeof SplitView>;

type TabColumnsProps = Omit<SplitProps, "sidebarShown" | "onSidebarShownChange"> &
  Partial<Pick<SplitProps, "sidebarShown" | "onSidebarShownChange">> & {
    /** Which build of the split view stands (`useSplitBuild`), as the key of the screen hosting it. */
    readonly build: number;
  };

/**
 * A tab's list and the picked row's page in a regular window: both in the
 * tab's own split view beside the system's tab sidebar, as on the unfolded
 * iPhone Duo; on an iPad, the page alone, in the last column of the system's
 * split view at the root, whose middle column draws the place's list from
 * what the place shares above the split view (`PlaceListColumn`).
 */
export function TabColumns({
  build,
  sidebarShown = true,
  onSidebarShownChange = keepListShown,
  ...split
}: TabColumnsProps) {
  if (!APP_SIDEBAR) {
    return (
      <Screen key={build}>
        <SplitView
          {...split}
          sidebarShown={sidebarShown}
          onSidebarShownChange={onSidebarShownChange}
        />
      </Screen>
    );
  }

  // Note that the page stands bare in its screen's host under its screen's own header, as an iPhone's pushed page does, and a page that holds acts of its own, such as a thread's, stands them there itself (`StackColumnBar`).
  return (
    <>
      {split.detailBar === undefined ? (
        <Stack.Screen options={{ headerShown: true, headerLargeTitleEnabled: false, title: "" }} />
      ) : (
        <StackColumnBar bar={split.detailBar} />
      )}
      <Screen key={build}>{split.detail}</Screen>
    </>
  );
}
