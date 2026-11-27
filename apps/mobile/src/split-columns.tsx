// split-columns.tsx -- a tab's list and its page in a regular window: beside each other in the tab's own split view, or on an iPad the page alone in the last column of the system's split view at the root, whose middle column draws the list itself.

import { Screen, SplitView } from "@repo/ui-native";
import { Stack } from "expo-router";
import { type ComponentProps, createContext, useContext, useEffect, useState } from "react";
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

/** The display mode an upright iPad's sidebar steps aside to once a pick is made in it: the list beside the page, as Mail's mailboxes step aside once a mailbox is picked. */
const SIDEBAR_ASIDE_MODE = "oneBesideSecondary" as const;

/** Asks the root split view to stand in a display mode, once it stands (`useSplitSidebar`). */
let preferMode: ((mode: typeof SIDEBAR_ASIDE_MODE) => void) | null = null;

/**
 * Steps the sidebar aside on an iPad held upright, where the system's split
 * view stands it over the list, once a place or a task is picked in it.
 * Note that it asks for the display mode through the split view's own
 * `preferredDisplayMode`, since `show()` does nothing for a column already
 * visible under the overlay, which left the sidebar over the list after a
 * place was picked again (vjipadmain's failure-notice lane); a window wider
 * than tall leaves the sidebar standing beside the list.
 */
export function stepSidebarAside(): void {
  const { width, height } = Dimensions.get("window");

  if (!APP_SIDEBAR || width >= height) return;

  preferMode?.(SIDEBAR_ASIDE_MODE);
}

/** The system split view's display modes that stand its sidebar, beside the list or over it (UISplitViewController.DisplayMode). */
const SIDEBAR_MODES: ReadonlySet<string> = new Set([
  "twoBesideSecondary",
  "twoOverSecondary",
  "twoDisplaceSecondary",
]);

/** Whether the root split view's sidebar stands, for a page column's bar to leave out what the sidebar already holds (`useSplitSidebar`). */
export const SidebarStandsContext = createContext(false);

/** The display mode a split view held upright or wide opens in, which no event reports: the sidebar beside a wide window's list, and folded in an upright one's. */
function openingMode(): string {
  const { width, height } = Dimensions.get("window");

  return width >= height ? "twoBesideSecondary" : "oneBesideSecondary";
}

/**
 * Whether the root split view's sidebar stands, read from the system's own
 * display mode as it changes (the toggle, the swipe, a turn of the iPad) and
 * from its collapse to one column, where no sidebar stands beside the page,
 * as the split view's props to hand it and its context's value.
 */
export function useSplitSidebar() {
  const [mode, setMode] = useState(openingMode);
  const [collapsed, setCollapsed] = useState(false);
  // The display mode a pick in the sidebar asked for, held only until the split view stands in it, so the toggle, the swipe, and a turn of the iPad keep the system's own choice after it.
  const [preferred, setPreferred] = useState<typeof SIDEBAR_ASIDE_MODE | undefined>(undefined);

  useEffect(() => {
    preferMode = setPreferred;

    return () => {
      preferMode = null;
    };
  }, []);

  return {
    stands: !collapsed && SIDEBAR_MODES.has(mode),
    /** The display mode a pick asked for, or the system's own choice. */
    preferred: preferred ?? ("automatic" as const),
    props: {
      onDisplayModeWillChange: (event: { nativeEvent: { nextDisplayMode: string } }) => {
        setMode(event.nativeEvent.nextDisplayMode);
        setPreferred(undefined);
      },
      onCollapse: () => setCollapsed(true),
      onExpand: () => setCollapsed(false),
    },
  };
}

/** Whether the root split view's sidebar stands beside the page; false wherever no system split view stands. */
export function useSidebarStands(): boolean {
  return useContext(SidebarStandsContext);
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
