/**
 * manager-face.ts -- the friendly face a Manager wears: one of a few React Kawaii characters, in one of a few soft colors.
 *
 * A face is a pair of values, a character and a color, each from a fixed set,
 * so the service stores two short words and every client draws the same face
 * from them (`@repo/ui`'s `ManagerFace`). The words are stored values: a
 * character or a color may be added, but one already stored keeps its
 * spelling. The characters are those of React Kawaii's set whose face still
 * reads at a sidebar row's 20px on the dark theme: a big, flat body with the
 * face in its middle, never a small figure or a split one.
 *
 * The service picks a new Manager's face and keeps it on the agent's row,
 * and every read carries it as `managerFaceSchema` decodes it: a word this
 * build does not know reads as the set's first, so a service that offers
 * one more character or color than a desktop knows still answers that
 * desktop its Managers, drawn in a face it can draw. A face a member picks
 * travels as `managerFacePickSchema`, which takes only the words it names,
 * so a pick is stored as it was asked or refused.
 */

import { literalsReadingUnknown } from "@repo/wire";
import { Schema as EffectSchema } from "effect";

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
  // PROTOTYPE: a wider palette, twelve more soft colors that still hold Kawaii's near-black features.
  CORAL: "coral",
  TANGERINE: "tangerine",
  LEMON: "lemon",
  LIME: "lime",
  MINT: "mint",
  TEAL: "teal",
  PERIWINKLE: "periwinkle",
  LAVENDER: "lavender",
  ROSE: "rose",
  SAND: "sand",
  COCOA: "cocoa",
  CLOUD: "cloud",
} as const;

export type ManagerFaceColor = (typeof MANAGER_FACE_COLOR)[keyof typeof MANAGER_FACE_COLOR];

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
  [MANAGER_FACE_COLOR.CORAL]: "Coral",
  [MANAGER_FACE_COLOR.TANGERINE]: "Tangerine",
  [MANAGER_FACE_COLOR.LEMON]: "Lemon",
  [MANAGER_FACE_COLOR.LIME]: "Lime",
  [MANAGER_FACE_COLOR.MINT]: "Mint",
  [MANAGER_FACE_COLOR.TEAL]: "Teal",
  [MANAGER_FACE_COLOR.PERIWINKLE]: "Periwinkle",
  [MANAGER_FACE_COLOR.LAVENDER]: "Lavender",
  [MANAGER_FACE_COLOR.ROSE]: "Rose",
  [MANAGER_FACE_COLOR.SAND]: "Sand",
  [MANAGER_FACE_COLOR.COCOA]: "Cocoa",
  [MANAGER_FACE_COLOR.CLOUD]: "Cloud",
} as const satisfies Record<ManagerFaceColor, string>;

/** A Manager's face: its character and the color it is drawn in. */
export interface ManagerFace {
  readonly character: ManagerFaceCharacter;
  readonly color: ManagerFaceColor;
  /** PROTOTYPE: an emoji the face wears in its character's place, where the direction draws one. */
  readonly emoji?: string | undefined;
}

/** A Manager's face as the agent's row keeps it and every read carries it. */
export const managerFaceSchema = EffectSchema.Struct({
  character: literalsReadingUnknown(
    Object.values(MANAGER_FACE_CHARACTER),
    MANAGER_FACE_CHARACTER.GHOST,
  ),
  color: literalsReadingUnknown(Object.values(MANAGER_FACE_COLOR), MANAGER_FACE_COLOR.YELLOW),
  emoji: EffectSchema.optionalKey(EffectSchema.String),
});

/** A face a member picks, at New Manager or in a Manager's Settings: a character and a color this build names, refused otherwise. */
export const managerFacePickSchema = EffectSchema.Struct({
  character: EffectSchema.Literals(Object.values(MANAGER_FACE_CHARACTER)),
  color: EffectSchema.Literals(Object.values(MANAGER_FACE_COLOR)),
  emoji: EffectSchema.optionalKey(EffectSchema.String),
});

/** What a face is called, its color then its character, "Purple cat", as every picker names it, since a face says nothing to a reader who cannot see it. */
export function managerFaceName(face: ManagerFace): string {
  if (face.emoji !== undefined) return `${MANAGER_FACE_COLOR_NAME[face.color]} ${face.emoji}`;
  return `${MANAGER_FACE_COLOR_NAME[face.color]} ${MANAGER_FACE_CHARACTER_NAME[face.character].toLowerCase()}`;
}

/** Every face a Manager may wear, character by character, each in every color, in the order every picker lists them. */
export const MANAGER_FACES: readonly ManagerFace[] = Object.values(MANAGER_FACE_CHARACTER).flatMap(
  (character) => Object.values(MANAGER_FACE_COLOR).map((color) => ({ character, color })),
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
