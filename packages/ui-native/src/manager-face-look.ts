// manager-face-look.ts -- how a Manager's face is drawn: which picture of the asset catalog a character is, at rest or at work, and the disc an emoji stands on.

import type { ManagerFace } from "@repo/features/manager-face";
import { BRAND_COLOR } from "./tokens/brand-colors.js";
import { MANAGER_FACE_FILL } from "./tokens/manager-face-fills.js";

/**
 * Whether a face stands at rest or at work, the word its picture's name
 * carries: `@repo/ui`'s `ManagerFace` smiles at rest and turns excited while
 * its Manager works, and `scripts/native-manager-faces.ts` writes each
 * character in both moods under these words.
 */
const MANAGER_FACE_STATE = {
  REST: "rest",
  WORKING: "working",
} as const;

/** The catalog's folder the faces stand in (`apps/mobile/app.config.ts`'s `MANAGER_FACES_FOLDER`). */
const MANAGER_FACES_FOLDER = "ManagerFaces";

/**
 * The asset catalog's name for `face`, livelier while `working`: one vector
 * picture per character, mood and color, its body filled in the color's
 * light and dark fills, which the app's config writes, so a face costs one
 * image the system draws and caches, wherever it stands.
 */
export function managerFaceAsset(face: ManagerFace, working: boolean): string {
  const state = working ? MANAGER_FACE_STATE.WORKING : MANAGER_FACE_STATE.REST;

  return `${MANAGER_FACES_FOLDER}/${face.character}-${state}-${face.color}`;
}

/** How much of an emoji face's disc its emoji fills, wherever one is drawn. */
export const MANAGER_FACE_EMOJI_SCALE = 0.62;

/** The disc an emoji face stands on: the fill of its color in the theme's shade, the one a character's body is filled with (`MANAGER_FACE_FILL`). */
export function managerFaceFill(face: ManagerFace, dark: boolean): string {
  const fill = MANAGER_FACE_FILL[face.color];

  return dark ? fill.DARK : fill.LIGHT;
}

/** How thick an emoji face's hairline stands, in points, as the panel's 0.5 px edge. */
export const MANAGER_FACE_EDGE_WIDTH = 0.5;

/** The hairline an emoji face's disc wears: the strong edge's ink in the light, so a pale fill holds its edge on the white ground, as the panel's face draws `--ui-color-border-strong`; none in the dark, where every fill already stands off the ground. */
export function managerFaceEdge(dark: boolean): string | undefined {
  return dark ? undefined : BRAND_COLOR.LIGHT.CHIP_EDGE_STRONG;
}
