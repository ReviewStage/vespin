import assert from "node:assert/strict";
import { test } from "vitest";
import { descriptionBlocks, descriptionBlocksIn } from "./description-blocks.js";
import { joinedMarkdownTree, markdownSliceStarts, markdownSliceTree } from "./markdown-slices.js";
import { markdownTree } from "./markdown-tree.js";

/** A section of a long description, with what a cut must never split: a fence holding a heading and a blank line, a loose list, a table, a quote and a rule. */
function section(at: number): string {
  return [
    `## Section ${at}`,
    "",
    `${"Words of the section, with a [link](https://vespin.dev/stage/task/1359) and `code`. ".repeat(12)}`,
    "",
    "- A loose item",
    "",
    "  its second paragraph",
    "",
    "- Another item",
    "",
    "```ts",
    "## not a heading",
    "",
    "const kept = true;",
    "```",
    "",
    "| Column | Other |",
    "| --- | --- |",
    `| ${at} | cell |`,
    "",
    "> A quote",
    ">",
    "> over two paragraphs",
    "",
    "---",
    "",
    "~~~",
    "# also not a heading",
    "~~~",
  ].join("\n");
}

/** The tree of `text` joined from its slices, as a page reads a long description. */
function joined(text: string): ReturnType<typeof markdownTree> {
  const starts = markdownSliceStarts(text);

  const slices = starts.map((from, at) =>
    markdownSliceTree(text, from, starts[at + 1] ?? text.length),
  );

  return joinedMarkdownTree(slices, text);
}

// A long description is read a slice at a time, and a block, a thread on it, and the editor's saving of untouched blocks each need it exactly where one parse of the whole puts it.
test("a long description read in slices is the tree one parse of it makes, every node at the same place, and holds the same blocks", () => {
  const text = Array.from({ length: 40 }, (_, at) => section(at)).join("\n\n");
  const marked = `\uFEFF${text}`;

  assert.ok(markdownSliceStarts(text).length > 5);

  for (const each of [text, marked]) {
    assert.deepEqual(joined(each), markdownTree(each));
    assert.deepEqual(descriptionBlocksIn(each, joined(each)), descriptionBlocks(each));
  }
});

// A reference anywhere in a document resolves against its definitions, so a document holding one is never cut.
test("a document holding a link or footnote definition is read whole", () => {
  const long = Array.from({ length: 40 }, (_, at) => section(at)).join("\n\n");

  assert.deepEqual(markdownSliceStarts(`${long}\n\n[shot]: https://example.com/a.png`), [0]);
  assert.deepEqual(markdownSliceStarts(`${long}\n\n[^1]: A footnote.`), [0]);
});
