// screen-failure.tsx -- what a screen draws in its place once drawing it threw: that something went wrong, and Try again.

import { useEffect } from "react";
import { BUTTON_LOOK } from "./button.js";
import { EmptyState } from "./empty-state.js";
import { GLYPH } from "./glyph.js";
import { Screen } from "./screen.js";

/** What the failure says, and its one act. */
const FAILURE_WORDS = {
  TITLE: "Something went wrong",
  DESCRIPTION: "This screen could not be drawn.",
  TRY_AGAIN: "Try again",
} as const;

/**
 * A screen whose drawing threw, in its place: the system's empty state
 * saying so, with Try again in the ink, which draws the screen again. It is shaped as
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
        symbol={GLYPH.FAILED}
        description={FAILURE_WORDS.DESCRIPTION}
        action={{
          label: FAILURE_WORDS.TRY_AGAIN,
          look: BUTTON_LOOK.BORDERED,
          onPress: () => void retry(),
        }}
      />
    </Screen>
  );
}
