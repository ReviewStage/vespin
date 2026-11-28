// manager-face-menu.ts -- the Change face menu a Manager's face is picked in, each face led by itself.

import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_CHARACTER_NAME,
  MANAGER_FACE_PICK_COLORS,
  type ManagerFace,
  managerFaceName,
} from "@repo/features/manager-face";
import { GLYPH } from "./glyph.js";
import { managerFaceAsset } from "./manager-face-look.js";
import { CHOICE_MARK, type RowSubmenu } from "./row-menu-model.js";

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
      choices: MANAGER_FACE_PICK_COLORS.map((color) => {
        const each = { character, color };

        return {
          label: managerFaceName(each),
          mark: { kind: CHOICE_MARK.MANAGER, face: each },
          on: face.character === character && face.color === color,
          onPress: () => onPick(each),
        };
      }),
    })),
    choices: [],
  };
}
