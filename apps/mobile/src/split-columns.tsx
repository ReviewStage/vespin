// split-columns.tsx -- a tab's list and its page in a regular window: beside each other in the tab's own split view, or on an iPad the page alone in the last column of the system's split view at the root, whose middle column draws the list itself.

import { Screen, SplitView } from "@repo/ui-native";
import type { ComponentProps } from "react";
import { Dimensions } from "react-native";
import type { SplitHostCommands } from "react-native-screens/experimental";
import { APP_SIDEBAR } from "./sidebar-shown.js";

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
  return (
    <Screen key={build}>
      {APP_SIDEBAR ? (
        // DIAGNOSTIC (not for merge): the page straight in the screen's host, with no column around it, as an iPhone's pushed thread stands.
        split.detail
      ) : (
        <SplitView
          {...split}
          sidebarShown={sidebarShown}
          onSidebarShownChange={onSidebarShownChange}
        />
      )}
    </Screen>
  );
}
