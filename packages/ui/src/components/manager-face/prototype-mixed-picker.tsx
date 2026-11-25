/**
 * prototype-mixed-picker.tsx -- PROTOTYPE (round 2): the Mixed direction's face picker, made of the very parts a sidebar section's icon picker is: one search over characters and every emoji, Characters and Emoji tabs, and the section icons' colors.
 *
 * Throwaway, never merged. The picker is the app's one icon picker
 * (`IconPicker`) laid out as a section's is (`section-icon-picker.tsx`):
 * a search that finds characters and emoji alike ("Search characters and
 * emoji", as a section's says "Search icons and emoji"), an emoji typed into
 * it offered first; a segmented Characters | Emoji bar, as a section's Icons
 * | Emoji; and the Emoji tab listing every emoji `unicode-emoji-json` holds
 * under Unicode's own groups, through the same model a section's picker reads
 * (`section-icon-model.ts`), so the app has one emoji picker.
 *
 * Under the tabs stands one color row, the face drawn in each color, as a
 * section glyph's colors draw the glyph in each: the same hues in the same
 * order and names (red, orange, yellow, green, teal, blue, purple, pink),
 * then gray where a section offers the text's own ink, so a face and a
 * section are colored from one palette. A color recolors whatever the face
 * is, character or emoji, and every character in the grid with it.
 */

import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_CHARACTER_NAME,
  MANAGER_FACE_COLOR,
  MANAGER_FACE_COLOR_NAME,
  type ManagerFaceCharacter,
  type ManagerFace as ManagerFaceValue,
} from "@repo/features/manager-face";
import { noMatchWords, readingWords } from "@repo/features/words";
import { type RefObject, useEffect, useRef, useState } from "react";
import { type EmojiGroup, emojiGroups, findEmoji } from "../../section-icon-model.js";
import { IconButton } from "../button/button.js";
import { CHOICE_BAR_LOOK, ChoiceBar } from "../choice-bar/choice-bar.js";
import {
  ICON_PICKER_ASIDE,
  IconPicker,
  IconPickerChoice,
  IconPickerGroup,
} from "../icon-picker/icon-picker.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";
import { ROVING_ORIENTATION, useRovingKeys } from "../roving-keys/roving-keys.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { MANAGER_FACE_SIZE, ManagerFace, MIXED_COLORS } from "./manager-face.js";

/** The picker's two kinds of face, as a section's picker has Icons and Emoji. */
const FACE_KIND = {
  CHARACTERS: "characters",
  EMOJI: "emoji",
} as const;

type FaceKind = (typeof FACE_KIND)[keyof typeof FACE_KIND];

const CHARACTERS = Object.values(MANAGER_FACE_CHARACTER);

/** What the picker says while the emoji load, where they failed to, and where a search found nothing. */
const READING_EMOJI = readingWords("emoji");
const EMOJI_FAILED = "The emoji could not be loaded.";
const NO_MATCH = noMatchWords({ one: "character or emoji", many: "characters or emoji" });

/* ----- Every emoji, loaded once, as a section's picker loads them ----- */

const EMOJI_READ = {
  READING: "reading",
  READ: "read",
  FAILED: "failed",
} as const;

type EmojiRead =
  | { readonly state: typeof EMOJI_READ.READING }
  | { readonly state: typeof EMOJI_READ.READ; readonly groups: readonly EmojiGroup[] }
  | { readonly state: typeof EMOJI_READ.FAILED };

let emojiLoad: Promise<readonly EmojiGroup[]> | undefined;

function loadEmoji(): Promise<readonly EmojiGroup[]> {
  emojiLoad ??= import("unicode-emoji-json/data-by-group.json").then((module) =>
    emojiGroups(module.default),
  );

  return emojiLoad;
}

/** Every emoji by category, loaded the first time the picker asks. */
function useEmoji(wanted: boolean): EmojiRead {
  const [read, setRead] = useState<EmojiRead>({ state: EMOJI_READ.READING });

  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;

    loadEmoji().then(
      (groups) => {
        if (live) setRead({ state: EMOJI_READ.READ, groups });
      },
      () => {
        if (live) setRead({ state: EMOJI_READ.FAILED });
      },
    );

    return () => {
      live = false;
    };
  }, [wanted]);

  return read;
}

/* ----- The picker ----- */

/** Whether `text` is one emoji a reader typed or pasted, which the search offers first. */
function typedEmoji(text: string): string | undefined {
  const trimmed = text.trim();

  return /^\p{Extended_Pictographic}/u.test(trimmed) && [...trimmed].length <= 8
    ? trimmed
    : undefined;
}

/**
 * The color row: the face standing drawn in each color, the one it wears
 * pressed, one tab stop walked with the arrows, as a section glyph's colors are.
 */
function ColorRow({
  face,
  onColor,
}: {
  face: ManagerFaceValue;
  onColor: (next: ManagerFaceValue) => void;
}): React.JSX.Element {
  const roving = useRovingKeys<HTMLDivElement>({ orientation: ROVING_ORIENTATION.HORIZONTAL });

  return (
    <div className="flex flex-col gap-tight-gap">
      <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.GROUP} className="m-0">
        Color
      </Text>
      <div
        ref={roving.ref}
        data-roving={roving["data-roving"]}
        role="toolbar"
        aria-label="Face color"
        className={`${ICON_PICKER_ASIDE} grid grid-cols-section-icons gap-tight-gap`}
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
      >
        {MIXED_COLORS.map((color) => (
          <IconButton
            key={color}
            icon={<ManagerFace face={{ ...face, color }} size={MANAGER_FACE_SIZE.ROW} raw />}
            label={MANAGER_FACE_COLOR_NAME[color]}
            pressed={face.color === color}
            roving
            onClick={() => onColor({ ...face, color })}
          />
        ))}
      </div>
    </div>
  );
}

/** One emoji's choice, a press choosing it at once in the face's color. */
function emojiChoice(
  one: { readonly emoji: string; readonly name: string },
  face: ManagerFaceValue,
  stop: boolean,
  onChange: (next: ManagerFaceValue) => void,
): React.JSX.Element {
  return (
    <IconPickerChoice
      key={one.emoji}
      label={one.name}
      pressed={face.emoji === one.emoji}
      stop={stop}
      face={<span className="text-foreground">{one.emoji}</span>}
      onPress={() => onChange({ character: face.character, color: face.color, emoji: one.emoji })}
    />
  );
}

/** One character's choice, drawn in the face's color. */
function characterChoice(
  character: ManagerFaceCharacter,
  face: ManagerFaceValue,
  stop: boolean,
  onChange: (next: ManagerFaceValue) => void,
): React.JSX.Element {
  const one = { character, color: face.color };

  return (
    <IconPickerChoice
      key={character}
      label={MANAGER_FACE_CHARACTER_NAME[character]}
      pressed={face.emoji === undefined && face.character === character}
      stop={stop}
      face={<ManagerFace face={one} size={MANAGER_FACE_SIZE.ROW} raw />}
      onPress={() => onChange(one)}
    />
  );
}

/** The Mixed picker; see the module's head. */
export function MixedFacePicker({
  face: standing,
  search,
  onChange,
}: {
  face: ManagerFaceValue | undefined;
  search?: RefObject<HTMLInputElement | null> | undefined;
  onChange: (next: ManagerFaceValue) => void;
}): React.JSX.Element {
  const face = standing ?? {
    character: MANAGER_FACE_CHARACTER.GHOST,
    color: MANAGER_FACE_COLOR.YELLOW,
  };
  const [kind, setKind] = useState<FaceKind>(
    face.emoji === undefined ? FACE_KIND.CHARACTERS : FACE_KIND.EMOJI,
  );
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const emoji = useEmoji(searching || kind === FACE_KIND.EMOJI);
  const panelId = useRef(`mixed-face-panel-${Math.random().toString(36).slice(2)}`).current;

  const note = (words: string) => <NoteLine look={NOTE_LINE_LOOK.LIST}>{words}</NoteLine>;

  const emojiNote =
    emoji.state === EMOJI_READ.FAILED
      ? note(EMOJI_FAILED)
      : emoji.state === EMOJI_READ.READING
        ? note(READING_EMOJI)
        : undefined;

  const body = (() => {
    if (searching) {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word !== "");
      const characters = CHARACTERS.filter((character) =>
        words.every((word) => MANAGER_FACE_CHARACTER_NAME[character].toLowerCase().includes(word)),
      );
      const typed = typedEmoji(query);
      const typedOne = typed === undefined ? [] : [{ emoji: typed, name: typed }];
      const found =
        emoji.state === EMOJI_READ.READ
          ? findEmoji(emoji.groups, query)
              .flatMap((group) => group.emojis)
              .filter((one) => one.emoji !== typed)
          : [];

      if (characters.length === 0 && typedOne.length === 0 && found.length === 0) {
        return emojiNote ?? note(NO_MATCH);
      }

      return (
        <>
          {typedOne.length === 0 ? null : (
            <IconPickerGroup name="Emoji">
              {typedOne.map((one) => emojiChoice(one, face, true, onChange))}
            </IconPickerGroup>
          )}
          {characters.length === 0 ? null : (
            <IconPickerGroup name="Characters">
              {characters.map((character, at) =>
                characterChoice(character, face, typedOne.length === 0 && at === 0, onChange),
              )}
            </IconPickerGroup>
          )}
          {found.length === 0 ? null : (
            <IconPickerGroup name={typedOne.length === 0 ? "Emoji" : "More emoji"}>
              {found.map((one, at) =>
                emojiChoice(
                  one,
                  face,
                  typedOne.length === 0 && characters.length === 0 && at === 0,
                  onChange,
                ),
              )}
            </IconPickerGroup>
          )}
        </>
      );
    }

    if (kind === FACE_KIND.CHARACTERS) {
      const stopAt = face.emoji === undefined ? face.character : CHARACTERS[0];

      return (
        <IconPickerGroup name="Characters">
          {CHARACTERS.map((character) =>
            characterChoice(character, face, character === stopAt, onChange),
          )}
        </IconPickerGroup>
      );
    }

    if (emoji.state !== EMOJI_READ.READ) return emojiNote;
    const all = emoji.groups.flatMap((group) => group.emojis);
    const stop = all.find((one) => one.emoji === face.emoji) ?? all[0];

    return (
      <>
        {emoji.groups.map((group) => (
          <IconPickerGroup key={group.name} name={group.name}>
            {group.emojis.map((one) => emojiChoice(one, face, one === stop, onChange))}
          </IconPickerGroup>
        ))}
      </>
    );
  })();

  return (
    <IconPicker
      searchLabel="Search characters and emoji"
      search={search}
      query={query}
      onQuery={setQuery}
      legend={kind === FACE_KIND.CHARACTERS ? "Characters" : "Emoji"}
      panel={{ id: panelId, labelledBy: `${panelId}-${kind}` }}
      bar={
        <>
          <ChoiceBar<FaceKind>
            label="Face kind"
            items={[
              { value: FACE_KIND.CHARACTERS, label: "Characters" },
              { value: FACE_KIND.EMOJI, label: "Emoji" },
            ]}
            value={kind}
            onChange={setKind}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            panels={(each) => ({ tab: `${panelId}-${each}`, panel: panelId })}
          />
          <ColorRow face={face} onColor={onChange} />
        </>
      }
    >
      {body}
    </IconPicker>
  );
}
