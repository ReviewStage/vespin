// _layout.tsx -- the app's root: the host started over every screen, the tabs, Settings, the New task and New agent sheets, and an agent's model sheet once an account is signed in, the sign-in screen until then, and the update screen in front of both while the service refuses this build.

// What Hermes lacks is filled in before anything of the host loads.
import "../host/polyfills.js";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { FailureNoticeProvider, KeepingProvider } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useCrashReportAccount } from "../crash-reports.js";
import { appStateQuery } from "../host/app-state-query.js";
import { HostProvider } from "../host/host-provider.js";
import { useInboxWidget } from "../inbox-widget/use-inbox-widget.js";
import { useKeeping } from "../keeping.js";
import { useLiveActivity } from "../live-activity/use-live-activity.js";
import { MenuCommands } from "../menu-commands/menu-commands.js";
import { useInboxNotifications } from "../notifications.js";
import { usePushRegistration } from "../push-device.js";
import { useShareSheet } from "../share-sheet.js";
import { holdSplash } from "../splash.js";
import { useSystemActivity } from "../system-activity/use-system-activity.js";
import { useWindowSizeClass } from "../use-window-size-class.js";
import { useNoticeForAccount, useOfflineNotice } from "../use-write.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";

export { RootBoundary as ErrorBoundary } from "../screen-boundary.js";

// The splash stands until the host's first screen has drawn (`HostProvider`), rather than going with expo-router's own hide over a blank screen.
holdSplash();

/**
 * The screens, each behind the account's standing: the tabs, Settings, and
 * the sheets that start a task or an agent or change an agent's model while an account is signed in, and the sign-in screen otherwise, so a
 * sign-out anywhere, Settings' or a refused renewal's, lands on it and a
 * sign-in lands on the Inbox. A fixture run stands signed in as its
 * profile's account. While the service refuses this build as older than it
 * serves (`network.updateNeeded`), the update screen stands in front of
 * both, signed in or not, since every call either would make is refused;
 * the screens come back at the service's next answer of another status.
 * While an account is signed in, the phone registers itself for its pushes
 * once a launch (`push-device.ts`), a tapped
 * notification opens its thread (`notifications.ts`), a Stop pressed on
 * the Live Activity of its running agents goes through the host
 * (`live-activity/`), the Inbox widget's snapshot follows its Inbox
 * (`inbox-widget/`), its crash reports name it (`crash-reports.ts`), its
 * tasks and threads stand in Spotlight, and a Spotlight item tapped or a
 * screen handed over from another device opens (`system-activity/`). The
 * iPad's menu bar acts on whatever stands in front, its account's commands
 * enabled while one is signed in (`menu-commands/`), and the share sheet's
 * snapshot is kept current and its draft opens New task (`share-sheet.ts`).
 * Over every screen stands the one notice of a write that did not go
 * (`use-write.ts`), which lets its offline word go once the service answers,
 * and every word with its Try again once the account it was said for is gone.
 */
function GuardedScreens() {
  const { data: signedIn = false } = useQuery({
    ...appStateQuery,
    select: (state) => state.account.status === ACCOUNT_STATUS.SIGNED_IN,
  });

  const { data: updateNeeded = false } = useQuery({
    ...appStateQuery,
    select: (state) => state.network.updateNeeded === true,
  });

  usePushRegistration(signedIn);
  useInboxNotifications(signedIn);
  useLiveActivity(signedIn);
  useInboxWidget(signedIn);
  useSystemActivity(signedIn);
  useCrashReportAccount();
  useOfflineNotice();
  useNoticeForAccount();
  useShareSheet(updateNeeded);

  // Note that every sheet opens as a form sheet in a regular window, centered over the split view as iPad's own apps open theirs (Mail's compose, Reminders' new list), rather than across the whole screen, and as the modal sheet in a compact one.
  const sheetPresentation =
    useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR ? "formSheet" : "modal";

  return (
    <>
      <MenuCommands signedIn={signedIn && !updateNeeded} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn && !updateNeeded}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          {/* Note that each sheet's title is named here as well as on its screen, so it never reads the route's name, which New task has kept when opened from the tab bar's round +. */}
          <Stack.Screen
            name="settings"
            options={{ presentation: sheetPresentation, title: "Settings" }}
          />
          <Stack.Screen
            name="start-task"
            options={{ presentation: sheetPresentation, title: "New task" }}
          />
          <Stack.Screen
            name="start-agent"
            options={{ presentation: sheetPresentation, title: "New agent" }}
          />
          <Stack.Screen
            name="agent-model"
            options={{ presentation: sheetPresentation, title: "Options" }}
          />
          <Stack.Screen
            name="agent-ports"
            options={{ presentation: sheetPresentation, title: "Ports" }}
          />
          <Stack.Screen
            name="new-workspace"
            options={{ presentation: sheetPresentation, title: "New workspace" }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn && !updateNeeded}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={updateNeeded}>
          <Stack.Screen name="update-needed" options={{ gestureEnabled: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

/** The screens, under what their pictures', recordings', files', and messages' menus do, which says its failures in the notice above them. */
function KeptScreens() {
  return (
    <KeepingProvider keeping={useKeeping()}>
      <GuardedScreens />
    </KeepingProvider>
  );
}

/** The root: the host, the one notice of a write that did not go, and the screens under both. */
export default function RootLayout() {
  return (
    <HostProvider>
      <FailureNoticeProvider>
        <KeptScreens />
      </FailureNoticeProvider>
    </HostProvider>
  );
}
