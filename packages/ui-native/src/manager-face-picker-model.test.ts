// manager-face-picker-model.test.ts -- the face picker offers Recent and the characters, finds a character or an emoji by name, and a color picked from a face's menu is that face in that color.

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
  emoji: EMOJI,
};

/** Each group's name and its cells' names, as the grid lists them. */
function listed(state: FacePickerState) {
  return faceGroups(state).map((group) => [group.name, group.cells.map((cell) => cell.label)]);
}

describe("faceGroups", () => {
  // Note that the regression this catches is a grid that loses Recent, draws every character in its color rather than the one standing, or lists the characters in another order than the panel's.
  it("offers Recent, then the characters, the one standing in its color and the rest gray", () => {
    const recent: ManagerFace[] = [{ character: "cat", color: "red", emoji: "🚀" }];
    const groups = faceGroups({ ...STATE, recent });

    expect(groups.map((group) => [group.name, group.cells.map((cell) => cell.label)])).toEqual([
      ["Recent", ["🚀"]],
      ["Characters", ["Ghost", "Planet", "Cat", "Backpack", "Mug", "Speech bubble"]],
    ]);
    expect(groups[0]?.cells[0]).toMatchObject({ face: recent[0], disc: true, picked: false });
    expect(groups[1]?.cells.map((cell) => [cell.face.color, cell.picked])).toEqual([
      ["gray", false],
      ["blue", true],
      ["gray", false],
      ["gray", false],
      ["gray", false],
      ["gray", false],
    ]);
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

  it("offers every emoji by category on the Emoji tab, the one standing on its disc", () => {
    const standing = { character: "planet", color: "teal", emoji: "🚀" } as const;
    const groups = faceGroups({ ...STATE, tab: FACE_TAB.EMOJI, standing });

    expect(groups.map((group) => [group.name, group.cells.map((cell) => cell.label)])).toEqual([
      ["Animals & Nature", ["🦊", "🐱"]],
      ["Travel & Places", ["🚀"]],
    ]);
    expect(groups[1]?.cells[0]).toMatchObject({ face: standing, disc: true, picked: true });
    expect(groups[0]?.cells[0]).toMatchObject({ disc: false, picked: false });
  });
});

describe("a face's colors", () => {
  // Note that the regression this catches is a color that picks another face than the one pressed, an emoji lost from the pick, or a menu that checks a face the Manager does not wear.
  it("offers nine colors, gray first, checks the face standing, and picks the face in the color chosen", () => {
    const standing = { character: "ghost", color: "pink", emoji: "🦊" } as const;
    const fox = faceGroups({ ...STATE, query: "fox", standing })[0]?.cells[0];

    expect(fox?.colors.map((color) => color.label)).toEqual([
      "Gray",
      "Red",
      "Orange",
      "Yellow",
      "Green",
      "Teal",
      "Blue",
      "Purple",
      "Pink",
    ]);
    expect(fox?.colors.filter((color) => color.on).map((color) => color.heard)).toEqual([
      "Pink 🦊",
    ]);
    expect(fox?.colors[1]?.face).toEqual({ character: "ghost", color: "red", emoji: "🦊" });

    const cat = faceGroups({ ...STATE, query: "cat" })[0]?.cells[0];

    expect(cat?.colors[5]?.face).toEqual({ character: "cat", color: "teal" });
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
