import { PRODUCT_NAME } from "@repo/features/product-name";
import type { Workspace } from "@repo/features/workspace-wire";
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
import { SECTION, settingsSectionHead } from "./settings-sections.js";
import { SlackNotificationsRow } from "./slack-notifications-row.js";
import { useYourSounds } from "./your-sounds.js";

/**
 * sounds-section.tsx -- the Preferences page's Notifications group: whether a sound plays as an agent the account started finishes or something needs it, which one for each, whether a notification is posted then, which the account carries across its Macs and the web, and the reader's own Slack notifications.
 *
 * Every row is the schema's (`soundWhen`, `completionSound`, `askSound`,
 * `turnNotifications`), drawn by `SchemaSettingRows` like every stored
 * setting, so the settings search finds them too; the sounds' rows stand
 * only while a sound plays at all. Beside each sound's pop-up stands Play,
 * the quiet `IconButton`, which plays the chosen sound through `@repo/ui`'s
 * player, as an agent's finish or an ask would. Turning notifications on asks a browser to let
 * the site post them, in that press (`AppPlatform.askForNotifications`);
 * while they are on and the system will not show them, a line under the
 * switch says so, and on a Mac opens System Settings. Note that the switch is
 * the account's, so it may stand on in a browser that was never asked, as
 * one it was turned on from elsewhere; there the line asks, by its Allow.
 * Each sound's pop-up lists the account's own sounds first, under Yours,
 * and pins Add a sound… at its foot, with a + beside Play to add one too;
 * Your sounds follows the section, where each plays, and is renamed or
 * removed (`your-sounds.tsx`). Last stands the reader's Slack notifications, once
 * a workspace of theirs has our Slack bot connected
 * (`slack-notifications-row.tsx`).
 */

/** What each sound's Play is called, for a reader and its hover, so the two are told apart. */
const PLAY = {
  [APP_SETTING_SCHEMA.completionSound.field]: "Play the sound for a finish",
  [APP_SETTING_SCHEMA.askSound.field]: "Play the sound for something that needs you",
} as const;

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
  workspaces,
}: {
  view: SettingsRowsInput;
  notifications: NotificationsControl;
  /** The account's workspaces, whose Slack bots decide whether Slack notifications stand. */
  workspaces: readonly Workspace[];
}): React.JSX.Element {
  const chosen = {
    [APP_SETTING_SCHEMA.completionSound.field]:
      view.settings.completionSound ?? APP_SETTING_DEFAULTS.completionSound,
    [APP_SETTING_SCHEMA.askSound.field]: view.settings.askSound ?? APP_SETTING_DEFAULTS.askSound,
  };
  const clips = useYourSounds(view);
  const actions = (field: AppSettingField) =>
    field === APP_SETTING_SCHEMA.completionSound.field ||
    field === APP_SETTING_SCHEMA.askSound.field ? (
      <>
        <Tooltip label={PLAY[field]}>
          <IconButton
            icon={<PlayIcon />}
            label={PLAY[field]}
            onClick={() => playCompletionSound(chosen[field])}
          />
        </Tooltip>
        {clips.upload(field)}
      </>
    ) : undefined;
  // Note that the browser is asked in the press itself, because it refuses an ask nobody made.
  const ask = () => appPlatform().askForNotifications?.();
  const onTurned = (field: AppSettingField, enabled: boolean) => {
    if (field === APP_SETTING_SCHEMA.turnNotifications.field && enabled) ask();
  };
  const notifying = view.settings.turnNotifications ?? APP_SETTING_DEFAULTS.turnNotifications;
  const onMac = view.capabilities.includes(HOST_CAPABILITY.DESKTOP_APP);
  return (
    <>
      <SettingsSection {...settingsSectionHead(SECTION.NOTIFICATIONS)}>
        <SchemaSettingRows
          page={SCHEMA_SETTINGS_PAGE.PREFERENCES}
          section={SETTING_SECTION.NOTIFICATIONS}
          view={view}
          actions={actions}
          menus={clips.menus}
          onTurned={onTurned}
        />
        {clips.drawn}
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
        <SlackNotificationsRow workspaces={workspaces} />
      </SettingsSection>
      {clips.list}
    </>
  );
}
