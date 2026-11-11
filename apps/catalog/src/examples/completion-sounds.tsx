import { BUTTON_VARIANT, Button, GAP, Inline, TEXT_TONE, TEXT_VARIANT, Text } from "@repo/ui";
import { playCompletionSound } from "@repo/ui/completion-sound";
import {
  COMPLETION_SOUND,
  COMPLETION_SOUND_GROUP,
  COMPLETION_SOUND_GROUP_LABEL,
  COMPLETION_SOUND_GROUP_OF,
  COMPLETION_SOUND_LABEL,
  COMPLETION_SOUNDS,
  type CompletionSoundGroup,
} from "@repo/wire/app-settings";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * completion-sounds.tsx -- the completion sounds, listed by group, each a press that plays it.
 *
 * This is where a sound is tuned by ear: press one, change its recipe in
 * `@repo/ui`'s `completion-sound.ts`, press it again. Pressing a sound
 * again while it sounds plays nothing, and another sound cuts it short, as
 * wherever the player is called. Your clip is the account's own upload,
 * which the catalog holds none of, so it plays the chime it falls back to.
 */

const GROUPS: readonly CompletionSoundGroup[] = Object.values(COMPLETION_SOUND_GROUP);

const SECTION_ID = {
  [COMPLETION_SOUND_GROUP.SIMPLE]: "completion-sounds-simple",
  [COMPLETION_SOUND_GROUP.PLAYFUL]: "completion-sounds-playful",
  [COMPLETION_SOUND_GROUP.CUSTOM]: "completion-sounds-custom",
} as const satisfies Record<CompletionSoundGroup, string>;

function CompletionSounds(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="completion-sounds-how" title="Press to hear one">
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          Nothing here plays on its own. Pressing a sound again while it plays does nothing.
        </Text>
      </CatalogSection>
      {GROUPS.map((group) => (
        <CatalogSection
          key={group}
          id={SECTION_ID[group]}
          title={COMPLETION_SOUND_GROUP_LABEL[group]}
        >
          <Inline gap={GAP.CONTROL}>
            {COMPLETION_SOUNDS.filter(
              // Note that both sounds' own clips play the chime here, so one stands for the two.
              (sound) =>
                COMPLETION_SOUND_GROUP_OF[sound] === group && sound !== COMPLETION_SOUND.CUSTOM_ASK,
            ).map((sound) => (
              <Button
                key={sound}
                variant={BUTTON_VARIANT.OUTLINE}
                onClick={() => playCompletionSound(sound)}
              >
                {COMPLETION_SOUND_LABEL[sound]}
              </Button>
            ))}
          </Inline>
        </CatalogSection>
      ))}
    </>
  );
}

export const COMPLETION_SOUNDS_EXAMPLE: Example = {
  id: "completion-sounds",
  title: "Completion sounds",
  Render: CompletionSounds,
};
