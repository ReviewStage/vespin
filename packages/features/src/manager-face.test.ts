// manager-face.test.ts -- two faces are one only where their character, color, and emoji all are.

import { describe, expect, it } from "vitest";
import { type ManagerFace, sameManagerFace } from "./manager-face.js";

const CAT: ManagerFace = { character: "cat", color: "blue" };

describe("sameManagerFace", () => {
  // Note that the regression this catches is a pick that changes the emoji alone being taken for no change, and dropped.
  it.each([
    { case: "the same face", one: CAT, other: { ...CAT }, same: true },
    { case: "an emoji put on", one: CAT, other: { ...CAT, emoji: "🦊" }, same: false },
    {
      case: "the emoji alone changed",
      one: { ...CAT, emoji: "🦊" },
      other: { ...CAT, emoji: "🚀" },
      same: false,
    },
    { case: "another color", one: CAT, other: { ...CAT, color: "red" }, same: false },
    { case: "none standing", one: undefined, other: CAT, same: false },
  ] satisfies readonly {
    case: string;
    one: ManagerFace | undefined;
    other: ManagerFace;
    same: boolean;
  }[])("$case", ({ one, other, same }) => {
    expect(sameManagerFace(one, other)).toBe(same);
  });
});
