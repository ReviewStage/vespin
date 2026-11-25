import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFaceCharacter,
  type ManagerFaceColor,
  type ManagerFace as ManagerFaceValue,
  managerFaceName,
  managerFacesFound,
} from "@repo/features/manager-face";
import { type RefObject, useRef, useState } from "react";
import { SmilePlusIcon } from "../../icons/icons.js";
import { ReplayUnmask } from "../../session-replay-marks.js";
import { BUTTON_SIZE } from "../button/button.js";
import { CHOICE_BAR_LOOK, ChoiceBar } from "../choice-bar/choice-bar.js";
import { IconPicker, IconPickerChoice, IconPickerGroup } from "../icon-picker/icon-picker.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";
import { PopoverIconButton } from "../popover-icon-button/popover-icon-button.js";
import {
  FACE_COLORS,
  FACE_DIRECTION,
  MANAGER_FACE_SIZE,
  ManagerFace,
  useFaceDirection,
} from "./manager-face.js";

/**
 * manager-face-picker.tsx -- where a Manager's face is picked: the app's one icon picker (`IconPicker`), as a section's icon is picked, listing every face, one group to each character in each of the colors.
 *
 * A face is a character and a color, so the picker lists all thirty-six,
 * under each character's name, each drawn as itself and named by its color
 * and character ("Purple cat"), since a face says nothing to a reader who
 * cannot see it. A search finds the faces whose name holds every word typed
 * ("purple", "cat", "purple cat"), and Enter picks the first found. The face
 * standing is pressed, and the grid's tab stop; with none standing, as at
 * New Manager before a pick, where the service picks one, the first face is.
 *
 * It stands where a section's picker does, hung from a well wearing the face
 * (`ManagerFaceWell`), as a Manager's card offers it, or beside a menu's
 * item on the menu's surface (`ManagerFaceMenuPanel`), as a Manager's Change
 * face › opens it; a pick hands the face on and puts the picker away.
 *
 * It sits on a subpath of its own (`@repo/ui/manager-face-picker`), out of
 * the barrel, as the face does, so Kawaii reaches only the bundles that
 * draw a Manager.
 */

const CHARACTERS = Object.values(MANAGER_FACE_CHARACTER);

/** What the search asks for. */
const SEARCH_FACES = "Search faces";

/** What the faces a search found are listed under. */
const FOUND_FACES = "Faces";

/** What the picker says where a search found no face. */
const NO_FACE_MATCHES = "No faces match.";

/** What the picker's popover is called. */
const MANAGER_FACE = "Manager face";

/** The picker as a menu's panel: on the menu's surface, which the panel beside a menu's item leaves to what it holds. */
const MENU_PANEL =
  "ui-manager-face-menu-panel rounded-menu border border-border-strong bg-popover text-popover-foreground shadow-menu animate-menu-in";

/** PROTOTYPE: the emoji a face may wear, by group, each with the words a search finds it by. */
const EMOJI_GROUPS: readonly {
  readonly name: string;
  readonly emoji: readonly (readonly [string, string])[];
}[] = [
  {
    name: "Animals",
    emoji: [
      ["🐶", "dog"],
      ["🐱", "cat"],
      ["🦊", "fox"],
      ["🐻", "bear"],
      ["🐼", "panda"],
      ["🐨", "koala"],
      ["🐯", "tiger"],
      ["🦁", "lion"],
      ["🐸", "frog"],
      ["🐵", "monkey"],
      ["🐧", "penguin"],
      ["🦉", "owl"],
      ["🐙", "octopus"],
      ["🦄", "unicorn"],
      ["🐝", "bee"],
      ["🐢", "turtle"],
      ["🦖", "dinosaur"],
      ["🐳", "whale"],
      ["🦔", "hedgehog"],
      ["🦦", "otter"],
    ],
  },
  {
    name: "Friends",
    emoji: [
      ["🤖", "robot"],
      ["👾", "alien monster"],
      ["👻", "ghost"],
      ["🪐", "planet"],
      ["😎", "cool sunglasses"],
      ["🤓", "nerd"],
      ["🧐", "monocle"],
      ["🥳", "party"],
      ["🤠", "cowboy"],
      ["🫡", "salute"],
    ],
  },
  {
    name: "Nature",
    emoji: [
      ["🌱", "seedling"],
      ["🌵", "cactus"],
      ["🌻", "sunflower"],
      ["🍄", "mushroom"],
      ["🌈", "rainbow"],
      ["⭐", "star"],
      ["🌙", "moon"],
      ["☀️", "sun"],
      ["⚡", "lightning zap"],
      ["🔥", "fire"],
    ],
  },
  {
    name: "Food",
    emoji: [
      ["☕", "coffee mug"],
      ["🍵", "tea"],
      ["🍩", "donut"],
      ["🍕", "pizza"],
      ["🌮", "taco"],
      ["🍣", "sushi"],
      ["🥑", "avocado"],
      ["🍋", "lemon"],
      ["🍓", "strawberry"],
      ["🧁", "cupcake"],
    ],
  },
  {
    name: "Work",
    emoji: [
      ["🚀", "rocket release"],
      ["🛠️", "tools"],
      ["🧪", "test tube"],
      ["🔭", "telescope"],
      ["📦", "package"],
      ["📈", "chart growth"],
      ["🧭", "compass"],
      ["🎯", "target"],
      ["🎨", "palette design"],
      ["📚", "books docs"],
      ["✏️", "pencil"],
      ["🔍", "magnifier search"],
      ["💡", "bulb idea"],
      ["🔔", "bell"],
      ["🛟", "ring buoy oncall"],
      ["🧹", "broom cleanup"],
      ["🎒", "backpack"],
      ["💬", "speech bubble"],
      ["🗺️", "map"],
      ["🧲", "magnet"],
    ],
  },
];

/** PROTOTYPE: the picker's two kinds in the Mixed direction. */
const FACE_KIND = {
  CHARACTERS: "characters",
  EMOJI: "emoji",
} as const;

type FaceKind = (typeof FACE_KIND)[keyof typeof FACE_KIND];

/** Whether two faces are one. */
function sameFace(one: ManagerFaceValue | undefined, other: ManagerFaceValue): boolean {
  return (
    one?.character === other.character && one.color === other.color && one.emoji === other.emoji
  );
}

/** A face as a character in a color, wearing no emoji. */
function characterFace(character: ManagerFaceCharacter, color: ManagerFaceColor): ManagerFaceValue {
  return { character, color };
}

/** The picker; see the module's head. A pick hands the face to `onChange`. PROTOTYPE: laid out as the direction the switcher names. */
export function ManagerFacePicker({
  face,
  search,
  onChange,
}: {
  /** The face standing, pressed; none before a pick where the service picks one. */
  face: ManagerFaceValue | undefined;
  /** The search's field, which a popover opening the picker focuses first. */
  search?: RefObject<HTMLInputElement | null> | undefined;
  onChange: (next: ManagerFaceValue) => void;
}): React.JSX.Element {
  const { direction } = useFaceDirection();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<FaceKind>(
    face?.emoji === undefined ? FACE_KIND.CHARACTERS : FACE_KIND.EMOJI,
  );
  const searching = query.trim() !== "";
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  const color = face?.color ?? MANAGER_FACE_COLOR.YELLOW;
  const character = face?.character ?? MANAGER_FACE_CHARACTER.GHOST;
  let stopTaken = false;

  // Note that the first choice drawn pressed, or else the first drawn, is the grid's one tab stop.
  const choice = (one: ManagerFaceValue, label = managerFaceName(one)) => {
    const pressed = sameFace(face, one);
    const stop = !stopTaken && (pressed || face === undefined);

    if (stop) stopTaken = true;

    return (
      <IconPickerChoice
        key={`${one.character}:${one.color}:${one.emoji ?? ""}`}
        label={label}
        pressed={pressed}
        stop={stop}
        face={<ManagerFace face={one} size={MANAGER_FACE_SIZE.ROW} />}
        onPress={() => onChange(one)}
      />
    );
  };

  const emojiFound = EMOJI_GROUPS.flatMap((group) =>
    group.emoji.filter(([, name]) => words.every((word) => name.includes(word))),
  );

  const characterGroups = (
    <>
      <IconPickerGroup name="Character">
        {CHARACTERS.map((each) => choice(characterFace(each, color)))}
      </IconPickerGroup>
      <IconPickerGroup name="Color">
        {FACE_COLORS.map((each) =>
          choice(
            face?.emoji !== undefined && direction === FACE_DIRECTION.MIXED
              ? { character, color: each, emoji: face.emoji }
              : characterFace(character, each),
          ),
        )}
      </IconPickerGroup>
    </>
  );

  const emojiGroups = (tinted: boolean) => (
    <>
      {tinted ? (
        <IconPickerGroup name="Color">
          {FACE_COLORS.map((each) =>
            choice({ character, color: each, emoji: face?.emoji ?? "🤖" }),
          )}
        </IconPickerGroup>
      ) : null}
      {EMOJI_GROUPS.map((group) => (
        <IconPickerGroup key={group.name} name={group.name}>
          {group.emoji.map(([emoji, name]) => choice({ character, color, emoji }, name))}
        </IconPickerGroup>
      ))}
    </>
  );

  const found =
    direction === FACE_DIRECTION.EMOJI ||
    (direction === FACE_DIRECTION.MIXED && kind === FACE_KIND.EMOJI)
      ? emojiFound.map(([emoji, name]) => choice({ character, color, emoji }, name))
      : managerFacesFound(query).map((one) => choice(one));

  const body = searching ? (
    found.length === 0 ? (
      <NoteLine look={NOTE_LINE_LOOK.LIST}>{NO_FACE_MATCHES}</NoteLine>
    ) : (
      <IconPickerGroup name={FOUND_FACES}>{found}</IconPickerGroup>
    )
  ) : direction === FACE_DIRECTION.EMOJI ? (
    emojiGroups(false)
  ) : direction === FACE_DIRECTION.MIXED && kind === FACE_KIND.EMOJI ? (
    emojiGroups(true)
  ) : (
    characterGroups
  );

  return (
    <ReplayUnmask>
      <IconPicker
        searchLabel={SEARCH_FACES}
        search={search}
        query={query}
        onQuery={setQuery}
        legend={FOUND_FACES}
        bar={
          <>
            {direction === FACE_DIRECTION.MIXED ? (
              <ChoiceBar<FaceKind>
                label="Face kind"
                items={[
                  { value: FACE_KIND.CHARACTERS, label: "Characters" },
                  { value: FACE_KIND.EMOJI, label: "Emoji" },
                ]}
                value={kind}
                onChange={setKind}
                look={CHOICE_BAR_LOOK.SEGMENTED}
              />
            ) : null}
          </>
        }
      >
        {body}
      </IconPicker>
    </ReplayUnmask>
  );
}

/**
 * A Manager's face well: a button wearing the face, or the add-icon glyph
 * where none is picked yet, hanging the picker while `open`, as a section's
 * icon well hangs its own. A pick hands the face on and puts the picker away.
 */
export function ManagerFaceWell({
  face,
  open,
  onOpenChange,
  onChange,
  disabled,
}: {
  face: ManagerFaceValue | undefined;
  open: boolean;
  /** Hears the picker stand or go. */
  onOpenChange: (open: boolean) => void;
  onChange: (next: ManagerFaceValue) => void;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const search = useRef<HTMLInputElement | null>(null);

  return (
    <PopoverIconButton
      icon={
        face === undefined ? (
          <SmilePlusIcon className="text-muted-foreground" />
        ) : (
          <ManagerFace face={face} size={MANAGER_FACE_SIZE.ROW} />
        )
      }
      label={face === undefined ? "Pick face" : `Change face, ${managerFaceName(face)}`}
      title={MANAGER_FACE}
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      size={BUTTON_SIZE.CONTROL}
      disabled={disabled}
      initialFocus={search}
    >
      <ManagerFacePicker
        face={face}
        search={search}
        onChange={(next) => {
          onChange(next);
          onOpenChange(false);
        }}
      />
    </PopoverIconButton>
  );
}

/** The picker as a menu's panel beside its item (`MenuPanel`'s `panel`), on the menu's surface, as a Manager's Change face › opens it: a pick hands the face on, and its owner closes the menu. */
export function ManagerFaceMenuPanel({
  face,
  onChange,
}: {
  /** The face standing, pressed. */
  face: ManagerFaceValue | undefined;
  onChange: (next: ManagerFaceValue) => void;
}): React.JSX.Element {
  return (
    <div className={MENU_PANEL}>
      <ManagerFacePicker face={face} onChange={onChange} />
    </div>
  );
}
