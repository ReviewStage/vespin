import { DEFAULT_LIVE_VOICE, type LiveVoice } from "@repo/features/voices";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
  settingRowsForPage,
  voiceSamplePath,
} from "@repo/settings";
import { IconButton, SettingsSection, Tooltip } from "@repo/ui";
import { GLYPH, PlayIcon } from "@repo/ui/icons";
import { useSamplePlayer } from "./sample-player.js";
import { SchemaSettingRows } from "./schema-rows.js";

/** What the voice's Play and Stop are called, for a reader and its hover. */
const SAMPLE = {
  PLAY: "Play the voice",
  STOP: "Stop the voice",
} as const;

/**
 * Play, beside the voice's pop-up: the chosen voice's clip, which a second
 * press stops. Note that it plays the voice as stored, so a new pick is
 * heard by pressing Play again, and a call opened later speaks with it.
 */
function PlayVoice({ voice }: { voice: LiveVoice }): React.JSX.Element {
  const sample = useSamplePlayer();
  const label = sample.playing ? SAMPLE.STOP : SAMPLE.PLAY;

  return (
    <Tooltip label={label}>
      <IconButton
        icon={sample.playing ? <GLYPH.STOP /> : <PlayIcon />}
        label={label}
        onClick={() => (sample.playing ? sample.stop() : sample.play(voiceSamplePath(voice)))}
      />
    </Tooltip>
  );
}

/**
 * voice-section.tsx -- Settings › Agents' Voice card: the voice a call speaks with, under the harnesses' cards.
 *
 * A call runs on the account's own OpenAI key, which Codex's card above
 * holds, so the card has no key row of its own. Its one row is the schema's
 * (`SchemaSettingRows`): the voice, offered in groups by language and
 * region, with Play beside it. It stands only while the Voice experiment is
 * on, and so draws nothing, not even its card, while the schema offers no row.
 */
export function VoiceSection({ view }: { view: SettingsRowsInput }): React.JSX.Element | null {
  const voice = view.settings.voice ?? DEFAULT_LIVE_VOICE;

  const actions = (field: AppSettingField) =>
    field === APP_SETTING_SCHEMA.voice.field ? <PlayVoice voice={voice} /> : undefined;

  // Note that the card is drawn only while the schema offers its row, so no empty card stands.
  if (settingRowsForPage(SCHEMA_SETTINGS_PAGE.AGENTS, SETTING_SECTION.VOICE, view).length === 0) {
    return null;
  }

  return (
    <SettingsSection>
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.AGENTS}
        section={SETTING_SECTION.VOICE}
        view={view}
        actions={actions}
      />
    </SettingsSection>
  );
}
