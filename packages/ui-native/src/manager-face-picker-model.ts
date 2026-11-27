// manager-face-picker-model.ts -- what the face picker offers on iOS: its tabs, its row of colors, Recent, the characters, every emoji by category, and what a search finds.

import type { EmojiGroup } from "@repo/features/emoji-model";
import { findEmoji } from "@repo/features/emoji-model";
import { emojiSchema } from "@repo/features/emoji-wire";
import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_CHARACTER_NAME,
  MANAGER_FACE_COLOR,
  MANAGER_FACE_PICK_COLORS,
  type ManagerFace,
  type ManagerFaceCharacter,
  type ManagerFaceColor,
} from "@repo/features/manager-face";
import { matchesTokens, searchTokens } from "@repo/features/search-tokens";
import { Schema } from "effect";

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

/** The colors the sheet's color row offers, gray first, then a section icon's colors in their order. */
export const FACE_COLORS: readonly ManagerFaceColor[] = [
  MANAGER_FACE_COLOR.GRAY,
  ...MANAGER_FACE_PICK_COLORS.filter((color) => color !== MANAGER_FACE_COLOR.GRAY),
];

/** The color the row opens on where no face stands yet, as at New Manager before a pick. */
export const OPENING_COLOR = MANAGER_FACE_COLOR.GRAY;

/** Whether a text is one emoji, as a face may wear it. */
const isEmoji = Schema.is(emojiSchema);

/**
 * One face of the grid: what tells it apart, its character or its emoji;
 * its name; the face a press picks, a recent one in the color it was
 * picked in and any other in the row's color; whether an emoji stands on
 * its color's disc, as a recent one does, rather than alone; and whether
 * it is the face the preview shows, whatever its color.
 */
export type FaceCell = {
  readonly key: string;
  readonly label: string;
  readonly face: ManagerFace;
  readonly disc: boolean;
  readonly picked: boolean;
};

/** A named group of the grid's faces. */
export type FaceGroup = {
  readonly key: string;
  readonly name: string;
  readonly cells: readonly FaceCell[];
};

/** What the picker draws from: the tab chosen, the search's words, the faces picked last, the face the preview shows, the row's color, and every emoji once loaded. */
export type FacePickerState = {
  readonly tab: FaceTab;
  readonly query: string;
  readonly recent: readonly ManagerFace[];
  /** The face the preview shows, picked in the sheet or standing as it opened; none before a pick at New Manager. */
  readonly standing: ManagerFace | undefined;
  /** The color row's color, which every face but a recent one is drawn and picked in. */
  readonly color: ManagerFaceColor;
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

/** A face as the grid draws it: an emoji on its disc where `disc`, named by its character or its emoji, picked where the preview shows it. */
function cell(face: ManagerFace, standing: ManagerFace | undefined, disc: boolean): FaceCell {
  return {
    key: lookKey(face),
    label: face.emoji ?? MANAGER_FACE_CHARACTER_NAME[face.character],
    face,
    disc: disc && face.emoji !== undefined,
    picked: sameLook(standing, face),
  };
}

/** A character as the grid draws it, in the row's color. */
function characterCell(character: ManagerFaceCharacter, state: FacePickerState): FaceCell {
  return cell({ character, color: state.color }, state.standing, false);
}

/** An emoji as the grid draws it, alone, picked in the row's color. */
function emojiCell(emoji: string, state: FacePickerState): FaceCell {
  return cell(emojiFace(emoji, state.color, state.standing), state.standing, false);
}

/** Recent, each face in the color it was picked in, on its disc where it wears an emoji. */
function recentGroup(state: FacePickerState): readonly FaceGroup[] {
  const cells = state.recent.map((face) => cell(face, state.standing, true));

  return cells.length === 0
    ? []
    : [{ key: FACE_PICKER_WORDS.RECENT, name: FACE_PICKER_WORDS.RECENT, cells }];
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

  const characters = charactersFound(tokens).map((one) => characterCell(one, state));
  const emoji = [...typedOne, ...named].map((one) => emojiCell(one, state));

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
 * each tab offers Recent first, each face in the color it was picked in;
 * then Characters offers the six characters and Emoji every emoji by
 * category, none while they load, each in the row's color.
 */
export function faceGroups(state: FacePickerState): readonly FaceGroup[] {
  if (searchTokens(state.query).length > 0) return foundGroups(state);

  if (state.tab === FACE_TAB.EMOJI)
    return [
      ...recentGroup(state),
      ...(state.emoji ?? []).map((group) => ({
        key: group.name,
        name: group.name,
        cells: group.emojis.map((one) => emojiCell(one.emoji, state)),
      })),
    ];

  const characters = Object.values(MANAGER_FACE_CHARACTER).map((one) => characterCell(one, state));

  return [
    ...recentGroup(state),
    { key: FACE_TAB.CHARACTERS, name: FACE_PICKER_WORDS.CHARACTERS, cells: characters },
  ];
}

/** The tab a picker opens on: Emoji while the face standing wears one, Characters otherwise. */
export function openingTab(standing: ManagerFace | undefined): FaceTab {
  return standing?.emoji === undefined ? FACE_TAB.CHARACTERS : FACE_TAB.EMOJI;
}
