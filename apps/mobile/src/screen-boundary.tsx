// screen-boundary.tsx -- the boundary each screen route exports as its `ErrorBoundary`: a screen whose drawing threw, said in its place with Retry, under a bar with no title.

import { ScreenFailure } from "@repo/ui-native";
import { type ErrorBoundaryProps, Stack } from "expo-router";

/**
 * A screen route's `ErrorBoundary`, which expo-router stands around the
 * route so a throw while drawing it is caught there rather than reaching
 * React Native's fatal handler, which a Release build raises as a native
 * crash. Note that the bar's title is cleared, because the screen that would
 * have named it never drew, and the stack would show the route's file path.
 */
export function ScreenBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <>
      <Stack.Screen options={{ title: "" }} />
      <ScreenFailure error={error} retry={retry} />
    </>
  );
}
