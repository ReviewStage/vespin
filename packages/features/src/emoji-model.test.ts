// emoji-model.test.ts -- the emoji a picker offers, over a synthetic slice of `unicode-emoji-json`'s groups: those every client draws, by category, found by name.

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { emojiGroups, findEmoji } from "./emoji-model.js";

const GROUPS = [
  {
    name: "Travel & Places",
    emojis: [
      { emoji: "🚀", name: "rocket", emoji_version: "0.6" },
      { emoji: "🛻", name: "pickup truck", emoji_version: "13.0" },
    ],
  },
  {
    name: "Smileys & Emotion",
    emojis: [
      { emoji: "😀", name: "grinning face", emoji_version: "1.0" },
      { emoji: "🫩", name: "face with bags under eyes", emoji_version: "16.0" },
    ],
  },
  { name: "Newest", emojis: [{ emoji: "🫆", name: "fingerprint", emoji_version: "16.0" }] },
];

describe("emoji", () => {
  const groups = emojiGroups(GROUPS);

  it("leaves out an emoji newer than every client draws, and a category left with none", () => {
    assert.deepEqual(
      groups.map((group) => [group.name, group.emojis.map((one) => one.emoji)]),
      [
        ["Travel & Places", ["🚀", "🛻"]],
        ["Smileys & Emotion", ["😀"]],
      ],
    );
  });

  it("finds an emoji by name, each category keeping only what it found", () => {
    assert.deepEqual(findEmoji(groups, "truck"), [
      { name: "Travel & Places", emojis: [{ emoji: "🛻", name: "pickup truck" }] },
    ]);
    assert.deepEqual(findEmoji(groups, "nothing like it"), []);
  });
});
