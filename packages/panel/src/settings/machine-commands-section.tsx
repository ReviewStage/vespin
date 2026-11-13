import {
  EXPERIMENT,
  experimentOn,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
  settingRowsForPage,
} from "@repo/settings";
import type { MicrophoneControl, NotificationsControl } from "@repo/settings/settings-controls";
import { SettingsSection } from "@repo/ui";
import { PermissionsSection } from "./permissions-section.js";
import { SchemaSettingRows } from "./schema-rows.js";

/**
 * machine-commands-section.tsx -- the This Mac page: how the app runs on this Mac, then what macOS lets it do here.
 *
 * What agents may do on this Mac, its terminal commands and its apps, is
 * its row on Settings › Machines, as every machine's is, which the page's
 * subtitle points to. Here stand the Mac's own rows in one card: whether
 * the app opens at login, whether the Mac is kept awake for agents, and
 * which microphone dictation prefers, each where the platform has it, so a
 * page with none of them draws no empty card. Under them stands everything
 * macOS lets the app do here, each drawn the same way
 * (`permissions-section.tsx`): notifications, which a command waiting while
 * the app is behind is posted as, the microphone, and, where Computer use
 * is on, its two grants.
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

  const own =
    settingRowsForPage(SCHEMA_SETTINGS_PAGE.THIS_MAC, SETTING_SECTION.MAIN, view).length > 0;

  return (
    <>
      {own ? (
        <SettingsSection>
          <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.THIS_MAC} view={view} />
        </SettingsSection>
      ) : null}
      <PermissionsSection
        notifications={notifications}
        microphone={microphone}
        computerUse={computerUse}
      />
    </>
  );
}
