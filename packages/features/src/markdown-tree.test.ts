// markdown-tree.test.ts -- the latest words' trees kept, so a page and the sheet it opens share one parse.

import { describe, expect, it } from "vitest";
import { markdownTree, markdownTreeKept } from "./markdown-tree.js";

describe("markdownTree", () => {
  it("keeps the trees of the latest four words read, letting the least recently read go", () => {
    const words = ["# One", "# Two", "# Three", "# Four", "# Five"].map((each) => `${each} kept`);

    for (const each of words.slice(0, 4)) markdownTree(each);
    // Note that reading the first again makes the second the least recently read.
    markdownTree(words[0] ?? "");
    markdownTree(words[4] ?? "");

    expect(words.map(markdownTreeKept)).toEqual([true, false, true, true, true]);
  });
});
