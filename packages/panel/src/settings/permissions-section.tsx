import { PRODUCT_NAME } from "@repo/features/product-name";
import { MICROPHONE_STATUS, type MicrophoneStatus } from "@repo/settings/microphone";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  type MicrophoneControl,
  NOTIFICATIONS_STATUS,
  type NotificationsControl,
} from "@repo/settings/settings-controls";
import { SettingsSection } from "@repo/ui";
import { microphoneAccessRow } from "@repo/ui/microphone-access";
import { ComputerUsePermissionRows } from "./computer-use-section.js";
import { PERMISSION_STANDING, PermissionRow, type PermissionStanding } from "./permission-row.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";

/**
 * permissions-section.tsx -- This Mac's Permissions: everything macOS lets the app do here, each drawn the same way (`PermissionRow`).
 *
 * Notifications, which say a command waits while the app is behind; the
 * microphone, which dictation hears; and, where Computer use is on, Screen
 * Recording and Accessibility, which let agents see and use apps. Each says
 * whether macOS allows it and what for, and offers Allow… or System
 * Settings where it does not. A permission whose standing the app cannot
 * read is left out, but for the microphone, which says why.
 */

/** Where the microphone stands, as its row reads macOS's answer. */
function microphoneStanding(status: MicrophoneStatus): PermissionStanding {
  switch (status) {
    case MICROPHONE_STATUS.GRANTED:
      return PERMISSION_STANDING.ALLOWED;
    case MICROPHONE_STATUS.NOT_DETERMINED:
      return PERMISSION_STANDING.ASK;
    case MICROPHONE_STATUS.DENIED:
      return PERMISSION_STANDING.DENIED;
    default:
      return PERMISSION_STANDING.UNKNOWN;
  }
}

/** What the notifications row says they cost while off, by whether this is the packaged app: a development build runs inside Electron's own app, which macOS lists it as. */
function notificationsMissing(packaged: boolean): string {
  return packaged
    ? `Off, so a command waiting while ${PRODUCT_NAME} is behind won't say so`
    : `Off for Electron, which is how the dev build appears to macOS, so a command waiting while ${PRODUCT_NAME} is behind won't say so`;
}

export function PermissionsSection({
  notifications,
  microphone,
  computerUse,
}: {
  notifications: NotificationsControl;
  /** The microphone, on a platform whose microphone the app asks for itself; none elsewhere. */
  microphone?: MicrophoneControl | undefined;
  /** Whether Computer use is on, which lists its two grants. */
  computerUse: boolean;
}): React.JSX.Element {
  const standing = microphone === undefined ? undefined : microphoneStanding(microphone.status);

  return (
    <SettingsSection
      {...settingsSectionHead(SECTION.PERMISSIONS)}
      caption={`What macOS lets ${PRODUCT_NAME} do on this Mac. Each is changed in System Settings › Privacy & Security.`}
    >
      {notifications.status === NOTIFICATIONS_STATUS.UNKNOWN ? null : (
        <PermissionRow
          label="Notifications"
          standing={
            notifications.status === NOTIFICATIONS_STATUS.ON
              ? PERMISSION_STANDING.ALLOWED
              : PERMISSION_STANDING.DENIED
          }
          allowed={`A command waiting on you says so while ${PRODUCT_NAME} is behind`}
          missing={notificationsMissing(notifications.packaged)}
          onOpenSettings={notifications.onOpenSettings}
        />
      )}
      {microphone === undefined || standing === undefined ? null : (
        <PermissionRow
          label="Microphone"
          anchor={SETTINGS_SEARCH_ROW.MICROPHONE}
          standing={standing}
          allowed="Dictation hears you"
          missing={
            standing === PERMISSION_STANDING.UNKNOWN
              ? (microphoneAccessRow(microphone.status).detail ?? "")
              : standing === PERMISSION_STANDING.ASK
                ? "Not allowed yet, so dictation can't hear you"
                : "Not allowed, so dictation can't hear you"
          }
          onAllow={microphone.onRequest}
          onOpenSettings={microphone.onOpenSettings}
        />
      )}
      {computerUse ? <ComputerUsePermissionRows /> : null}
    </SettingsSection>
  );
}
