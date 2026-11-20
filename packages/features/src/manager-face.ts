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
 * desktop its Managers, drawn in a face it can draw.
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
} as const;

export type ManagerFaceColor = (typeof MANAGER_FACE_COLOR)[keyof typeof MANAGER_FACE_COLOR];

/** A Manager's face: its character and the color it is drawn in. */
export interface ManagerFace {
  readonly character: ManagerFaceCharacter;
  readonly color: ManagerFaceColor;
}

/** A Manager's face as the agent's row keeps it and every read carries it. */
export const managerFaceSchema = EffectSchema.Struct({
  character: literalsReadingUnknown(
    Object.values(MANAGER_FACE_CHARACTER),
    MANAGER_FACE_CHARACTER.GHOST,
  ),
  color: literalsReadingUnknown(Object.values(MANAGER_FACE_COLOR), MANAGER_FACE_COLOR.YELLOW),
});
