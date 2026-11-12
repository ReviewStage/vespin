/**
 * notification-permission.ts -- whether iOS lets the app notify, read again each time the app comes forward, and the one step toward letting it: the system's prompt the first time, iOS's own Settings after a refusal.
 *
 * Granting the permission is the phone's opt-in to its pushes, which iOS's
 * own settings silence; the app has no switch of its own.
 */

import { openSettings, openURL } from "expo-linking";
import {
  getPermissionsAsync,
  type NotificationPermissionsStatus,
  requestPermissionsAsync,
} from "expo-notifications";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

/** iOS's own page of the app's notification settings, as `UIApplication.openNotificationSettingsURLString` names it (iOS 16 and later). */
const NOTIFICATION_SETTINGS_URL = "app-settings:notifications";

/**
 * Opens iOS's own notification settings for the app, where its alerts,
 * sounds, badges, and Focus are switched, rather than copying those
 * switches into the app; the app's whole page in iOS's Settings where that
 * address does not open.
 */
export function openNotificationSettings(): void {
  openURL(NOTIFICATION_SETTINGS_URL)
    .catch(() => openSettings())
    .catch((error: unknown) => console.error("iOS's Settings did not open.", error));
}

/** Where the permission stands, as Settings words it. */
export const NOTIFICATION_STANDING = {
  ALLOWED: "allowed",
  REFUSED: "refused",
  UNASKED: "unasked",
} as const;

export type NotificationStanding =
  (typeof NOTIFICATION_STANDING)[keyof typeof NOTIFICATION_STANDING];

/** The standing a permission's answer reads as: a refusal is one iOS will not ask again, which only its Settings undoes. */
function standingOf(answer: NotificationPermissionsStatus): NotificationStanding {
  if (answer.granted) return NOTIFICATION_STANDING.ALLOWED;

  if (!answer.canAskAgain) return NOTIFICATION_STANDING.REFUSED;

  return NOTIFICATION_STANDING.UNASKED;
}

/** Where the permission stands, none until first read, and the step toward allowing it. */
export function useNotificationPermission(): {
  readonly standing: NotificationStanding | undefined;
  readonly allow: () => void;
} {
  const [standing, setStanding] = useState<NotificationStanding | undefined>(undefined);

  const read = useCallback(() => {
    getPermissionsAsync().then(
      (answer) => setStanding(standingOf(answer)),
      (error: unknown) => console.error("The notification permission could not be read.", error),
    );
  }, []);

  useEffect(() => {
    read();

    // Note that a person may change it in iOS's Settings and come back, so it is read again then.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") read();
    });

    return () => subscription.remove();
  }, [read]);

  const allow = () => {
    if (standing === NOTIFICATION_STANDING.REFUSED) {
      openNotificationSettings();

      return;
    }

    requestPermissionsAsync().then(
      (answer) => setStanding(standingOf(answer)),
      (error: unknown) => console.error("The notification permission was not asked.", error),
    );
  };

  return { standing, allow };
}
