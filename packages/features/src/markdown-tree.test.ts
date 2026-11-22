// markdown-tree.test.ts -- the latest documents' trees kept, so a page and the sheet it opens share one parse.

import { describe, expect, it } from "vitest";
import { keptMarkdownTree, markdownTree, markdownTreeKept } from "./markdown-tree.js";

describe("keptMarkdownTree", () => {
  it("keeps the latest four documents' trees, letting the least recently read go, and never a tree read plainly", () => {
    const words = ["# One", "# Two", "# Three", "# Four", "# Five"].map((each) => `${each} kept`);

    for (const each of words.slice(0, 4)) keptMarkdownTree(each);
    // Note that reading the first again makes the second the least recently read.
    keptMarkdownTree(words[0] ?? "");
    keptMarkdownTree(words[4] ?? "");
    markdownTree("# Six kept");

    expect([...words, "# Six kept"].map(markdownTreeKept)).toEqual([
      true,
      false,
      true,
      true,
      true,
      false,
    ]);
  });
});
