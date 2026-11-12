// haptics.ts -- the phone's one buzz: how the system answers a write that went, warned, or was refused, and a selection's tap.

import { NotificationFeedbackType, notificationAsync, selectionAsync } from "expo-haptics";

/** The buzzes the app plays: a write that went, one that needs a second look, one refused, and a selection's light tap. */
export const BUZZ = {
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "error",
  SELECTION: "selection",
} as const;

export type Buzz = (typeof BUZZ)[keyof typeof BUZZ];

/** The system's notification feedback each write's buzz plays. */
const NOTIFICATION_FEEDBACK = {
  [BUZZ.SUCCESS]: NotificationFeedbackType.Success,
  [BUZZ.WARNING]: NotificationFeedbackType.Warning,
  [BUZZ.ERROR]: NotificationFeedbackType.Error,
} as const;

/**
 * Buzzes the phone as the system does for that kind of moment. Note that a
 * buzz that did not play is logged and dropped, because the write it marks
 * already landed and a phone with haptics off answers the same way.
 */
export function buzz(kind: Buzz): void {
  const played =
    kind === BUZZ.SELECTION ? selectionAsync() : notificationAsync(NOTIFICATION_FEEDBACK[kind]);

  played.catch((cause: unknown) => console.error("The buzz did not go.", cause));
}
