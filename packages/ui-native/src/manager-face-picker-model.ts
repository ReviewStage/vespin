// manager-face-picker-model.ts -- what the face picker offers on iOS: its tabs, Recent, the characters, every emoji by category, what a search finds, and each face's menu of colors.

import type { EmojiGroup } from "@repo/features/emoji-model";
import { findEmoji } from "@repo/features/emoji-model";
import { emojiSchema } from "@repo/features/emoji-wire";
import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_CHARACTER_NAME,
  MANAGER_FACE_COLOR,
  MANAGER_FACE_COLOR_NAME,
  MANAGER_FACE_PICK_COLORS,
  type ManagerFace,
  type ManagerFaceCharacter,
  type ManagerFaceColor,
  managerFaceName,
  sameManagerFace,
} from "@repo/features/manager-face";
import { matchesTokens, searchTokens } from "@repo/features/search-tokens";
import { Schema } from "effect";
import { CHOICE_MARK, type ChoiceMark } from "./row-menu-model.js";

/** The picker's two tabs, as the panel's face picker names them. */
export const FACE_TAB = {
  CHARACTERS: "characters",
  EMOJI: "emoji",
} as const;

export type FaceTab = (typeof FACE_TAB)[keyof typeof FACE_TAB];

/** The picker's words, the panel's own. */
export const FACE_PICKER_WORDS = {
  CHARACTERS: "Characters",
  EMOJI: "Emoji",
  RECENT: "Recent",
} as const;

/** How many faces Recent offers, as the section icon picker's Recent does. */
export const RECENT_FACES_MOST = 12;

/** The colors a face's menu offers, gray first, then a section icon's colors in their order. */
const MENU_COLORS: readonly ManagerFaceColor[] = [
  MANAGER_FACE_COLOR.GRAY,
  ...MANAGER_FACE_PICK_COLORS.filter((color) => color !== MANAGER_FACE_COLOR.GRAY),
];

/** The color a face is drawn in while it is neither the one chosen nor a recent one, as the panel draws the grid in its quiet ink. */
const QUIET_COLOR = MANAGER_FACE_COLOR.GRAY;

/** Whether a text is one emoji, as a face may wear it. */
const isEmoji = Schema.is(emojiSchema);

/** One color of a face's menu: its name, the face in it, and whether it is the face standing. */
type FaceColorChoice = {
  readonly label: string;
  readonly mark: ChoiceMark;
  readonly on: boolean;
  /** What VoiceOver calls it, the face's whole name ("Red cat"). */
  readonly heard: string;
  readonly face: ManagerFace;
};

/**
 * One face of the grid: what tells it apart, its character or its emoji,
 * which a press hands back; its name; the face as drawn, in its color;
 * whether an emoji stands on its color's disc, as the face standing and a
 * recent one do, rather than alone; whether it is the face standing,
 * whatever its color; and its menu of colors.
 */
export type FaceCell = {
  readonly key: string;
  readonly label: string;
  readonly face: ManagerFace;
  readonly disc: boolean;
  readonly picked: boolean;
  readonly colors: readonly FaceColorChoice[];
};

/** A named group of the grid's faces. */
export type FaceGroup = {
  readonly key: string;
  readonly name: string;
  readonly cells: readonly FaceCell[];
};

/** What the picker draws from: the tab chosen, the search's words, the faces picked last, the face standing, and every emoji once loaded. */
export type FacePickerState = {
  readonly tab: FaceTab;
  readonly query: string;
  readonly recent: readonly ManagerFace[];
  readonly standing: ManagerFace | undefined;
  /** Every emoji by category (`@repo/features/emoji-model`'s `emojiGroups`); none while it loads. */
  readonly emoji: readonly EmojiGroup[] | undefined;
};

/** Whether two faces are one choice of the grid whatever their colors: the same emoji, or the same character wearing none. */
function sameLook(one: ManagerFace | undefined, other: ManagerFace): boolean {
  if (one === undefined) return false;

  if (one.emoji !== undefined || other.emoji !== undefined) return one.emoji === other.emoji;

  return one.character === other.character;
}

/** What tells a choice of the grid apart, whatever its color: its emoji, or its character's word, which never spells an emoji. */
function lookKey(face: ManagerFace): string {
  return face.emoji ?? face.character;
}

/** A face as an emoji, worn over the standing face's character, which a build before the emoji draws, or the first character where none stands. */
function emojiFace(emoji: string, color: ManagerFaceColor, standing: ManagerFace | undefined) {
  return {
    character: standing?.character ?? MANAGER_FACE_CHARACTER.GHOST,
    color,
    emoji,
  };
}

/** The menu of colors a face is picked in: each color by its name, led by the face in it, the face standing checked. */
function faceColorChoices(
  face: ManagerFace,
  standing: ManagerFace | undefined,
): readonly FaceColorChoice[] {
  return MENU_COLORS.map((color) => {
    const each = { ...face, color };

    return {
      label: MANAGER_FACE_COLOR_NAME[color],
      mark: { kind: CHOICE_MARK.MANAGER, face: each },
      on: sameManagerFace(standing, each),
      heard: managerFaceName(each),
      face: each,
    };
  });
}

/** A face as the grid draws it: in its color, an emoji on its disc where `disc`, named by its character or its emoji, its menu checking the face standing. */
function cell(face: ManagerFace, standing: ManagerFace | undefined, disc: boolean): FaceCell {
  return {
    key: lookKey(face),
    label: face.emoji ?? MANAGER_FACE_CHARACTER_NAME[face.character],
    face,
    disc: disc && face.emoji !== undefined,
    picked: sameLook(standing, face),
    colors: faceColorChoices(face, standing),
  };
}

/** A character as the grid draws it: in the standing face's color where it is the face standing, and quiet otherwise. */
function characterCell(character: ManagerFaceCharacter, standing: ManagerFace | undefined) {
  const face = { character, color: QUIET_COLOR };

  return cell(sameLook(standing, face) && standing ? standing : face, standing, false);
}

/** An emoji as the grid draws it: on its disc in the standing face's color where it is the face standing, and alone otherwise, which the grid draws with no disc. */
function emojiCell(emoji: string, standing: ManagerFace | undefined): FaceCell {
  const face = emojiFace(emoji, QUIET_COLOR, standing);
  const picked = sameLook(standing, face) && standing !== undefined;

  return cell(picked ? standing : face, standing, picked);
}

/** The characters whose name holds every word of `tokens`. */
function charactersFound(tokens: readonly string[]): readonly ManagerFaceCharacter[] {
  return Object.values(MANAGER_FACE_CHARACTER).filter((character) =>
    matchesTokens([MANAGER_FACE_CHARACTER_NAME[character]], tokens),
  );
}

/** What a search finds: the characters whose name holds its words, then the emoji, one typed into it first, then those whose name holds its words, each under its kind. */
function foundGroups(state: FacePickerState): readonly FaceGroup[] {
  const tokens = searchTokens(state.query);
  const typed = state.query.trim();
  const typedOne = isEmoji(typed) ? [typed] : [];

  const named = findEmoji(state.emoji ?? [], state.query)
    .map((one) => one.emoji)
    .filter((one) => one !== typed);

  const characters = charactersFound(tokens).map((one) => characterCell(one, state.standing));
  const emoji = [...typedOne, ...named].map((one) => emojiCell(one, state.standing));

  return [
    { key: FACE_TAB.CHARACTERS, name: FACE_PICKER_WORDS.CHARACTERS, cells: characters },
    { key: FACE_TAB.EMOJI, name: FACE_PICKER_WORDS.EMOJI, cells: emoji },
  ].filter((group) => group.cells.length > 0);
}

/** The faces picked last once `chosen` is: it first, in the color it was chosen in, then the rest as they stood with none the same choice, at most `RECENT_FACES_MOST`. */
export function recentFaces(recent: readonly ManagerFace[], chosen: ManagerFace): ManagerFace[] {
  return [chosen, ...recent.filter((one) => !sameLook(one, chosen))].slice(0, RECENT_FACES_MOST);
}

/**
 * The grid's groups, as the panel's face picker lists them. A search finds
 * characters and emoji alike, each under its kind. With nothing searched,
 * Characters offers Recent, each face in the color it was chosen in, then
 * the six characters, the one standing in its color and the rest quiet;
 * Emoji offers every emoji by category, none while they load.
 */
export function faceGroups(state: FacePickerState): readonly FaceGroup[] {
  if (searchTokens(state.query).length > 0) return foundGroups(state);

  if (state.tab === FACE_TAB.EMOJI)
    return (state.emoji ?? []).map((group) => ({
      key: group.name,
      name: group.name,
      cells: group.emojis.map((one) => emojiCell(one.emoji, state.standing)),
    }));

  const recent = state.recent.map((face) => cell(face, state.standing, true));

  const characters = Object.values(MANAGER_FACE_CHARACTER).map((one) =>
    characterCell(one, state.standing),
  );

  return [
    { key: FACE_PICKER_WORDS.RECENT, name: FACE_PICKER_WORDS.RECENT, cells: recent },
    { key: FACE_TAB.CHARACTERS, name: FACE_PICKER_WORDS.CHARACTERS, cells: characters },
  ].filter((group) => group.cells.length > 0);
}

/** The tab a picker opens on: Emoji while the face standing wears one, Characters otherwise. */
export function openingTab(standing: ManagerFace | undefined): FaceTab {
  return standing?.emoji === undefined ? FACE_TAB.CHARACTERS : FACE_TAB.EMOJI;
}
