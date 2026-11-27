// _layout.tsx -- the app's root: the host started over every screen, the one notice of a write that did not go, the voice call, and the app's screens, on an iPad in the detail of the system's split view beside the app's sidebar.

// What Hermes lacks is filled in before anything of the host loads.
import "../host/polyfills.js";
import "../diag-nav.js";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import {
  type BrandColors,
  ChipMarkProvider,
  FailureNoticeProvider,
  KeepingProvider,
  RowPickContext,
  useColors,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Slot, ThemeProvider } from "expo-router";
import { SplitView } from "expo-router/unstable-split-view";
import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { withTapTraces } from "../crash-reports.js";
import { appStateQuery } from "../host/app-state-query.js";
import { HostProvider } from "../host/host-provider.js";
import { useKeeping } from "../keeping.js";
import { LAUNCH_PHASE, noteLaunchPhase } from "../launch-phases.js";
import { notePick } from "../row-picks.js";
import { AppSidebarPane } from "../screens/app-sidebar.js";
import { PlaceListColumn, PlacesHeldProvider } from "../screens/place-columns.js";
import { SidebarTasksProvider } from "../screens/task-screens.js";
import { APP_SIDEBAR } from "../sidebar-shown.js";
import { holdSplash } from "../splash.js";
import { keepSplitHost, SidebarStandsContext, useSplitSidebar } from "../split-columns.js";
import { useChipMarks } from "../tasks/chip-marks.js";
import { VoiceCallProvider } from "../voice-call.js";

export { RootBoundary as ErrorBoundary } from "../screen-boundary.js";

// The splash stands until the host's first screen has drawn (`HostProvider`), rather than going with expo-router's own hide over a blank screen.
holdSplash();

// Note that the root layout evaluates after every module it imports, so this is when the bundle's eager modules have run.
noteLaunchPhase(LAUNCH_PHASE.EVALUATED);

/**
 * The navigators' theme: react-navigation's own for the color scheme, its
 * `dark` flag following the system's and its colors the brand's, so a screen
 * or a bar that sets no ground, title or tint of its own stands on the
 * brand's ground in its ink, never a white body or the system's blue.
 */
function navigationTheme(colors: BrandColors, dark: boolean) {
  const base = dark ? DarkTheme : DefaultTheme;

  return {
    ...base,
    dark,
    colors: {
      primary: colors.TEXT,
      background: colors.GROUND,
      card: colors.GROUND,
      text: colors.TEXT,
      border: colors.CHIP_EDGE,
      notification: colors.ACCENT,
    },
  };
}

/**
 * The app's screens (`(app)/_layout.tsx`): on an iPad, the last column of
 * the system's own three-column split view (UISplitViewController,
 * expo-router's `SplitView`), as Mail stands its mailboxes, a mailbox's
 * messages and the message: the app's sidebar first, read once for every
 * place with the Tasks tab's list (`SidebarTasksProvider`); then the list of
 * the place standing (`PlaceListColumn`), reading what each place holds
 * above the split view (`PlacesHeldProvider`), as its page does; then the
 * picked row's page, every page pushed over it included. The system draws
 * the glass, the selection, the sidebar's toggle, its swipe, its menu
 * command and the columns' edges, which a person drags; the sidebar stands
 * only once an account is signed in. Elsewhere, the screens alone. Note that
 * the split view stands at the root, as UIKit has a split view stand, since
 * it may stand inside no other native navigator.
 */
function AppFrame() {
  const { data: signedIn = false } = useQuery({
    ...appStateQuery,
    select: (state) => state.account.status === ACCOUNT_STATUS.SIGNED_IN,
  });

  const sidebar = useSplitSidebar();

  if (!APP_SIDEBAR) return <Slot />;

  return (
    <SidebarTasksProvider>
      <PlacesHeldProvider>
        <SidebarStandsContext value={sidebar.stands}>
          <SplitView
            ref={keepSplitHost}
            {...sidebar.props}
            primaryBackgroundStyle="sidebar"
            displayModeButtonVisibility="automatic"
            presentsWithGesture
            topColumnForCollapsing="secondary"
            columnMetrics={COLUMN_WIDTHS}
            preferredDisplayMode={signedIn ? sidebar.preferred : "secondaryOnly"}
          >
            <SplitView.Column>{signedIn ? <AppSidebarPane /> : null}</SplitView.Column>
            <SplitView.Column>{signedIn ? <PlaceListColumn /> : null}</SplitView.Column>
          </SplitView>
        </SidebarStandsContext>
      </PlacesHeldProvider>
    </SidebarTasksProvider>
  );
}

/**
 * How wide the sidebar and the list stand, and how far a person drags each,
 * as Mail's mailboxes and messages do: the list can't be folded away, but
 * its edge moves.
 */
const COLUMN_WIDTHS = {
  minimumPrimaryColumnWidth: 260,
  preferredPrimaryColumnWidthOrFraction: 320,
  maximumPrimaryColumnWidth: 380,
  minimumSupplementaryColumnWidth: 280,
  preferredSupplementaryColumnWidthOrFraction: 340,
  maximumSupplementaryColumnWidth: 480,
} as const;

/** The screens, under what their pictures', recordings', files', and messages' menus do, which says its failures in the notice above them, each row pick kept for the open it leads to (`row-picks.ts`), an iPad's sidebar and list columns' rows as much as its pages'. */
function KeptScreens() {
  return (
    <KeepingProvider keeping={useKeeping()}>
      <ChipMarkProvider markOf={useChipMarks()}>
        <RowPickContext value={notePick}>
          <AppFrame />
        </RowPickContext>
      </ChipMarkProvider>
    </KeepingProvider>
  );
}

/**
 * The root: the host, the one notice of a write that did not go, the voice
 * call, which outlives every screen, and the screens under them, in the
 * navigators' theme. Note that the theme's `dark` flag follows the system's
 * color scheme, because expo-router's stack sets every navigation bar's
 * style from it, and with no theme given it read the light default, so in
 * dark every bar's buttons, its search field and the keyboard it raised
 * drew light beside the dark tab bar. Every tap on it is traced
 * (`withTapTraces`).
 */
function RootLayout() {
  const dark = useColorScheme() === "dark";
  const colors = useColors();
  const theme = useMemo(() => navigationTheme(colors, dark), [colors, dark]);

  return (
    <ThemeProvider value={theme}>
      <HostProvider>
        <FailureNoticeProvider>
          <VoiceCallProvider>
            <KeptScreens />
          </VoiceCallProvider>
        </FailureNoticeProvider>
      </HostProvider>
    </ThemeProvider>
  );
}

export default withTapTraces(RootLayout);
