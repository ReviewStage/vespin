// _layout.tsx -- the app's root: the host started over every screen, the tabs, and the signed-out placeholder the sign-in flow will stand behind.

// What Hermes lacks is filled in before anything of the host loads.
import "../host/polyfills.js";
import { Stack } from "expo-router";
import { HostProvider } from "../host/host-provider.js";

export default function RootLayout() {
  return (
    <HostProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="signed-out" />
      </Stack>
    </HostProvider>
  );
}
