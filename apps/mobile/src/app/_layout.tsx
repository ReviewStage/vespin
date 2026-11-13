// _layout.tsx -- the app's root: the host started over every screen, the tabs, Settings, the New task and New agent sheets, an agent's model sheet, and a task's Task relation sheet once an account is signed in, the sign-in screen until then, and the update screen in front of both while the service refuses this build.

// What Hermes lacks is filled in before anything of the host loads.
import "../host/polyfills.js";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { ElevatedGround, FailureNoticeProvider, KeepingProvider } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { hide as hideSplash } from "expo-splash-screen";
import { type ReactElement, useEffect } from "react";
import { useCrashReportAccount } from "../crash-reports.js";
import { appStateQuery } from "../host/app-state-query.js";
import { HostProvider } from "../host/host-provider.js";
import { useHostConnectLink } from "../host-connect-link.js";
import { useInboxWidget } from "../inbox-widget/use-inbox-widget.js";
import { useKeeping } from "../keeping.js";
import { useLiveActivity } from "../live-activity/use-live-activity.js";
import { MenuCommands } from "../menu-commands/menu-commands.js";
import { useInboxNotifications } from "../notifications.js";
import { usePushRegistration } from "../push-device.js";
import { useShareSheet } from "../share-sheet.js";
import { useSystemActivity } from "../system-activity/use-system-activity.js";
import { useWindowSizeClass } from "../use-window-size-class.js";
import { useNoticeForAccount, useOfflineNotice } from "../use-write.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";

export { RootBoundary as ErrorBoundary } from "../screen-boundary.js";

/** A short sheet's heights in a compact window, as fractions of the screen: UIKit's medium, then its large. */
const SHORT_SHEET_DETENTS = [0.5, 1];

/** The routes the root stack presents as sheets over the app. */
const SHEET_ROUTE = {
  SETTINGS: "settings",
  START_TASK: "start-task",
  START_AGENT: "start-agent",
  AGENT_MODEL: "agent-model",
  AGENT_PORTS: "agent-ports",
  TASK_RELATION: "task-relation",
  MOVE_TASK: "move-task",
  TASK_FOLLOWING: "task-following",
  ADD_FOLLOWER: "add-follower",
  NEW_WORKSPACE: "new-workspace",
} as const;

/** The sheets drawn lifted when they stand as form sheets over a regular window. */
const LIFTED_SHEETS: ReadonlySet<string> = new Set(Object.values(SHEET_ROUTE));

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
 * snapshot is kept current and its draft opens New task (`share-sheet.ts`),
 * and a machine's pairing link opens Settings › Machines on its code
 * (`host-connect-link.ts`).
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
  useHostConnectLink(signedIn && !updateNeeded);

  // Note that every sheet opens as a form sheet in a regular window, centered over the split view as iPad's own apps open theirs (Mail's compose, Reminders' new list), rather than across the whole screen, and as the modal sheet in a compact one.
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
  const sheetPresentation = regular ? "formSheet" : "modal";

  // Note that a short sheet, a list to pick from or a few rows, opens at half height with its grabber in a compact window, and pulls up to full, as Maps' and Mail's short sheets do; a regular window's form sheet keeps its own size.
  const shortSheet = regular
    ? { presentation: "formSheet" as const }
    : {
        presentation: "formSheet" as const,
        sheetAllowedDetents: SHORT_SHEET_DETENTS,
        sheetGrabberVisible: true,
      };

  // Note that a sheet over a regular window is a form sheet standing above the dimmed window, so in dark it draws on the lifted ground, as iOS lifts presented content; the app's own pages and an iPhone's full sheets keep the plain ground.
  const sheetLayout = ({
    route,
    children,
  }: {
    route: { name: string };
    children: ReactElement;
  }): ReactElement =>
    regular && LIFTED_SHEETS.has(route.name) ? (
      <ElevatedGround>{children}</ElevatedGround>
    ) : (
      children
    );

  return (
    <>
      <MenuCommands signedIn={signedIn && !updateNeeded} />
      <Stack screenOptions={{ headerShown: false }} screenLayout={sheetLayout}>
        <Stack.Protected guard={signedIn && !updateNeeded}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          {/* Note that each sheet's title is named here as well as on its screen, so it never reads the route's name, which New task has kept when opened from the tab bar's round +. */}
          <Stack.Screen
            name={SHEET_ROUTE.SETTINGS}
            options={{ presentation: sheetPresentation, title: "Settings" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.START_TASK}
            options={{ presentation: sheetPresentation, title: "New task" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.START_AGENT}
            options={{ presentation: sheetPresentation, title: "New agent" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.AGENT_MODEL}
            options={{ ...shortSheet, title: "Options" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.AGENT_PORTS}
            options={{ ...shortSheet, title: "Ports" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.TASK_RELATION}
            options={{ presentation: sheetPresentation, title: "Task relation" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.MOVE_TASK}
            options={{ ...shortSheet, title: "Move to workspace" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.TASK_FOLLOWING}
            options={{ ...shortSheet, title: "Followers" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.ADD_FOLLOWER}
            options={{ presentation: sheetPresentation, title: "Add a follower" }}
          />
          <Stack.Screen
            name={SHEET_ROUTE.NEW_WORKSPACE}
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

/**
 * The root, with the splash taken down once it first draws. Note that
 * expo-router takes the splash down once a launch, a frame after its
 * navigation is ready, and that one try can be lost (its frame canceled, or
 * the native splash not standing yet), which leaves the splash over every
 * screen for the whole launch while the app answers under it. So the root
 * takes it down as well; a hide with no splash standing does nothing.
 */
export default function RootLayout() {
  useEffect(() => hideSplash(), []);

  return (
    <HostProvider>
      <FailureNoticeProvider>
        <KeptScreens />
      </FailureNoticeProvider>
    </HostProvider>
  );
}
