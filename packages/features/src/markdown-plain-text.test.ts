// markdown-plain-text.test.ts -- Markdown said as plain text, as a notification's preview shows an agent's words.

import { describe, expect, it } from "vitest";
import { markdownPlainText } from "./markdown-plain-text.js";

describe("markdownPlainText", () => {
  it.each([
    [
      "emphasis, strong and strikethrough lose their marks",
      "A *quick* **bold** ~~old~~ note",
      "A quick bold old note",
    ],
    ["inline code keeps its text", "Run `pnpm test` first", "Run pnpm test first"],
    ["a link says its label", "See [the docs](https://example.com/docs).", "See the docs."],
    [
      "a mention's chip says its label",
      "The repo runs [@Postgres](https://github.com/acme/relay/blob/HEAD/db.ts) already.",
      "The repo runs @Postgres already.",
    ],
    ["a heading loses its marks", "## Plan for today", "Plan for today"],
    ["a quote loses its marks", "> Ship it on Friday.", "Ship it on Friday."],
    ["an unordered list's items lead with a bullet", "- one\n- two", "• one\n• two"],
    ["an ordered list's items keep their numbers", "3. three\n4. four", "3. three\n4. four"],
    ["a code block says its first line", "```ts\nconst a = 1;\nconst b = 2;\n```", "const a = 1;"],
    ["a table says nothing", "| a | b |\n| - | - |\n| 1 | 2 |", ""],
    ["a picture says its alt words", "![the login screen](shot.png)", "the login screen"],
    [
      "a soft line break reads as a space",
      "one line\nthe same paragraph",
      "one line the same paragraph",
    ],
    ["a hard line break starts a line", "Pick one.  \nThen send it.", "Pick one.\nThen send it."],
    [
      "blocks stand one to a line",
      "# Done\n\nAll **three** checks pass.",
      "Done\nAll three checks pass.",
    ],
  ])("%s", (_, markdown, plain) => {
    expect(markdownPlainText(markdown)).toBe(plain);
  });
});
