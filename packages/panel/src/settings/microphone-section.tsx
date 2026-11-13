import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@repo/settings";
import { SettingsSection } from "@repo/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";

/**
 * microphone-section.tsx -- the This Mac page's Dictation group: which microphone dictation prefers.
 *
 * Dictation records the microphone in the window it is pressed in, so the
 * group stands only on a platform whose microphone the app asks for itself.
 * Whether macOS lets the app at the microphone stands with every other
 * permission, under Permissions (`permissions-section.tsx`); here stand the
 * microphone's own settings, the schema's rows of This Mac's microphone
 * section (`SchemaSettingRows`).
 */
export function MicrophoneSection({ view }: { view: SettingsRowsInput }): React.JSX.Element {
  return (
    <SettingsSection {...settingsSectionHead(SECTION.DICTATION)}>
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.THIS_MAC}
        section={SETTING_SECTION.MICROPHONE}
        view={view}
      />
    </SettingsSection>
  );
}
