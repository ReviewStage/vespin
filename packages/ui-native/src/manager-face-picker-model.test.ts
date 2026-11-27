// manager-face-picker-model.test.ts -- the face picker offers Recent atop each tab, draws and picks every face but a recent one in the color row's color, and finds a character or an emoji by name.

import { emojiGroups } from "@repo/features/emoji-model";
import type { ManagerFace } from "@repo/features/manager-face";
import { describe, expect, it } from "vitest";
import {
  FACE_TAB,
  type FacePickerState,
  faceGroups,
  RECENT_FACES_MOST,
  recentFaces,
} from "./manager-face-picker-model.js";

const EMOJI = emojiGroups([
  {
    name: "Animals & Nature",
    emojis: [
      { emoji: "🦊", name: "fox", version: 3, keywords: ["fox"], shortcodes: ["fox_face"] },
      { emoji: "🐱", name: "cat face", version: 0.6, keywords: ["cat"], shortcodes: ["cat"] },
    ],
  },
  {
    name: "Travel & Places",
    emojis: [
      { emoji: "🚀", name: "rocket", version: 0.6, keywords: ["space"], shortcodes: ["rocket"] },
    ],
  },
]);

const STANDING: ManagerFace = { character: "planet", color: "blue" };

const STATE: FacePickerState = {
  tab: FACE_TAB.CHARACTERS,
  query: "",
  recent: [],
  standing: STANDING,
  color: "blue",
  emoji: EMOJI,
};

/** Each group's name and its cells' names, as the grid lists them. */
function listed(state: FacePickerState) {
  return faceGroups(state).map((group) => [group.name, group.cells.map((cell) => cell.label)]);
}

describe("faceGroups", () => {
  // Note that the regression this catches is a grid that loses Recent, draws a recent face in the row's color rather than its own, draws a character in another color than the row's, rings another face than the preview's, or lists the characters in another order than the panel's.
  it("offers Recent in its own colors, then the characters in the row's color, the one shown ringed", () => {
    const recent: ManagerFace[] = [{ character: "cat", color: "red", emoji: "🚀" }];
    const groups = faceGroups({ ...STATE, recent, color: "teal" });

    expect(groups.map((group) => [group.name, group.cells.map((cell) => cell.label)])).toEqual([
      ["Recent", ["🚀"]],
      ["Characters", ["Ghost", "Planet", "Cat", "Backpack", "Mug", "Speech bubble"]],
    ]);
    expect(groups[0]?.cells[0]).toMatchObject({ face: recent[0], disc: true, picked: false });
    expect(groups[1]?.cells.map((cell) => [cell.face.color, cell.picked])).toEqual([
      ["teal", false],
      ["teal", true],
      ["teal", false],
      ["teal", false],
      ["teal", false],
      ["teal", false],
    ]);
    expect(groups[1]?.cells[2]?.face).toEqual({ character: "cat", color: "teal" });
  });

  // Note that the regression this catches is a search that finds no emoji by its name, drops a typed emoji, or stops finding a character.
  it.each([
    { query: "fox", found: [["Emoji", ["🦊"]]] },
    {
      query: "cat",
      found: [
        ["Characters", ["Cat"]],
        ["Emoji", ["🐱"]],
      ],
    },
    { query: "🦄", found: [["Emoji", ["🦄"]]] },
    { query: "zebra", found: [] },
  ])("finds $query", ({ query, found }) => {
    expect(listed({ ...STATE, query })).toEqual(found);
  });

  // Note that the regression this catches is an Emoji tab without Recent atop it, an emoji picked in another color than the row's, or an emoji lost from the face it is worn over.
  it("offers Recent, then every emoji by category on the Emoji tab, each in the row's color", () => {
    const recent: ManagerFace[] = [{ character: "mug", color: "green" }];
    const standing = { character: "planet", color: "teal", emoji: "🚀" } as const;
    const groups = faceGroups({ ...STATE, tab: FACE_TAB.EMOJI, recent, standing, color: "pink" });

    expect(groups.map((group) => [group.name, group.cells.map((cell) => cell.label)])).toEqual([
      ["Recent", ["Mug"]],
      ["Animals & Nature", ["🦊", "🐱"]],
      ["Travel & Places", ["🚀"]],
    ]);
    expect(groups[2]?.cells[0]).toMatchObject({ picked: true, disc: false });
    expect(groups[1]?.cells[0]).toMatchObject({
      face: { character: "planet", color: "pink", emoji: "🦊" },
      picked: false,
    });
  });
});

describe("recentFaces", () => {
  // Note that the regression this catches is Recent listing one face twice, in its old color and its new, or growing without end.
  it("puts the face picked first, once, in its color, and keeps at most the most", () => {
    const older: ManagerFace[] = [
      { character: "cat", color: "blue" },
      { character: "ghost", color: "gray", emoji: "🦊" },
    ];

    expect(recentFaces(older, { character: "ghost", color: "red", emoji: "🦊" })).toEqual([
      { character: "ghost", color: "red", emoji: "🦊" },
      { character: "cat", color: "blue" },
    ]);

    const many = Array.from({ length: RECENT_FACES_MOST }, (_, at) => ({
      character: "ghost" as const,
      color: "gray" as const,
      emoji: String.fromCodePoint(0x1f600 + at),
    }));

    expect(recentFaces(many, { character: "mug", color: "green" })).toHaveLength(RECENT_FACES_MOST);
  });
});
