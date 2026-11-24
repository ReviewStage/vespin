// manager-face-look.ts -- which picture of the asset catalog a Manager's face is, at rest or at work.

import type { ManagerFace } from "@repo/features/manager-face";

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
