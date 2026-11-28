import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_CHARACTER_NAME,
  MANAGER_FACE_COLOR,
  MANAGER_FACE_COLOR_NAME,
  MANAGER_FACE_PICK_COLORS,
  type ManagerFaceCharacter,
  type ManagerFaceColor,
  type ManagerFace as ManagerFaceValue,
  managerFaceName,
} from "@repo/features/manager-face";
import { noMatchWords } from "@repo/features/words";
import { type RefObject, useCallback, useId, useMemo, useRef, useState } from "react";
import { SmilePlusIcon } from "../../icons/icons.js";
import { ReplayUnmask } from "../../session-replay-marks.js";
import { BUTTON_SIZE, type ButtonSize } from "../button/button.js";
import { CHOICE_BAR_LOOK, ChoiceBar } from "../choice-bar/choice-bar.js";
import { IconPicker, IconPickerChoice, IconPickerGroup } from "../icon-picker/icon-picker.js";
import { type IconPickerColor, IconPickerColors } from "../icon-picker/icon-picker-colors.js";
import {
  IconPickerEmoji,
  type IconPickerEmojiColors,
  useEmojiGroups,
} from "../icon-picker/icon-picker-emoji.js";
import { PopoverIconButton } from "../popover-icon-button/popover-icon-button.js";
import { MANAGER_FACE_SIZE, ManagerFace } from "./manager-face.js";

/**
 * manager-face-picker.tsx -- where a Manager's face is picked, as a section's icon is (`IconPicker`): one search over the characters and every emoji, Characters | Emoji tabs, and a face's colors popped up from the face pressed.
 *
 * The search, "Search characters and emoji", finds an emoji typed or pasted
 * into it first, then the characters whose name holds every word typed,
 * then the emoji whose name it matches (`IconPickerEmoji`, the characters
 * beside its own), and Enter presses the first found. With nothing searched
 * the Characters tab offers Recent, the faces this window picked last in
 * the colors they were picked in, then every character; the Emoji tab every
 * emoji under its Unicode group, loaded the first time it is shown.
 *
 * A character is drawn in gray but the one chosen, in its color, as a
 * section's glyph is drawn in the text's ink but the one chosen; an emoji is
 * drawn bare but the one chosen, on its color. Pressing a face, a character
 * or an emoji, floats its colors from it (`IconPickerColors`): the face in
 * each color a face is given in, gray first, then the section colors in
 * their order, two rows of five, the one it starts on pressed and focused,
 * and a color pressed picks the face in it. There is no Remove, since a
 * Manager always wears a face. The face standing is pressed; with none, as
 * at New Manager before a pick, where the service picks one, none is.
 *
 * It stands where a section's picker does, hung from a well wearing the face
 * (`ManagerFaceWell`), as New Manager and a Manager's Settings offer it, or
 * beside a menu's item on the menu's surface (`ManagerFaceMenuPanel`), as a
 * Manager's Change face › opens it; a pick hands the face on and puts the
 * picker away. Recent is its owner's to keep (`ManagerFaceRecent`), as a
 * section's Recent is kept by the section icon picker's owner.
 *
 * It sits on a subpath of its own (`@repo/ui/manager-face-picker`), out of
 * the barrel, as the face does, so Kawaii reaches only the bundles that
 * draw a Manager.
 */

/** The picker's two kinds of face, as a section's picker has Icons and Emoji. */
const FACE_KIND = {
  CHARACTERS: "characters",
  EMOJI: "emoji",
} as const;

type FaceKind = (typeof FACE_KIND)[keyof typeof FACE_KIND];

/** Where a face whose colors stand open was pressed, since a face may stand in Recent and among the characters at once. */
const OPENED_IN = {
  RECENT: "recent",
  CHARACTERS: "characters",
  EMOJI: "emoji",
} as const;

type OpenedIn = (typeof OPENED_IN)[keyof typeof OPENED_IN];

/** Which face's colors stand open: where it was pressed, and its character or its emoji. */
interface Opened {
  readonly group: OpenedIn;
  readonly choice: string;
}

const CHARACTERS = Object.values(MANAGER_FACE_CHARACTER);

/** The character an emoji face keeps where none stands yet, which the service stores beside the emoji. */
const FIRST_CHARACTER = MANAGER_FACE_CHARACTER.GHOST;

/** The colors a face is asked in: gray first, as a section's glyph offers the text's own ink first, then the section colors in their order. */
const ASKED_COLORS: readonly IconPickerColor<ManagerFaceColor>[] = [
  MANAGER_FACE_COLOR.GRAY,
  ...MANAGER_FACE_PICK_COLORS.filter((color) => color !== MANAGER_FACE_COLOR.GRAY),
].map((value) => ({ value, label: MANAGER_FACE_COLOR_NAME[value] }));

/** How many faces Recent offers, as many as a section's Recent offers icons. */
const RECENT_MOST = 10;

/** What the search asks for. */
const SEARCH_FACES = "Search characters and emoji";

/** What the tabs are called, and the characters under them. */
const FACE_KIND_LABEL = "Face kind";
const CHARACTERS_LABEL = "Characters";
const EMOJI_LABEL = "Emoji";

/** What the faces picked last are offered under. */
const RECENT_LABEL = "Recent";

/** What the picker says where a search found no character and no emoji. */
const NO_FACE_MATCHES = noMatchWords({ one: "character or emoji", many: "characters or emoji" });

/** What the picker's popover is called. */
const MANAGER_FACE = "Manager face";

/** The picker as a menu's panel: on the menu's surface, which the panel beside a menu's item leaves to what it holds. */
const MENU_PANEL =
  "ui-manager-face-menu-panel rounded-menu border border-border-strong bg-popover text-popover-foreground shadow-menu animate-menu-in";

/** Where the faces picked last are kept, as a section's recent icons are: read as the picker opens, written as it picks. */
export interface ManagerFaceRecent {
  readonly read: () => readonly ManagerFaceValue[];
  readonly write: (faces: readonly ManagerFaceValue[]) => void;
}

/** Whether two faces are one choice, whatever their color: one emoji, or one character wearing none. */
function sameChoice(one: ManagerFaceValue, other: ManagerFaceValue): boolean {
  return one.emoji !== undefined || other.emoji !== undefined
    ? one.emoji === other.emoji
    : one.character === other.character;
}

/** The faces picked last once `picked` is: it first, in the color it was picked in, then the rest as they stood, at most `RECENT_MOST`. */
export function recentFaces(
  recent: readonly ManagerFaceValue[],
  picked: ManagerFaceValue,
): ManagerFaceValue[] {
  return [picked, ...recent.filter((one) => !sameChoice(one, picked))].slice(0, RECENT_MOST);
}

/** The characters whose name holds every word of `query`, whatever its case: "speech", "bubble", "cat". */
function charactersFound(query: string): ManagerFaceCharacter[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");

  return CHARACTERS.filter((character) => {
    const name = MANAGER_FACE_CHARACTER_NAME[character].toLowerCase();

    return words.every((word) => name.includes(word));
  });
}

/** `emoji` as a face: in the standing face's color where it is the emoji standing, gray otherwise, keeping the standing character. */
function emojiFace(standing: ManagerFaceValue | undefined, emoji: string): ManagerFaceValue {
  return {
    character: standing?.character ?? FIRST_CHARACTER,
    color: standing?.emoji === emoji ? standing.color : MANAGER_FACE_COLOR.GRAY,
    emoji,
  };
}

/** A face's colors (`IconPickerColors`), a flyout's content: the face drawn in each, starting on its own color; a color pressed picks the face in it. */
function faceColors(
  face: ManagerFaceValue,
  onPick: (face: ManagerFaceValue) => void,
): React.JSX.Element {
  return (
    <IconPickerColors
      colors={ASKED_COLORS}
      starts={face.color}
      face={(color) => <ManagerFace face={{ ...face, color }} size={MANAGER_FACE_SIZE.ROW} />}
      onColor={(color) => onPick({ ...face, color })}
    />
  );
}

/** What the picker's grids are handed: the face standing, whose colors stand open, and where a press, a pick, and colors put away go. */
interface GridProps {
  readonly face: ManagerFaceValue | undefined;
  readonly opened: Opened | undefined;
  readonly onOpen: (opened: Opened) => void;
  readonly onPick: (face: ManagerFaceValue) => void;
  readonly onClose: () => void;
}

/**
 * One face's cell in `group`, drawn as `face` and starting its colors on
 * `face`'s, whose press floats its colors from it (`IconPickerChoice`'s
 * flyout).
 */
function FaceCell({
  group,
  face,
  label,
  pressed,
  stop,
  props,
}: {
  group: OpenedIn;
  face: ManagerFaceValue;
  label: string;
  pressed: boolean;
  stop: boolean;
  props: GridProps;
}): React.JSX.Element {
  const choice = face.emoji ?? face.character;
  const open = props.opened?.group === group && props.opened.choice === choice;

  return (
    <IconPickerChoice
      label={label}
      pressed={pressed}
      stop={stop}
      face={<ManagerFace face={face} size={MANAGER_FACE_SIZE.ROW} />}
      popup
      flyout={
        open
          ? {
              label: `${label} color`,
              content: faceColors(face, props.onPick),
              onClose: props.onClose,
            }
          : undefined
      }
      onPress={() => props.onOpen({ group, choice })}
    />
  );
}

/** Whether `character` is the face standing, which wears no emoji. */
function chosenCharacter(
  face: ManagerFaceValue | undefined,
  character: ManagerFaceCharacter,
): boolean {
  return face !== undefined && face.emoji === undefined && face.character === character;
}

/** A character's cell: in the face's color where it is the face standing, in gray otherwise. */
function characterCell(
  props: GridProps,
  group: OpenedIn,
  character: ManagerFaceCharacter,
  stop: boolean,
): React.JSX.Element {
  const pressed = chosenCharacter(props.face, character);
  const color = pressed && props.face !== undefined ? props.face.color : MANAGER_FACE_COLOR.GRAY;

  return (
    <FaceCell
      key={character}
      group={group}
      face={{ character, color }}
      label={MANAGER_FACE_CHARACTER_NAME[character]}
      pressed={pressed}
      stop={stop}
      props={props}
    />
  );
}

/**
 * The Characters tab with nothing searched: Recent, each face in the color
 * it was picked in, then every character; the first drawn chosen, or else
 * the first drawn, is the grid's tab stop.
 */
function CharacterFaces(
  props: GridProps & { recent: readonly ManagerFaceValue[] },
): React.JSX.Element {
  const { face, recent } = props;
  const recentChosen = (one: ManagerFaceValue) => face !== undefined && sameChoice(face, one);
  const chosenAt = recent.findIndex(recentChosen);
  const characterAt = CHARACTERS.findIndex((character) => chosenCharacter(face, character));

  // Note that the stop counts through Recent, then the characters.
  const stopAt = chosenAt !== -1 ? chosenAt : characterAt !== -1 ? recent.length + characterAt : 0;

  return (
    <>
      {recent.length === 0 ? null : (
        <IconPickerGroup name={RECENT_LABEL}>
          {recent.map((one, at) => {
            const pressed = recentChosen(one);
            const shown = pressed && face !== undefined ? face : one;

            return (
              <FaceCell
                key={one.emoji ?? one.character}
                group={OPENED_IN.RECENT}
                face={shown}
                label={managerFaceName(shown)}
                pressed={pressed}
                stop={at === stopAt}
                props={props}
              />
            );
          })}
        </IconPickerGroup>
      )}
      <IconPickerGroup name={CHARACTERS_LABEL}>
        {CHARACTERS.map((character, at) =>
          characterCell(props, OPENED_IN.CHARACTERS, character, recent.length + at === stopAt),
        )}
      </IconPickerGroup>
    </>
  );
}

/** The emoji whose colors stand open, none where a character's do or none do. */
function openedEmoji(opened: Opened | undefined): string | undefined {
  return opened?.group === OPENED_IN.EMOJI ? opened.choice : undefined;
}

/** The Emoji tab with nothing searched: every emoji under its Unicode group, read the first time the tab is shown. */
function EmojiFaces({
  face,
  opened,
  colors,
  onEmoji,
}: {
  face: ManagerFaceValue | undefined;
  opened: Opened | undefined;
  colors: IconPickerEmojiColors;
  onEmoji: (emoji: string) => void;
}): React.JSX.Element {
  const emoji = useEmojiGroups();

  return (
    <IconPickerEmoji
      groups={emoji.data}
      failed={emoji.isError}
      query=""
      chosen={face?.emoji}
      onEmoji={onEmoji}
      colors={colors}
      opened={openedEmoji(opened)}
    />
  );
}

/**
 * What a search found: an emoji typed into it first, then the characters
 * whose name holds every word, then the emoji whose name it matches
 * (`IconPickerEmoji`, the characters beside its own). The first found is
 * the grid's tab stop.
 */
function FoundFaces(
  props: GridProps & {
    query: string;
    colors: IconPickerEmojiColors;
    onEmoji: (emoji: string) => void;
  },
): React.JSX.Element {
  const emoji = useEmojiGroups();
  const characters = charactersFound(props.query);

  return (
    <IconPickerEmoji
      groups={emoji.data}
      failed={emoji.isError}
      query={props.query}
      chosen={props.face?.emoji}
      onEmoji={props.onEmoji}
      colors={props.colors}
      opened={openedEmoji(props.opened)}
      beside={{
        found:
          characters.length === 0
            ? undefined
            : (stop) => (
                <IconPickerGroup name={CHARACTERS_LABEL}>
                  {characters.map((character, at) =>
                    characterCell(props, OPENED_IN.CHARACTERS, character, stop && at === 0),
                  )}
                </IconPickerGroup>
              ),
        unloaded: undefined,
        noMatch: NO_FACE_MATCHES,
      }}
    />
  );
}

/** The picker; see the module's head. A pick is kept in `recent` and handed to `onChange`. */
export function ManagerFacePicker({
  face,
  recent: kept,
  search,
  onChange,
}: {
  /** The face standing, pressed; none before a pick where the service picks one. */
  face: ManagerFaceValue | undefined;
  /** Where the faces picked last are kept. */
  recent: ManagerFaceRecent;
  /** The search's field, which a popover opening the picker focuses first. */
  search?: RefObject<HTMLInputElement | null> | undefined;
  onChange: (next: ManagerFaceValue) => void;
}): React.JSX.Element {
  const [kind, setKind] = useState<FaceKind>(
    face?.emoji === undefined ? FACE_KIND.CHARACTERS : FACE_KIND.EMOJI,
  );

  const [query, setQuery] = useState("");
  const [recent] = useState(() => kept.read());
  const [opened, setOpened] = useState<Opened | undefined>(undefined);
  const panelId = useId();

  const tabIds = {
    [FACE_KIND.CHARACTERS]: useId(),
    [FACE_KIND.EMOJI]: useId(),
  } satisfies Record<FaceKind, string>;

  // Note that the emoji's doors read the latest owner through a ref, so they stand the same from draw to draw and a press redraws none of the emoji it reaches.
  const latest = useRef({ kept, onChange });
  latest.current = { kept, onChange };

  const pick = useCallback((next: ManagerFaceValue) => {
    const owner = latest.current;

    owner.kept.write(recentFaces(owner.kept.read(), next));
    setOpened(undefined);
    owner.onChange(next);
  }, []);

  // A face pressed again closes the colors it opened, as a disclosure does.
  const open = useCallback((next: Opened) => {
    setOpened((was) =>
      was?.group === next.group && was.choice === next.choice ? undefined : next,
    );
  }, []);

  const close = useCallback(() => setOpened(undefined), []);

  const openEmoji = useCallback(
    (emoji: string) => open({ group: OPENED_IN.EMOJI, choice: emoji }),
    [open],
  );

  const emojiColors = useMemo<IconPickerEmojiColors>(
    () => ({
      chosen: (emoji) => <ManagerFace face={emojiFace(face, emoji)} size={MANAGER_FACE_SIZE.ROW} />,
      colors: (emoji) => faceColors(emojiFace(face, emoji), pick),
      onClose: close,
    }),
    [face, pick, close],
  );

  const props: GridProps = { face, opened, onOpen: open, onPick: pick, onClose: close };

  return (
    <ReplayUnmask>
      <IconPicker
        searchLabel={SEARCH_FACES}
        search={search}
        query={query}
        onQuery={(next) => {
          setOpened(undefined);
          setQuery(next);
        }}
        bar={
          <ChoiceBar<FaceKind>
            label={FACE_KIND_LABEL}
            items={[
              { value: FACE_KIND.CHARACTERS, label: CHARACTERS_LABEL },
              { value: FACE_KIND.EMOJI, label: EMOJI_LABEL },
            ]}
            value={kind}
            onChange={(next) => {
              setOpened(undefined);
              setKind(next);
            }}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            panels={(each) => ({ tab: tabIds[each], panel: panelId })}
          />
        }
        legend={kind === FACE_KIND.CHARACTERS ? CHARACTERS_LABEL : EMOJI_LABEL}
        panel={{ id: panelId, labelledBy: tabIds[kind] }}
      >
        {query.trim() !== "" ? (
          <FoundFaces {...props} query={query} colors={emojiColors} onEmoji={openEmoji} />
        ) : kind === FACE_KIND.CHARACTERS ? (
          <CharacterFaces {...props} recent={recent} />
        ) : (
          <EmojiFaces face={face} opened={opened} colors={emojiColors} onEmoji={openEmoji} />
        )}
      </IconPicker>
    </ReplayUnmask>
  );
}

/**
 * A Manager's face well: a button wearing the face, or the add-icon glyph
 * where none is picked yet, hanging the picker while `open`, as a section's
 * icon well hangs its own; `compact` in an editor. A pick hands the face on
 * and puts the picker away, the focus going back to the well, or where
 * `finalFocus` says, as an editor hands it back to the name's field.
 */
export function ManagerFaceWell({
  face,
  recent,
  open,
  onOpenChange,
  onChange,
  size = BUTTON_SIZE.CONTROL,
  disabled,
  finalFocus,
  ref,
}: {
  face: ManagerFaceValue | undefined;
  /** Where the faces picked last are kept. */
  recent: ManagerFaceRecent;
  open: boolean;
  /** Hears the picker stand or go; `away` where a press away from it put it away (`PopoverIconButton`). */
  onOpenChange: (open: boolean, away: boolean) => void;
  onChange: (next: ManagerFaceValue) => void;
  /** The well's size: a field's, or `compact` in an editor. */
  size?: ButtonSize | undefined;
  disabled?: boolean | undefined;
  /** Where the focus goes as the picker is put away; the well where none is given or it answers none. */
  finalFocus?: (() => HTMLElement | null | undefined) | undefined;
  /** The well's button, which an editor counts as its own. */
  ref?: RefObject<HTMLButtonElement | null> | undefined;
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
      onOpenChange={onOpenChange}
      size={size}
      disabled={disabled}
      initialFocus={search}
      finalFocus={finalFocus}
      ref={ref}
    >
      <ManagerFacePicker
        face={face}
        recent={recent}
        search={search}
        onChange={(next) => {
          onChange(next);
          onOpenChange(false, false);
        }}
      />
    </PopoverIconButton>
  );
}

/** The picker as a menu's panel beside its item (`MenuPanel`'s `panel`), on the menu's surface, as a Manager's Change face › opens it: a pick hands the face on, and its owner closes the menu. */
export function ManagerFaceMenuPanel({
  face,
  recent,
  onChange,
}: {
  /** The face standing, pressed. */
  face: ManagerFaceValue | undefined;
  /** Where the faces picked last are kept. */
  recent: ManagerFaceRecent;
  onChange: (next: ManagerFaceValue) => void;
}): React.JSX.Element {
  return (
    <div className={MENU_PANEL}>
      <ManagerFacePicker face={face} recent={recent} onChange={onChange} />
    </div>
  );
}
