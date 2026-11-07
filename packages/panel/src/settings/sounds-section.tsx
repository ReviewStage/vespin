import {
  APP_SETTING_DEFAULTS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@repo/settings";
import { IconButton, SettingsSection, Tooltip } from "@repo/ui";
import { playCompletionSound } from "@repo/ui/completion-sound";
import { PlayIcon } from "@repo/ui/icons";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * sounds-section.tsx -- the Account page's Sounds group: whether a sound plays as an agent the account started finishes or asks, and which one, which the account carries across its Macs and the web.
 *
 * Both rows are the schema's (`soundWhen`, `completionSound`), drawn by
 * `SchemaSettingRows` like every stored setting, so the settings search finds
 * them too; the sound's row stands only while a sound plays at all. Beside
 * its pop-up stands Play, the quiet `IconButton`, which plays the chosen
 * sound through `@repo/ui`'s player, as an agent's finish would.
 */

/** What Play is called, for a reader and its hover. */
const PLAY = "Play the sound";

export function SoundsSection({
  view,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  const sound = view.settings.completionSound ?? APP_SETTING_DEFAULTS.completionSound;
  const actions = (field: AppSettingField) =>
    field === APP_SETTING_SCHEMA.completionSound.field ? (
      <Tooltip label={PLAY}>
        <IconButton icon={<PlayIcon />} label={PLAY} onClick={() => playCompletionSound(sound)} />
      </Tooltip>
    ) : undefined;
  return (
    <SettingsSection title="Sounds">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.ACCOUNT}
        section={SETTING_SECTION.SOUNDS}
        view={view}
        actions={actions}
      />
    </SettingsSection>
  );
}
