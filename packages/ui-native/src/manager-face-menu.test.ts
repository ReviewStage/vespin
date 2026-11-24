// manager-face-menu.test.ts -- Change face › checks the face a Manager wears and picks the face pressed, under the character it is.

import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace,
} from "@repo/features/manager-face";
import { describe, expect, it } from "vitest";
import { managerFaceMenu } from "./manager-face-menu.js";

const WORN = { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.BLUE };

describe("managerFaceMenu", () => {
  // Note that the regression this catches is a pick that sends another face than the one its words name, or a menu that checks a face the Manager does not wear.
  it("checks the face worn alone and picks the face pressed", () => {
    const picked: ManagerFace[] = [];
    const menu = managerFaceMenu(WORN, (face) => picked.push(face));

    const checked = (menu.submenus ?? []).flatMap((each) =>
      each.choices.filter((choice) => choice.on).map((choice) => choice.label),
    );

    expect(checked).toEqual(["Blue planet"]);

    const cat = menu.submenus?.find((each) => each.label === "Cat");
    cat?.choices.find((choice) => choice.label === "Pink cat")?.onPress();

    expect(picked).toEqual([{ character: "cat", color: "pink" }]);
  });
});
