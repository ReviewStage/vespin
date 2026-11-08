// _layout.tsx -- the app's root: the tabs, and the signed-out placeholder the sign-in flow will stand behind.

import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="signed-out" />
    </Stack>
  );
}
