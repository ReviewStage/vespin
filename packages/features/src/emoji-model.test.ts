// emoji-model.test.ts -- the emoji a picker offers and finds: those every client draws, by category, and what a search finds by name, CLDR keyword, and shortcode, over the generated emojibase data.

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { emojiGroups, findEmoji } from "./emoji-model.js";
import { EMOJI_DATA } from "./generated/emoji-data.js";

describe("emojiGroups", () => {
  it("leaves out an emoji newer than every client draws, and a category left with none, and joins Unicode's smileys and people as one", () => {
    const groups = emojiGroups([
      {
        name: "Travel & Places",
        emojis: [
          { emoji: "🚀", name: "rocket", version: 0.6, keywords: [], shortcodes: [] },
          { emoji: "🛻", name: "pickup truck", version: 13, keywords: [], shortcodes: [] },
        ],
      },
      {
        name: "Smileys & Emotion",
        emojis: [
          { emoji: "😀", name: "grinning face", version: 1, keywords: [], shortcodes: [] },
          {
            emoji: "🫩",
            name: "face with bags under eyes",
            version: 16,
            keywords: [],
            shortcodes: [],
          },
        ],
      },
      {
        name: "People & Body",
        emojis: [{ emoji: "👋", name: "waving hand", version: 0.6, keywords: [], shortcodes: [] }],
      },
      {
        name: "Newest",
        emojis: [{ emoji: "🫆", name: "fingerprint", version: 16, keywords: [], shortcodes: [] }],
      },
    ]);

    assert.deepEqual(
      groups.map((group) => [group.name, group.emojis.map((one) => one.emoji)]),
      [
        ["Travel & Places", ["🚀", "🛻"]],
        ["Smileys & People", ["😀", "👋"]],
      ],
    );
  });
});

describe("findEmoji", () => {
  const groups = emojiGroups(EMOJI_DATA);

  /**
   * Each query, the emoji emojibase's English data names by it outright (its
   * CLDR keywords, GitHub shortcode, or name, in Unicode's order), which a
   * search ranks first, and emoji a substring of a word used to find.
   */
  it.each([
    {
      query: "happy",
      named: "😀 😃 😄 😁 😆 🤣 😂 🙂 😇 ☺️ 🥲 🥳 🤸 🤸‍♂️ 🤸‍♀️ 🎂",
      absent: "",
    },
    { query: "idea", named: "💭 💡", absent: "" },
    { query: "+1", named: "👍", absent: "" },
    { query: ":thumbsup:", named: "👍", absent: "" },
    { query: "lol", named: "😄 😆 🤣 😂 🫠 😹", absent: "" },
    { query: "ok", named: "🫡 👌 🙆 🙆‍♂️ 🙆‍♀️ 🆗", absent: "💔 🍳 🍪" },
    { query: "done", named: "💅 ⌛ ⏳ ✅ ☑️ ✔️", absent: "🇮🇩" },
    { query: "fox", named: "🦊", absent: "" },
  ])("finds $query by keyword and shortcode", ({ query, named, absent }) => {
    const found = findEmoji(groups, query).map((one) => one.emoji);
    const first = named.split(" ");

    assert.deepEqual(found.slice(0, first.length), first);

    for (const one of absent.split(" ").filter((emoji) => emoji !== "")) {
      assert.ok(!found.includes(one), `${query} finds ${one}`);
    }
  });

  it("ranks a whole word above a word it only begins", () => {
    const found = findEmoji(groups, "lol").map((one) => one.emoji);

    assert.equal(found.at(-1), "🍭");
  });

  it("finds nothing for a blank query", () => {
    assert.deepEqual(findEmoji(groups, "  "), []);
  });
});
