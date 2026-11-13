import assert from "node:assert/strict";
import { test } from "vitest";
import { drawnPictureAddresses } from "./drawn-pictures.js";

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
