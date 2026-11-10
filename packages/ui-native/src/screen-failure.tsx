// screen-failure.tsx -- what a screen draws in its place once drawing it threw: that something went wrong, and Retry.

import { useEffect } from "react";
import { EmptyState } from "./empty-state.js";
import { Screen } from "./screen.js";

/** What the failure says, and its one act. */
const FAILURE_WORDS = {
  TITLE: "Something went wrong",
  DESCRIPTION: "This screen could not be drawn.",
  RETRY: "Retry",
} as const;

/**
 * A screen whose drawing threw, in its place: the system's empty state
 * saying so, with Retry, which draws the screen again. It is shaped as
 * expo-router's `ErrorBoundaryProps`, so a route exports it as its
 * `ErrorBoundary` and the router catches the screen's throw rather than
 * letting it reach React Native's fatal handler, which in a Release build
 * raises it as a native exception off the JavaScript thread and crashes the
 * app. Note that the error is said on the console, as the app says every
 * error it draws without, since the boundary is the last place it is seen.
 */
export function ScreenFailure({
  error,
  retry,
}: {
  readonly error: Error;
  readonly retry: () => Promise<void>;
}) {
  useEffect(() => console.error("A screen did not draw.", error), [error]);
  return (
    <Screen>
      <EmptyState
        title={FAILURE_WORDS.TITLE}
        symbol="exclamationmark.triangle"
        description={FAILURE_WORDS.DESCRIPTION}
        action={{ label: FAILURE_WORDS.RETRY, onPress: () => void retry() }}
      />
    </Screen>
  );
}
