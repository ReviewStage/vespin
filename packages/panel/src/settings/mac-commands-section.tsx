import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
  settingRowsForPage,
} from "@repo/settings";
import { NOTIFICATIONS_STATUS, type NotificationsControl } from "@repo/settings/settings-controls";
import { SettingsSection } from "@repo/ui";
import { NotificationsOff } from "./notifications-off.js";
import { SchemaSettingRows } from "./schema-rows.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";
import type { SettingsWrites } from "./writes.js";

/** What the line says where macOS refused the app's last notification, by whether this is the packaged app. */
const NOTIFICATIONS_OFF_WORDS = {
  packaged: `macOS has notifications off for ${PRODUCT_NAME}, so a command waiting while ${PRODUCT_NAME} is behind won't say so.`,
  development: `macOS has notifications off for Electron, which is how the dev build appears to macOS, so a command waiting while ${PRODUCT_NAME} is behind won't say so.`,
} as const;

/**
 * mac-commands-section.tsx -- the This Mac page's groups: whether the app and coding agents may run shell commands here, then Startup.
 *
 * One choice, Ask every time by default: each command is put to the
 * developer before it runs, or every command runs unasked, or none at all
 * (`compose-mac-commands.ts` in the host stops reading for commands under
 * Never). A command waiting while the app is behind is always posted as a
 * notification, so where macOS refused the app's last one a line under the choice
 * says so and opens System Settings, where they are turned back on; a
 * development build runs inside Electron's own app, which macOS lists it
 * as, and the line names it so. Startup holds whether the app opens at login, since it is the Mac
 * that starts it; it stands only where the installed app does, so a page
 * with none of its rows draws no empty heading.
 */
export function MacCommandsSection({
  view,
  writes,
  notifications,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
  notifications: NotificationsControl;
}): React.JSX.Element {
  const startup =
    settingRowsForPage(SCHEMA_SETTINGS_PAGE.THIS_MAC, SETTING_SECTION.STARTUP, view).length > 0;

  return (
    <>
      <SettingsSection>
        <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.THIS_MAC} view={view} />
        {notifications.status === NOTIFICATIONS_STATUS.OFF ? (
          <NotificationsOff
            words={
              notifications.packaged
                ? NOTIFICATIONS_OFF_WORDS.packaged
                : NOTIFICATIONS_OFF_WORDS.development
            }
            onOpenSettings={notifications.onOpenSettings}
          />
        ) : null}
      </SettingsSection>
      {startup ? (
        <SettingsSection {...settingsSectionHead(SECTION.STARTUP)}>
          <SchemaSettingRows
            page={SCHEMA_SETTINGS_PAGE.THIS_MAC}
            section={SETTING_SECTION.STARTUP}
            view={view}
          />
        </SettingsSection>
      ) : null}
    </>
  );
}
