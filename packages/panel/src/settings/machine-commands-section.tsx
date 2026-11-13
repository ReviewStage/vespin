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
import { ComputerUseSection } from "./computer-use-section.js";
import { PermissionsSection } from "./permissions-section.js";
import { SchemaSettingRows } from "./schema-rows.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";
import type { SettingsWrites } from "./writes.js";

/**
 * machine-commands-section.tsx -- the This Mac page's groups: whether the app and coding agents may run shell commands and use apps here, what macOS lets the app do, the apps agents use unasked, then Startup.
 *
 * One choice, Ask every time by default: each command is put to the
 * developer before it runs, or every command runs unasked, or none at all
 * (`compose-machine-commands.ts` in the host stops reading for commands under
 * Never). Under the choices stands everything macOS lets the app do here,
 * each drawn the same way (`permissions-section.tsx`): notifications, which
 * a command waiting while the app is behind is posted as, the microphone,
 * and, where Computer use is on, its two grants. Then, where Computer use
 * is on, the apps agents use without asking (`computer-use-section.tsx`).
 * Startup holds whether the app opens at login, since it is the Mac
 * that starts it; it stands only where the installed app does, so a page
 * with none of its rows draws no empty heading.
 */
export function MachineCommandsSection({
  view,
  writes,
  notifications,
  microphone,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
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
        <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.THIS_MAC} view={view} />
      </SettingsSection>
      <PermissionsSection
        notifications={notifications}
        microphone={microphone}
        computerUse={computerUse}
      />
      {computerUse ? <ComputerUseSection view={view} writes={writes} /> : null}
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
