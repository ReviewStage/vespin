// _layout.tsx -- the app's root: the host started over every screen, the tabs, Settings, and the New task and New agent sheets once an account is signed in, and the sign-in screen until then.

// What Hermes lacks is filled in before anything of the host loads.
import "../host/polyfills.js";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { hide as hideSplash } from "expo-splash-screen";
import { useEffect } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { HostProvider } from "../host/host-provider.js";
import { useLiveActivity } from "../live-activity/use-live-activity.js";
import { useInboxNotifications } from "../notifications.js";
import { usePushRegistration } from "../push-device.js";

export { ScreenFailure as ErrorBoundary } from "@repo/ui-native";

/**
 * The screens, each behind the account's standing: the tabs, Settings, and
 * the sheets that start a task or an agent while an account is signed in, and the sign-in screen otherwise, so a
 * sign-out anywhere, Settings' or a refused renewal's, lands on it and a
 * sign-in lands on the Inbox. A fixture run stands signed in as its
 * profile's account. While an account is signed in, the phone registers
 * itself for its pushes once a launch (`push-device.ts`), a tapped
 * notification opens its thread (`notifications.ts`), and a Stop pressed on
 * the Live Activity of its running agents goes through the host
 * (`live-activity/`).
 */
function GuardedScreens() {
  const { data: signedIn = false } = useQuery({
    ...appStateQuery,
    select: (state) => state.account.status === ACCOUNT_STATUS.SIGNED_IN,
  });
  usePushRegistration(signedIn);
  useInboxNotifications(signedIn);
  useLiveActivity(signedIn);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        {/* Note that each sheet's title is named here as well as on its screen, so it never reads the route's name, which New task has kept when opened from the tab bar's round +. */}
        <Stack.Screen name="settings" options={{ presentation: "modal", title: "Settings" }} />
        <Stack.Screen name="start-task" options={{ presentation: "modal", title: "New task" }} />
        <Stack.Screen name="start-agent" options={{ presentation: "modal", title: "New agent" }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
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
      <GuardedScreens />
    </HostProvider>
  );
}
