// screen-boundary.tsx -- the boundaries the routes export as their `ErrorBoundary`: a screen whose drawing threw, said in its place with Retry and reported to Sentry, under a bar with no title.

import { ScreenFailure } from "@repo/ui-native";
import { type ErrorBoundaryProps, Stack } from "expo-router";
import { useScreenFailureReport } from "./crash-reports.js";

/**
 * A screen route's `ErrorBoundary`, which expo-router stands around the
 * route so a throw while drawing it is caught there rather than reaching
 * React Native's fatal handler, which a Release build raises as a native
 * crash. The throw is reported to Sentry, since the global handler that
 * would have heard it never does. Note that the bar's title is cleared,
 * because the screen that would have named it never drew, and the stack
 * would show the route's file path.
 */
export function ScreenBoundary({ error, retry }: ErrorBoundaryProps) {
  useScreenFailureReport(error);
  return (
    <>
      <Stack.Screen options={{ title: "" }} />
      <ScreenFailure error={error} retry={retry} />
    </>
  );
}

/** The root layout's `ErrorBoundary`: a throw no screen's boundary caught, said and reported as a screen's is, with no stack to name. */
export function RootBoundary({ error, retry }: ErrorBoundaryProps) {
  useScreenFailureReport(error);
  return <ScreenFailure error={error} retry={retry} />;
}
