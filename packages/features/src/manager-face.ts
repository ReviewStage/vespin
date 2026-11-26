/**
 * manager-face.ts -- the friendly face a Manager wears: one of a few React Kawaii characters, or one emoji, in one of a few soft colors.
 *
 * A face is a pair of values, a character and a color, each from a fixed set,
 * so the service stores two short words and every client draws the same face
 * from them (`@repo/ui`'s `ManagerFace`), and it may wear one emoji in the
 * character's place, checked as a section's emoji is (`emoji-wire.ts`). The
 * words are stored values: a character or a color may be added, but one
 * already stored keeps its spelling, and one no longer offered (`peach`)
 * still reads. The characters are those of React Kawaii's set whose face still
 * reads at a sidebar row's 20px on the dark theme: a big, flat body with the
 * face in its middle, never a small figure or a split one.
 *
 * The service picks a new Manager's face and keeps it on the agent's row,
 * and every read carries it as `managerFaceSchema` decodes it: a word this
 * build does not know reads as the set's first, so a service that offers
 * one more character or color than a desktop knows still answers that
 * desktop its Managers, drawn in a face it can draw. A face a member picks
 * travels as `managerFacePickSchema`, which takes only the words it names,
 * so a pick is stored as it was asked or refused. Note that a build before
 * the emoji reads a face that wears one as its character, since a decode
 * leaves out a key its schema does not name.
 */

import { literalsReadingUnknown } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { emojiSchema } from "./emoji-wire.js";

/** Which character a Manager's face is. */
export const MANAGER_FACE_CHARACTER = {
  GHOST: "ghost",
  PLANET: "planet",
  CAT: "cat",
  BACKPACK: "backpack",
  MUG: "mug",
  SPEECH_BUBBLE: "speech-bubble",
} as const;

export type ManagerFaceCharacter =
  (typeof MANAGER_FACE_CHARACTER)[keyof typeof MANAGER_FACE_CHARACTER];

/** Which soft color a Manager's face is drawn in. */
export const MANAGER_FACE_COLOR = {
  YELLOW: "yellow",
  GREEN: "green",
  BLUE: "blue",
  PINK: "pink",
  PURPLE: "purple",
  PEACH: "peach",
  RED: "red",
  ORANGE: "orange",
  TEAL: "teal",
  GRAY: "gray",
} as const;

export type ManagerFaceColor = (typeof MANAGER_FACE_COLOR)[keyof typeof MANAGER_FACE_COLOR];

/** The colors a face is given in, a section icon's colors in their order; `peach` is no longer one, though a face stored in it still reads. */
export const MANAGER_FACE_PICK_COLORS = [
  MANAGER_FACE_COLOR.RED,
  MANAGER_FACE_COLOR.ORANGE,
  MANAGER_FACE_COLOR.YELLOW,
  MANAGER_FACE_COLOR.GREEN,
  MANAGER_FACE_COLOR.TEAL,
  MANAGER_FACE_COLOR.BLUE,
  MANAGER_FACE_COLOR.PURPLE,
  MANAGER_FACE_COLOR.PINK,
  MANAGER_FACE_COLOR.GRAY,
] as const satisfies readonly ManagerFaceColor[];

/** What each character is called, as a face is named to a reader who cannot see it. */
export const MANAGER_FACE_CHARACTER_NAME = {
  [MANAGER_FACE_CHARACTER.GHOST]: "Ghost",
  [MANAGER_FACE_CHARACTER.PLANET]: "Planet",
  [MANAGER_FACE_CHARACTER.CAT]: "Cat",
  [MANAGER_FACE_CHARACTER.BACKPACK]: "Backpack",
  [MANAGER_FACE_CHARACTER.MUG]: "Mug",
  [MANAGER_FACE_CHARACTER.SPEECH_BUBBLE]: "Speech bubble",
} as const satisfies Record<ManagerFaceCharacter, string>;

/** What each color is called, as a face is named. */
export const MANAGER_FACE_COLOR_NAME = {
  [MANAGER_FACE_COLOR.YELLOW]: "Yellow",
  [MANAGER_FACE_COLOR.GREEN]: "Green",
  [MANAGER_FACE_COLOR.BLUE]: "Blue",
  [MANAGER_FACE_COLOR.PINK]: "Pink",
  [MANAGER_FACE_COLOR.PURPLE]: "Purple",
  [MANAGER_FACE_COLOR.PEACH]: "Peach",
  [MANAGER_FACE_COLOR.RED]: "Red",
  [MANAGER_FACE_COLOR.ORANGE]: "Orange",
  [MANAGER_FACE_COLOR.TEAL]: "Teal",
  [MANAGER_FACE_COLOR.GRAY]: "Gray",
} as const satisfies Record<ManagerFaceColor, string>;

/** A Manager's face: its character and the color it is drawn in, and the emoji it wears in the character's place, if any. */
export interface ManagerFace {
  readonly character: ManagerFaceCharacter;
  readonly color: ManagerFaceColor;
  readonly emoji?: string;
}

/** A Manager's face as the agent's row keeps it and every read carries it. */
export const managerFaceSchema = EffectSchema.Struct({
  character: literalsReadingUnknown(
    Object.values(MANAGER_FACE_CHARACTER),
    MANAGER_FACE_CHARACTER.GHOST,
  ),
  color: literalsReadingUnknown(Object.values(MANAGER_FACE_COLOR), MANAGER_FACE_COLOR.YELLOW),
  emoji: EffectSchema.optionalKey(emojiSchema),
});

/** A face a member picks, at New Manager or in a Manager's Settings: a character and a color this build names, and one emoji or none, refused otherwise. */
export const managerFacePickSchema = EffectSchema.Struct({
  character: EffectSchema.Literals(Object.values(MANAGER_FACE_CHARACTER)),
  color: EffectSchema.Literals(Object.values(MANAGER_FACE_COLOR)),
  emoji: EffectSchema.optionalKey(emojiSchema),
});

/** What a face is called, its color then its character, "Purple cat", or its emoji, "Purple 🚀", as every picker names it, since a face says nothing to a reader who cannot see it. */
export function managerFaceName(face: ManagerFace): string {
  const color = MANAGER_FACE_COLOR_NAME[face.color];

  if (face.emoji !== undefined) return `${color} ${face.emoji}`;

  return `${color} ${MANAGER_FACE_CHARACTER_NAME[face.character].toLowerCase()}`;
}

/** Every face a Manager may wear, character by character, each in every color a face is given in, in the order every picker lists them. */
export const MANAGER_FACES: readonly ManagerFace[] = Object.values(MANAGER_FACE_CHARACTER).flatMap(
  (character) => MANAGER_FACE_PICK_COLORS.map((color) => ({ character, color })),
);

/** The faces whose name holds every word of `query`, whatever its case, in the pickers' order: "purple", "cat", "purple cat". */
export function managerFacesFound(query: string): readonly ManagerFace[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");

  return MANAGER_FACES.filter((face) => {
    const name = managerFaceName(face).toLowerCase();

    return words.every((word) => name.includes(word));
  });
}

/** What a client says where a change of a Manager's face did not take. */
export const MANAGER_FACE_FAILED = "Couldn't change the Manager's face.";
