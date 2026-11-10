// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { selectedMarkdown, WrittenAs } from "./selection-markdown.js";

/**
 * selection-markdown.test.ts -- words selected are written back as the
 * Markdown they were drawn from: a code card's lines, each drawn as a box
 * of its own, stay lines, blank lines included, even in a quote; and a chip
 * picked inside its name keeps the marks around it. Synthetic words.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The range over the whole of `element`'s words. */
function whole(element: Node): Range {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range;
}

test("a code card's lines, each drawn as a box of its own, are quoted as lines", () => {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  for (const words of ["const a = 1;", "", "const b = 2;"]) {
    const row = document.createElement("span");
    row.style.display = "block";
    row.textContent = words === "" ? "\n" : words;
    code.append(row);
  }
  pre.append(code);
  document.body.append(pre);

  assert.equal(selectedMarkdown(whole(pre)), "```\nconst a = 1;\n\nconst b = 2;\n```");
});

test("a fenced block inside a quote keeps every blank line of its code", () => {
  const quote = document.createElement("blockquote");
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = "first\n\n\nlast";
  pre.append(code);
  quote.append(pre);
  document.body.append(quote);

  assert.equal(selectedMarkdown(whole(quote)), "> ```\n> first\n>\n>\n> last\n> ```");
});

test("words picked inside a chip's name under a bold run quote the chip's link in bold", () => {
  const host = document.createElement("p");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        "strong",
        null,
        createElement(WrittenAs, {
          markdown: "[@invite.ts](https://example.com/invite.ts)",
          children: createElement("span", null, "invite.ts"),
        }),
      ),
    ),
  );
  const name = host.querySelector("span span")?.firstChild;
  assert.ok(name instanceof Text);
  const range = document.createRange();
  range.setStart(name, 1);
  range.setEnd(name, 4);

  assert.equal(selectedMarkdown(range), "**[@invite.ts](https://example.com/invite.ts)**");
});
