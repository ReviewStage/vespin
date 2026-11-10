import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  APP_SETTING_DEFAULTS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  HOST_CAPABILITY,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@repo/settings";
import { NOTIFICATIONS_STATUS, type NotificationsControl } from "@repo/settings/settings-controls";
import { IconButton, SettingsSection, Tooltip } from "@repo/ui";
import { playCompletionSound } from "@repo/ui/completion-sound";
import { PlayIcon } from "@repo/ui/icons";
import { appPlatform } from "../app-platform.js";
import { NotificationsOff } from "./notifications-off.js";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * sounds-section.tsx -- the Account page's Notifications group: whether a sound plays as an agent the account started finishes or asks, and which one, and whether a notification is posted then, which the account carries across its Macs and the web.
 *
 * Every row is the schema's (`soundWhen`, `completionSound`,
 * `turnNotifications`), drawn by `SchemaSettingRows` like every stored
 * setting, so the settings search finds them too; the sound's row stands
 * only while a sound plays at all. Beside its pop-up stands Play, the quiet
 * `IconButton`, which plays the chosen sound through `@repo/ui`'s player, as
 * an agent's finish would. Turning notifications on asks a browser to let
 * the site post them, in that press (`AppPlatform.askForNotifications`);
 * while they are on and the system will not show them, a line under the
 * switch says so, and on a Mac opens System Settings. Note that the switch is
 * the account's, so it may stand on in a browser that was never asked, as
 * one it was turned on from elsewhere; there the line asks, by its Allow.
 */

/** What Play is called, for a reader and its hover. */
const PLAY = "Play the sound";

/** What the line says where the system will not show the app's notifications: macOS, by whether this is the packaged app, or the browser. */
const NOTIFICATIONS_OFF_WORDS = {
  packaged: `Notifications are off for ${PRODUCT_NAME} in macOS.`,
  development: "Notifications are off for Electron, the dev build, in macOS.",
  browser: "Your browser is blocking notifications. Allow them in this site's settings.",
  unasked: "Allow notifications in this browser to see them.",
} as const;

export function SoundsSection({
  view,
  notifications,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
  notifications: NotificationsControl;
}): React.JSX.Element {
  const sound = view.settings.completionSound ?? APP_SETTING_DEFAULTS.completionSound;
  const actions = (field: AppSettingField) =>
    field === APP_SETTING_SCHEMA.completionSound.field ? (
      <Tooltip label={PLAY}>
        <IconButton icon={<PlayIcon />} label={PLAY} onClick={() => playCompletionSound(sound)} />
      </Tooltip>
    ) : undefined;
  // Note that the browser is asked in the press itself, because it refuses an ask nobody made.
  const ask = () => appPlatform().askForNotifications?.();
  const onTurned = (field: AppSettingField, enabled: boolean) => {
    if (field === APP_SETTING_SCHEMA.turnNotifications.field && enabled) ask();
  };
  const notifying = view.settings.turnNotifications ?? APP_SETTING_DEFAULTS.turnNotifications;
  const onMac = view.capabilities.includes(HOST_CAPABILITY.DESKTOP_APP);
  return (
    <SettingsSection title="Notifications">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.ACCOUNT}
        section={SETTING_SECTION.SOUNDS}
        view={view}
        actions={actions}
        onTurned={onTurned}
      />
      {notifying && notifications.status === NOTIFICATIONS_STATUS.OFF ? (
        onMac ? (
          <NotificationsOff
            words={
              notifications.packaged
                ? NOTIFICATIONS_OFF_WORDS.packaged
                : NOTIFICATIONS_OFF_WORDS.development
            }
            onOpenSettings={notifications.onOpenSettings}
          />
        ) : (
          <NotificationsOff words={NOTIFICATIONS_OFF_WORDS.browser} />
        )
      ) : null}
      {notifying && !onMac && notifications.status === NOTIFICATIONS_STATUS.UNKNOWN ? (
        <NotificationsOff words={NOTIFICATIONS_OFF_WORDS.unasked} onAllow={ask} />
      ) : null}
    </SettingsSection>
  );
}
