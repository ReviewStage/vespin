// split-columns.tsx -- a tab's list and its page in a regular window: beside each other in the tab's own split view, or on an iPad as the middle and last columns of the system's split view at the root, the list handed up from the tab's root to the middle column.

import { Portal, PortalHost, PortalProvider } from "@gorhom/portal";
import { ListColumn, PageColumn, Screen, SplitView } from "@repo/ui-native";
import type { ComponentProps, ReactNode } from "react";
import { Dimensions } from "react-native";
import type { SplitHostCommands } from "react-native-screens/experimental";
import { APP_SIDEBAR } from "./sidebar-shown.js";

/** The middle column's place, where a tab's root hands its list. */
const LIST_COLUMN_HOST = "list-column";

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

/**
 * What the root's split view holds its columns under on an iPad: the place
 * a tab's root hands its list to. Note that a portal carries the list,
 * because the list and its page share one screen's state (its scope, its
 * search, Select mode and the pick), while the system's split view holds
 * each column as a React tree of its own.
 */
export function SplitColumnsProvider({ children }: { readonly children: ReactNode }) {
  return <PortalProvider shouldAddRootHost={false}>{children}</PortalProvider>;
}

/** The middle column of an iPad's split view: the list of the tab standing. */
export function ListColumnSlot() {
  return <PortalHost name={LIST_COLUMN_HOST} />;
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
 * A tab's list and the picked row's page in a regular window. On an iPad
 * the list goes up to the middle column of the system's split view at the
 * root, and the page stands here, in its last column, under its own bar;
 * elsewhere, such as on the unfolded iPhone Duo, both stand in the tab's
 * own split view beside the system's tab sidebar.
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

  return (
    <>
      <Portal hostName={LIST_COLUMN_HOST}>
        <ListColumn view={split.sidebar} bar={split.sidebarBar} />
      </Portal>
      <Screen key={build}>
        <PageColumn view={split.detail} bar={split.detailBar} />
      </Screen>
    </>
  );
}
