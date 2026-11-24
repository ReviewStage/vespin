// _layout.tsx -- the app's root: the host started over every screen, the one notice of a write that did not go, the voice call, and the app's screens, on an iPad in the detail of the system's split view beside the app's sidebar.

// What Hermes lacks is filled in before anything of the host loads.
import "../host/polyfills.js";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import {
  type BrandColors,
  ChipMarkProvider,
  FailureNoticeProvider,
  KeepingProvider,
  useColors,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Slot, ThemeProvider } from "expo-router";
import { SplitView } from "expo-router/unstable-split-view";
import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { appStateQuery } from "../host/app-state-query.js";
import { HostProvider } from "../host/host-provider.js";
import { useKeeping } from "../keeping.js";
import { LAUNCH_PHASE, noteLaunchPhase } from "../launch-phases.js";
import { AppSidebarPane } from "../screens/app-sidebar.js";
import { SidebarTasksProvider } from "../screens/task-screens.js";
import { APP_SIDEBAR } from "../sidebar-shown.js";
import { holdSplash } from "../splash.js";
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
 * The app's screens (`(app)/_layout.tsx`): on an iPad, the detail of the
 * system's own split view (UISplitViewController, expo-router's
 * `SplitView`), whose sidebar column holds the app's sidebar, read once for
 * every tab with the Tasks tab's list (`SidebarTasksProvider`), as Mail
 * stands its mailboxes beside its messages, so every page, a pushed one
 * included, stands beside it, and the system draws its glass, its
 * selection, its toggle, its swipe and its menu command; the sidebar stands
 * only once an account is signed in. Elsewhere, the screens alone. Note that
 * the split view stands at the root, as UIKit has a split view stand, since
 * it may stand inside no other native navigator.
 */
function AppFrame() {
  const { data: signedIn = false } = useQuery({
    ...appStateQuery,
    select: (state) => state.account.status === ACCOUNT_STATUS.SIGNED_IN,
  });

  if (!APP_SIDEBAR) return <Slot />;

  return (
    <SidebarTasksProvider>
      <SplitView
        primaryBackgroundStyle="sidebar"
        displayModeButtonVisibility="automatic"
        presentsWithGesture
        topColumnForCollapsing="secondary"
        columnMetrics={SIDEBAR_COLUMN}
        {...(signedIn ? {} : { preferredDisplayMode: "secondaryOnly" as const })}
      >
        <SplitView.Column>{signedIn ? <AppSidebarPane /> : null}</SplitView.Column>
      </SplitView>
    </SidebarTasksProvider>
  );
}

/** How wide the sidebar column stands, and how far a person drags it, as Mail's mailboxes do. */
const SIDEBAR_COLUMN = {
  minimumPrimaryColumnWidth: 260,
  preferredPrimaryColumnWidthOrFraction: 320,
  maximumPrimaryColumnWidth: 380,
} as const;

/** The screens, under what their pictures', recordings', files', and messages' menus do, which says its failures in the notice above them. */
function KeptScreens() {
  return (
    <KeepingProvider keeping={useKeeping()}>
      <ChipMarkProvider markOf={useChipMarks()}>
        <AppFrame />
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
 * drew light beside the dark tab bar.
 */
export default function RootLayout() {
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
