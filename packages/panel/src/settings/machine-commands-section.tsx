import {
  EXPERIMENT,
  experimentOn,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
  settingRowsForPage,
} from "@repo/settings";
import type { MicrophoneControl, NotificationsControl } from "@repo/settings/settings-controls";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { SettingsLine, SettingsSection } from "@repo/ui";
import { SettingsPageLink } from "../open-settings.js";
import { PermissionsSection } from "./permissions-section.js";
import { SchemaSettingRows } from "./schema-rows.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";

/**
 * machine-commands-section.tsx -- the This Mac page's groups: what only this Mac itself holds, what macOS lets the app do here, then Startup.
 *
 * What agents may do here, its terminal commands, its apps, and the apps
 * they use unasked, is this Mac's row on Settings › Machines, as every
 * machine's is, so the page says where rather than drawing a second copy.
 * Beside that line stand the Mac's own rows, such as keeping it awake.
 * Under them stands everything macOS lets the app do here, each drawn the
 * same way (`permissions-section.tsx`): notifications, which a command
 * waiting while the app is behind is posted as, the microphone, and, where
 * Computer use is on, its two grants. Startup holds whether the app opens
 * at login, since it is the Mac that starts it; it stands only where the
 * installed app does, so a page with none of its rows draws no empty
 * heading.
 */
export function MachineCommandsSection({
  view,
  notifications,
  microphone,
}: {
  view: SettingsRowsInput;
  notifications: NotificationsControl;
  /** The microphone, on a platform whose microphone the app asks for itself; none elsewhere. */
  microphone?: MicrophoneControl | undefined;
}): React.JSX.Element {
  const computerUse = experimentOn(view.settings.experiments, EXPERIMENT.COMPUTER_USE);

  const startup =
    settingRowsForPage(SCHEMA_SETTINGS_PAGE.THIS_MAC, SETTING_SECTION.STARTUP, view).length > 0;

  return (
    <>
      <SettingsSection>
        <SettingsLine>
          {/* Note that the sentence stands in one span, because the line lays its children apart. */}
          <span>
            Terminal commands and apps for agents on this Mac are set under it on{" "}
            <SettingsPageLink page={SETTINGS_VIEW.HOSTS} />.
          </span>
        </SettingsLine>
        <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.THIS_MAC} view={view} />
      </SettingsSection>
      <PermissionsSection
        notifications={notifications}
        microphone={microphone}
        computerUse={computerUse}
      />
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
