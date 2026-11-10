// _layout.tsx -- the app's root: the host started over every screen, the tabs, Settings, and the New task and New agent sheets once an account is signed in, and the sign-in screen until then.

// What Hermes lacks is filled in before anything of the host loads.
import "../host/polyfills.js";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { appStateQuery } from "../host/app-state-query.js";
import { HostProvider } from "../host/host-provider.js";
import { usePushRegistration } from "../push-device.js";

/**
 * The screens, each behind the account's standing: the tabs, Settings, and
 * the sheets that start a task or an agent while an account is signed in, and the sign-in screen otherwise, so a
 * sign-out anywhere, Settings' or a refused renewal's, lands on it and a
 * sign-in lands on the Inbox. A fixture run stands signed in as its
 * profile's account. While an account is signed in, the phone registers
 * itself for its pushes once a launch (`push-device.ts`).
 */
function GuardedScreens() {
  const { data: signedIn = false } = useQuery({
    ...appStateQuery,
    select: (state) => state.account.status === ACCOUNT_STATUS.SIGNED_IN,
  });
  usePushRegistration(signedIn);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings" options={{ presentation: "modal" }} />
        <Stack.Screen name="start-task" options={{ presentation: "modal" }} />
        <Stack.Screen name="start-agent" options={{ presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <HostProvider>
      <GuardedScreens />
    </HostProvider>
  );
}
