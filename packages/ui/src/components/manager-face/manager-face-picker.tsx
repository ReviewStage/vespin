import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFaceCharacter,
  type ManagerFaceColor,
  type ManagerFace as ManagerFaceValue,
} from "@repo/features/manager-face";
import { cn } from "../../cn.js";
import { pulseOnPress } from "../../press-pulse.js";
import {
  ROVING_ORIENTATION,
  ROVING_STOP,
  rovingItem,
  useRovingKeys,
} from "../roving-keys/roving-keys.js";
import { MANAGER_FACE_SIZE, ManagerFace } from "./manager-face.js";

/**
 * manager-face-picker.tsx -- the field a Manager's face is picked in: a row of its characters and a row of its colors, each option drawn as the face it makes.
 *
 * A face is a character and a color, so the picker is two radio groups,
 * Character and Color, each one Tab stop on its chosen option, the arrows
 * moving along it and choosing as they go. Every option is drawn as the
 * face it would make: the Character row draws each character in the color
 * chosen, and the Color row the character chosen in each color, so the face
 * standing is the one ringed in both, and a reader sees what a press makes
 * before pressing it. Each option is named by its character or its color,
 * since a face says nothing to a reader who cannot see it.
 *
 * A picker may stand on no face yet, as New Manager's does until a pick,
 * where the service picks one: then nothing is ringed, the Character row
 * draws each character in a color of its own and the Color row the first
 * character in each color, and a press still picks the very face its
 * option draws.
 *
 * It sits on a subpath of its own (`@repo/ui/manager-face-picker`), out of
 * the barrel, as the face does, so Kawaii reaches only the bundles that
 * draw a Manager.
 */

/** What each character is called, as its option is named. */
const CHARACTER_NAME = {
  [MANAGER_FACE_CHARACTER.GHOST]: "Ghost",
  [MANAGER_FACE_CHARACTER.PLANET]: "Planet",
  [MANAGER_FACE_CHARACTER.CAT]: "Cat",
  [MANAGER_FACE_CHARACTER.BACKPACK]: "Backpack",
  [MANAGER_FACE_CHARACTER.MUG]: "Mug",
  [MANAGER_FACE_CHARACTER.SPEECH_BUBBLE]: "Speech bubble",
} as const satisfies Record<ManagerFaceCharacter, string>;

/** What each color is called, as its option is named. */
const COLOR_NAME = {
  [MANAGER_FACE_COLOR.YELLOW]: "Yellow",
  [MANAGER_FACE_COLOR.GREEN]: "Green",
  [MANAGER_FACE_COLOR.BLUE]: "Blue",
  [MANAGER_FACE_COLOR.PINK]: "Pink",
  [MANAGER_FACE_COLOR.PURPLE]: "Purple",
  [MANAGER_FACE_COLOR.PEACH]: "Peach",
} as const satisfies Record<ManagerFaceColor, string>;

const CHARACTERS = Object.values(MANAGER_FACE_CHARACTER);
const COLORS = Object.values(MANAGER_FACE_COLOR);

/** The two rows' names, which each group is labeled by. */
const ROW_NAME = {
  CHARACTER: "Character",
  COLOR: "Color",
} as const;

/** The picker's rows, one above the other. */
const PICKER = "ui-manager-face-picker flex flex-col gap-control-gap";

/** A row of options. */
const ROW = "flex flex-wrap gap-control-gap";

/**
 * An option: the face in a tile a step larger than a control, its edge the
 * selected border while chosen, lit under the pointer, faded while disabled.
 * Note that chosen is the tile's own edge rather than an outline, because
 * the outline is focus's, so a chosen option the keyboard reaches gains the
 * ring around what it already wears.
 */
const OPTION = cn(
  "ui-manager-face-picker-option inline-grid place-items-center size-control-large p-0 m-0",
  "rounded-control border border-transparent [background:none] cursor-press",
  "hover:not-disabled:bg-muted aria-checked:border-border-selected aria-checked:bg-muted",
  "disabled:cursor-default disabled:opacity-disabled",
);

/** One row: a radio group over `values`, each drawn as the face it makes, choosing as the arrows land. */
function FaceRow<Value extends string>({
  label,
  values,
  chosen,
  nameOf,
  faceOf,
  disabled,
  onChoose,
}: {
  label: string;
  values: readonly Value[];
  chosen: Value | undefined;
  nameOf: (value: Value) => string;
  faceOf: (value: Value) => ManagerFaceValue;
  disabled: boolean;
  onChoose: (value: Value) => void;
}): React.JSX.Element {
  const keys = useRovingKeys<HTMLDivElement>({
    orientation: ROVING_ORIENTATION.BOTH,
    stop: ROVING_STOP.CHOSEN,
    moveTo: (option) => {
      option.focus();
      const landed = values.find((value) => value === option.dataset.value);

      if (landed !== undefined && landed !== chosen) onChoose(landed);
    },
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: a radio group of pictures, each a button that is a radio, has no native element.
    <div
      ref={keys.ref}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={ROW}
      data-roving={keys["data-roving"]}
      onFocus={keys.onFocus}
      onKeyDown={disabled ? undefined : keys.onKeyDown}
    >
      {values.map((value) => (
        // biome-ignore lint/a11y/useSemanticElements: a picture drawn as a radio, which a native radio cannot draw.
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === chosen}
          aria-label={nameOf(value)}
          data-value={value}
          disabled={disabled}
          className={OPTION}
          {...rovingItem()}
          onClick={pulseOnPress(() => onChoose(value))}
        >
          <ManagerFace face={faceOf(value)} size={MANAGER_FACE_SIZE.MESSAGE} />
        </button>
      ))}
    </div>
  );
}

/** The face the Character row draws `character` as, and a press on it picks: in the color standing, else in a color of its own. */
function characterFace(
  character: ManagerFaceCharacter,
  face: ManagerFaceValue | undefined,
): ManagerFaceValue {
  const own = COLORS[CHARACTERS.indexOf(character) % COLORS.length] ?? MANAGER_FACE_COLOR.YELLOW;

  return { character, color: face?.color ?? own };
}

/** The face the Color row draws `color` as, and a press on it picks: the character standing, else the first. */
function colorFace(color: ManagerFaceColor, face: ManagerFaceValue | undefined): ManagerFaceValue {
  return { character: face?.character ?? MANAGER_FACE_CHARACTER.GHOST, color };
}

/** A Manager's face picked: its character in a row, and its color in a row, each option drawn as the face it makes. */
export function ManagerFacePicker({
  face,
  disabled = false,
  onChange,
  describedBy,
}: {
  /** The face standing, ringed in both rows; none before a pick where the service picks one. */
  face: ManagerFaceValue | undefined;
  /** Whether the picker takes no press, as while its form saves. */
  disabled?: boolean | undefined;
  /** Takes the face a press or an arrow makes. */
  onChange: (next: ManagerFaceValue) => void;
  /** The ids of words that describe the field, its form field's. */
  describedBy?: string | undefined;
}): React.JSX.Element {
  return (
    <div className={PICKER} aria-describedby={describedBy}>
      <FaceRow
        label={ROW_NAME.CHARACTER}
        values={CHARACTERS}
        chosen={face?.character}
        nameOf={(character) => CHARACTER_NAME[character]}
        faceOf={(character) => characterFace(character, face)}
        disabled={disabled}
        onChoose={(character) => onChange(characterFace(character, face))}
      />
      <FaceRow
        label={ROW_NAME.COLOR}
        values={COLORS}
        chosen={face?.color}
        nameOf={(color) => COLOR_NAME[color]}
        faceOf={(color) => colorFace(color, face)}
        disabled={disabled}
        onChoose={(color) => onChange(colorFace(color, face))}
      />
    </div>
  );
}
