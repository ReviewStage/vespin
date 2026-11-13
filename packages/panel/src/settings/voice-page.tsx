import { DEFAULT_LIVE_VOICE, type LiveVoice } from "@repo/features/voices";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
  voiceSamplePath,
} from "@repo/settings";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  GAP,
  IconButton,
  Inline,
  SettingsAttentionMark,
  SettingsRow,
  SettingsSection,
  Tooltip,
} from "@repo/ui";
import { GLYPH, PlayIcon } from "@repo/ui/icons";
import { OPENAI_KEY_MISSING_NOTE } from "@repo/ui/microphone-access";
import { useOpenAiKeyMissing, useOpenApiKeys } from "../openai-key.js";
import { useSamplePlayer } from "./sample-player.js";
import { SchemaSettingRows } from "./schema-rows.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";

/** The words of the OpenAI key's row, which points to where the key is kept and never shows it. */
const OPENAI_KEY_WORDS = {
  LABEL: "OpenAI key",
  DETAIL: "Voice calls run on this key.",
  OPEN: "Open in Agents",
  ADD: "Add a key",
} as const;

/** What the voice's Play and Stop are called, for a reader and its hover. */
const SAMPLE = {
  PLAY: "Play the voice",
  STOP: "Stop the voice",
} as const;

/**
 * Where the OpenAI key a call runs on is kept: Codex's row in Agents, which
 * the press lands on. A key known to be missing wears the attention mark and
 * the press says to add one; the key itself is never shown here.
 */
function OpenAiKeySection(): React.JSX.Element {
  const missing = useOpenAiKeyMissing();
  const openKey = useOpenApiKeys();

  return (
    <SettingsSection>
      {/* Note that the row stands in a wrapper wearing its search anchor,
          because the shared row takes no attribute of a caller's. */}
      <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.VOICE_API_KEY)}>
        <SettingsRow
          label={
            <Inline gap={GAP.ICON} wrap={false}>
              {OPENAI_KEY_WORDS.LABEL}
              {missing ? <SettingsAttentionMark note={OPENAI_KEY_MISSING_NOTE} /> : null}
            </Inline>
          }
          description={OPENAI_KEY_WORDS.DETAIL}
        >
          {() => (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={openKey}>
              {missing ? OPENAI_KEY_WORDS.ADD : OPENAI_KEY_WORDS.OPEN}
            </Button>
          )}
        </SettingsRow>
      </div>
    </SettingsSection>
  );
}

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
 * voice-page.tsx -- Settings › Voice: the OpenAI key a call runs on, and the voice it speaks with.
 *
 * Drawn only while the Voice experiment is on. A call runs on the account's
 * own OpenAI key, which is kept under Codex in Agents, so the page holds no
 * key of its own and its first row points there. Under it the Conversation
 * group is the schema's rows of the Voice page (`SchemaSettingRows`): the
 * voice, offered in groups by language and region, with Play beside it.
 */
export function VoicePage({ view }: { view: SettingsRowsInput }): React.JSX.Element {
  const voice = view.settings.voice ?? DEFAULT_LIVE_VOICE;

  const actions = (field: AppSettingField) =>
    field === APP_SETTING_SCHEMA.voice.field ? <PlayVoice voice={voice} /> : undefined;

  return (
    <>
      <OpenAiKeySection />
      <SettingsSection {...settingsSectionHead(SECTION.VOICE_CONVERSATION)}>
        <SchemaSettingRows
          page={SCHEMA_SETTINGS_PAGE.VOICE}
          section={SETTING_SECTION.CONVERSATION}
          view={view}
          actions={actions}
        />
      </SettingsSection>
    </>
  );
}
