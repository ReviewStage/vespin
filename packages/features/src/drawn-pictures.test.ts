import assert from "node:assert/strict";
import { test } from "vitest";
import { drawnPictureAddresses } from "./drawn-pictures.js";
import { markdownTreeKept } from "./markdown-tree.js";

// A client that reads a description's pictures before drawing them must find every one the parse draws, or a reference-style picture waits for bytes no one asked for.
test("every picture the parse draws is found once, through its definition or angle brackets, and a link or code draws none", () => {
  const text = [
    "![one](https://example.com/a.png) and [a link](https://example.com/b.png)",
    "",
    "![two][shot] ![again](https://example.com/a.png)",
    "",
    "![three](<https://example.com/c d.png>)",
    "",
    "`![code](https://example.com/e.png)`",
    "",
    "[shot]: https://example.com/d.png",
  ].join("\n");

  assert.deepEqual(drawnPictureAddresses(text), [
    "https://example.com/a.png",
    "https://example.com/d.png",
    "https://example.com/c d.png",
  ]);
});

// A page that draws a description and reads its pictures parses it once, since a long description's parse is most of its open.
test("a description's pictures are read through the tree its blocks keep", () => {
  const text = "# Kept for its pictures\n\n![shot](https://example.com/kept.png)";

  drawnPictureAddresses(text);

  assert.equal(markdownTreeKept(text), true);
});
