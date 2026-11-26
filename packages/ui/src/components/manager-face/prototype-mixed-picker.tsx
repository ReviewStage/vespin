/**
 * prototype-mixed-picker.tsx -- PROTOTYPE (round 3): the Mixed direction's face picker, built as a sidebar section's icon picker is (`section-icon-picker.tsx`): one search over characters and every emoji, Characters | Emoji tabs, and a face's colors asked in a small menu that pops up from the face pressed.
 *
 * Throwaway, never merged. Where a section's picker and a face's differ, the
 * section's shape is followed:
 *
 * - A search "Search characters and emoji", as a section's "Search icons
 *   and emoji", finding an emoji typed or pasted first, then the characters
 *   ("Icons" there), then the emoji whose name it matches.
 * - Characters | Emoji tabs, as Icons | Emoji. The Characters tab offers
 *   Recent, the faces this window picked last in the colors they were
 *   picked in, then every character, as Icons offers Recent, Suggested, and
 *   All icons; the Emoji tab every emoji `unicode-emoji-json` holds, under
 *   Unicode's own groups, through the section picker's model.
 * - A character is drawn in the text's quiet ink but the one chosen, in its
 *   color, as a glyph is; pressing it opens its colors under it, the
 *   character in each, gray first where a section offers the text's own ink,
 *   then the section icons' hues in their order, two rows of five; the one
 *   it starts on pressed and focused, the arrows walking them, Escape or a
 *   press away putting them away, and a color pressed choosing the face.
 *
 * Two differences stay, since a face is not a section's icon: an emoji
 * pressed opens its colors too, because a face's emoji stands on a disc of
 * its color where a section's stands bare; and there is no Remove icon,
 * because a Manager always wears a face.
 */

import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_CHARACTER_NAME,
  MANAGER_FACE_COLOR,
  MANAGER_FACE_COLOR_NAME,
  type ManagerFaceCharacter,
  type ManagerFaceColor,
  type ManagerFace as ManagerFaceValue,
} from "@repo/features/manager-face";
import { noMatchWords, readingWords } from "@repo/features/words";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { type EmojiGroup, emojiGroups, findEmoji } from "../../section-icon-model.js";
import { AnchoredPopover } from "../anchored-popover/anchored-popover.js";
import { POPOVER_ALIGN, POPOVER_WIDTH } from "../anchored-popover/popover-place.js";
import { ICON_BUTTON_SIZE, IconButton } from "../button/button.js";
import { CHOICE_BAR_LOOK, ChoiceBar } from "../choice-bar/choice-bar.js";
import {
  ICON_PICKER_ASIDE,
  IconPicker,
  IconPickerChoice,
  IconPickerGroup,
} from "../icon-picker/icon-picker.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";
import { POPOVER_PANEL_LOOK, PopoverPanel } from "../popover-panel/popover-panel.js";
import { ROVING_ORIENTATION, useRovingKeys } from "../roving-keys/roving-keys.js";
import { MANAGER_FACE_SIZE, ManagerFace, MIXED_COLORS } from "./manager-face.js";

/** The picker's two kinds of face, as a section's picker has Icons and Emoji. */
const FACE_KIND = {
  CHARACTERS: "characters",
  EMOJI: "emoji",
} as const;

type FaceKind = (typeof FACE_KIND)[keyof typeof FACE_KIND];

const CHARACTERS = Object.values(MANAGER_FACE_CHARACTER);

/** The colors a face is asked in: gray first, where a section offers the text's own ink, then the section icons' hues in their order. */
const ASKED_COLORS: readonly ManagerFaceColor[] = [
  MANAGER_FACE_COLOR.GRAY,
  ...MIXED_COLORS.filter((color) => color !== MANAGER_FACE_COLOR.GRAY),
];

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

/* ----- Recent, as a section's picker keeps the icons this Mac chose last ----- */

const RECENT_KEY = "prototype.recentFaces";
const RECENT_MOST = 10;

function readRecent(): readonly ManagerFaceValue[] {
  try {
    const kept: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");

    // SAFETY: only this module writes the key, and it writes faces.
    return Array.isArray(kept) ? (kept as ManagerFaceValue[]) : [];
  } catch {
    return [];
  }
}

/** Whether two faces are the same choice, whatever their color: one character, or one emoji. */
function sameChoice(one: ManagerFaceValue, other: ManagerFaceValue): boolean {
  return one.emoji !== undefined || other.emoji !== undefined
    ? one.emoji === other.emoji
    : one.character === other.character;
}

function keepRecent(face: ManagerFaceValue): void {
  const next = [face, ...readRecent().filter((one) => !sameChoice(one, face))].slice(
    0,
    RECENT_MOST,
  );

  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Note that a refused write keeps Recent as it stood.
  }
}

/* ----- A face's colors, popped up from the face pressed ----- */

/** What a face is called: its character's name, or its emoji's. */
function choiceLabel(face: ManagerFaceValue, emojiName?: string): string {
  return face.emoji === undefined
    ? MANAGER_FACE_CHARACTER_NAME[face.character]
    : (emojiName ?? face.emoji);
}

/**
 * A pressed face's colors, hung over the grid from the face as a menu is,
 * as a section glyph's colors are: the face drawn in each, the one it starts
 * on pressed and focused; a press chooses the face in that color, and
 * Escape or the focus leaving puts them away.
 */
function FaceColors({
  face,
  label,
  starts,
  onColor,
  onClose,
}: {
  face: ManagerFaceValue;
  label: string;
  starts: ManagerFaceColor;
  onColor: (color: ManagerFaceColor) => void;
  onClose: (byKey: boolean) => void;
}): React.JSX.Element {
  const start = useRef<HTMLButtonElement | null>(null);
  const roving = useRovingKeys<HTMLDivElement>({ orientation: ROVING_ORIENTATION.BOTH });
  const holder = useRef<HTMLDivElement | null>(null);

  return (
    <PopoverPanel
      open
      title={`${label} color`}
      replayUnmasked
      look={POPOVER_PANEL_LOOK.MENU}
      initialFocus={start}
      onDismiss={() => onClose(true)}
      onLeave={(left) => {
        const cell = holder.current?.closest(".ui-face-cell");
        const toCell =
          left instanceof Node ? cell?.contains(left) === true : cell?.matches(":hover") === true;

        if (!toCell) onClose(false);
      }}
    >
      <div
        ref={(element) => {
          holder.current = element;
          roving.ref(element);
        }}
        data-roving={roving["data-roving"]}
        role="toolbar"
        aria-label={`${label} color`}
        className={`${ICON_PICKER_ASIDE} grid grid-cols-5 gap-tight-gap p-tight-gap`}
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
      >
        {ASKED_COLORS.map((color) => (
          <IconButton
            key={color}
            size={ICON_BUTTON_SIZE.PICKER}
            ref={color === starts ? start : undefined}
            icon={<ManagerFace face={{ ...face, color }} size={MANAGER_FACE_SIZE.ROW} raw />}
            label={MANAGER_FACE_COLOR_NAME[color]}
            pressed={color === starts}
            roving
            onClick={() => onColor(color)}
          />
        ))}
      </div>
    </PopoverPanel>
  );
}

/** Which cell's colors stand open: the group it was pressed in, and its face. */
interface Opened {
  readonly group: string;
  readonly face: ManagerFaceValue;
}

/**
 * One face's cell in `group`, whose press opens its colors under it, as a
 * section glyph's cell does. A character not chosen is drawn quiet, in gray,
 * as a glyph not chosen is drawn in the text's ink; an emoji, bare, as a
 * section's emoji is.
 */
function FaceCell({
  group,
  face,
  label,
  pressed,
  inked,
  starts,
  stop,
  opened,
  onOpen,
  onChoose,
  onClose,
}: {
  group: string;
  face: ManagerFaceValue;
  label: string;
  pressed: boolean;
  inked: boolean;
  starts: ManagerFaceColor;
  stop: boolean;
  opened: Opened | undefined;
  onOpen: (opened: Opened) => void;
  onChoose: (face: ManagerFaceValue) => void;
  onClose: (byKey: boolean) => void;
}): React.JSX.Element {
  const open = opened?.group === group && sameChoice(opened.face, face);
  const drawn =
    face.emoji !== undefined && !inked ? (
      <span className="text-foreground">{face.emoji}</span>
    ) : (
      <ManagerFace
        face={inked ? face : { ...face, color: MANAGER_FACE_COLOR.GRAY }}
        size={MANAGER_FACE_SIZE.ROW}
        raw
      />
    );

  return (
    <span className="ui-face-cell relative grid">
      <IconPickerChoice
        label={label}
        pressed={pressed}
        stop={stop}
        face={drawn}
        popup
        onPress={() => onOpen({ group, face })}
      />
      {open ? (
        <AnchoredPopover
          open
          align={POPOVER_ALIGN.START}
          width={POPOVER_WIDTH.FIT}
          onPressAway={() => onClose(false)}
        >
          <FaceColors
            face={face}
            label={label}
            starts={starts}
            onColor={(color) => onChoose({ ...face, color })}
            onClose={onClose}
          />
        </AnchoredPopover>
      ) : null}
    </span>
  );
}

/* ----- The picker ----- */

/** Whether `text` is one emoji a reader typed or pasted, which the search offers first. */
function typedEmoji(text: string): string | undefined {
  const trimmed = text.trim();

  return /^\p{Extended_Pictographic}/u.test(trimmed) && [...trimmed].length <= 8
    ? trimmed
    : undefined;
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
  const [recent] = useState(readRecent);
  const [opened, setOpened] = useState<Opened | undefined>(undefined);
  const searching = query.trim() !== "";
  const emoji = useEmoji(searching || kind === FACE_KIND.EMOJI);
  const panelId = useId();
  let stopTaken = false;

  // A face pressed again closes the colors it opened, as a disclosure does.
  const open = (next: Opened) =>
    setOpened((was) =>
      was?.group === next.group && sameChoice(was.face, next.face) ? undefined : next,
    );

  const choose = (next: ManagerFaceValue) => {
    keepRecent(next);
    setOpened(undefined);
    onChange(next);
  };

  const close = () => setOpened(undefined);

  // Note that the first cell drawn chosen, or else the first drawn, is the grid's one tab stop.
  const cell = (
    group: string,
    one: ManagerFaceValue,
    options: { label?: string; inked?: boolean } = {},
  ) => {
    const pressed = sameChoice(face, one) && (one.emoji !== undefined || face.emoji === undefined);
    const stop = !stopTaken && (pressed || standing === undefined);

    if (stop) stopTaken = true;

    return (
      <FaceCell
        key={`${group}:${one.emoji ?? one.character}`}
        group={group}
        face={one}
        label={options.label ?? choiceLabel(one)}
        pressed={pressed}
        inked={options.inked ?? pressed}
        starts={pressed ? face.color : options.inked ? one.color : MANAGER_FACE_COLOR.GRAY}
        stop={stop}
        opened={opened}
        onOpen={open}
        onChoose={choose}
        onClose={close}
      />
    );
  };

  const characterFace = (character: ManagerFaceCharacter): ManagerFaceValue => ({
    character,
    color:
      face.emoji === undefined && face.character === character
        ? face.color
        : MANAGER_FACE_COLOR.GRAY,
  });

  const emojiFace = (one: string): ManagerFaceValue => ({
    character: face.character,
    color: face.emoji === one ? face.color : MANAGER_FACE_COLOR.GRAY,
    emoji: one,
  });

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
      const found =
        emoji.state === EMOJI_READ.READ
          ? findEmoji(emoji.groups, query)
              .flatMap((group) => group.emojis)
              .filter((one) => one.emoji !== typed)
          : [];

      if (characters.length === 0 && typed === undefined && found.length === 0) {
        return emojiNote ?? note(NO_MATCH);
      }

      return (
        <>
          {typed === undefined ? null : (
            <IconPickerGroup name="Emoji">{cell("typed", emojiFace(typed))}</IconPickerGroup>
          )}
          {characters.length === 0 ? null : (
            <IconPickerGroup name="Characters">
              {characters.map((character) => cell("found-characters", characterFace(character)))}
            </IconPickerGroup>
          )}
          {found.length === 0 ? null : (
            <IconPickerGroup name={typed === undefined ? "Emoji" : "More emoji"}>
              {found.map((one) => cell("found-emoji", emojiFace(one.emoji), { label: one.name }))}
            </IconPickerGroup>
          )}
        </>
      );
    }

    if (kind === FACE_KIND.CHARACTERS) {
      return (
        <>
          {recent.length === 0 ? null : (
            <IconPickerGroup name="Recent">
              {recent.map((one) => cell("recent", one, { inked: true }))}
            </IconPickerGroup>
          )}
          <IconPickerGroup name="Characters">
            {CHARACTERS.map((character) => cell("characters", characterFace(character)))}
          </IconPickerGroup>
        </>
      );
    }

    if (emoji.state !== EMOJI_READ.READ) return emojiNote;

    return (
      <>
        {emoji.groups.map((group) => (
          <IconPickerGroup key={group.name} name={group.name}>
            {group.emojis.map((one) => cell(group.name, emojiFace(one.emoji), { label: one.name }))}
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
      onQuery={(next) => {
        setOpened(undefined);
        setQuery(next);
      }}
      legend={kind === FACE_KIND.CHARACTERS ? "Characters" : "Emoji"}
      panel={{ id: panelId, labelledBy: `${panelId}-${kind}` }}
      bar={
        <ChoiceBar<FaceKind>
          label="Face kind"
          items={[
            { value: FACE_KIND.CHARACTERS, label: "Characters" },
            { value: FACE_KIND.EMOJI, label: "Emoji" },
          ]}
          value={kind}
          onChange={(next) => {
            setOpened(undefined);
            setKind(next);
          }}
          look={CHOICE_BAR_LOOK.SEGMENTED}
          panels={(each) => ({ tab: `${panelId}-${each}`, panel: panelId })}
        />
      }
    >
      {body}
    </IconPicker>
  );
}
