// manager-face-look.ts -- which picture of the asset catalog a Manager's face is, at rest or at work, and the Change face menu that picks one.

import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_CHARACTER_NAME,
  MANAGER_FACE_COLOR,
  type ManagerFace,
  managerFaceName,
} from "@repo/features/manager-face";
import { GLYPH } from "./glyph.js";
import type { RowSubmenu } from "./row-menu-model.js";

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

/** What a Manager's menu calls the submenu its face is picked in, the panel's own words. */
const CHANGE_FACE = "Change face";

/**
 * Change face ›, a Manager's face picked from its row's long press menu as
 * the panel's Change face › picks it: a submenu to each character, led by
 * that character in the face's color, holding the character in each color,
 * each led by itself and named as the panel names it ("Purple cat"), the
 * face standing checked. A pick hands the face to `onPick`.
 */
export function managerFaceMenu(
  face: ManagerFace,
  onPick: (face: ManagerFace) => void,
): RowSubmenu {
  return {
    label: CHANGE_FACE,
    symbol: GLYPH.CHANGE_FACE,
    submenus: Object.values(MANAGER_FACE_CHARACTER).map((character) => ({
      label: MANAGER_FACE_CHARACTER_NAME[character],
      symbol: GLYPH.CHANGE_FACE,
      picture: managerFaceAsset({ character, color: face.color }, false),
      choices: Object.values(MANAGER_FACE_COLOR).map((color) => {
        const each = { character, color };

        return {
          label: managerFaceName(each),
          picture: managerFaceAsset(each, false),
          on: face.character === character && face.color === color,
          onPress: () => onPick(each),
        };
      }),
    })),
    choices: [],
  };
}
