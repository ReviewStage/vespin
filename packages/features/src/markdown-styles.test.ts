// markdown-styles.test.ts -- Markdown read for drawing keeps its every character in order, each span with the looks the page draws it in and its syntax marked, and a mention or a held file's marker as its pill.

import { describe, expect, it } from "vitest";
import { MARK_STYLE, type MarkStyle, markdownStyles, styledRuns } from "./markdown-styles.js";
import { mentionPill, PILL_RUN, runsMarkdown } from "./pill-words.js";

const { HEADING_1, STRONG, CODE, CODE_BLOCK, LINK, LIST_MARK, QUOTE, SYNTAX } = MARK_STYLE;

/** The spans as their words and looks, which read as the drawing does. */
function drawn(markdown: string): readonly (readonly [string, readonly MarkStyle[]])[] {
  return markdownStyles(markdown).map(
    (span) => [markdown.slice(span.start, span.end), span.styles] as const,
  );
}

describe("markdownStyles", () => {
  it.each([
    [
      "a heading, its # as syntax",
      "# Invites",
      [
        ["# ", [HEADING_1, SYNTAX]],
        ["Invites", [HEADING_1]],
      ],
    ],
    [
      "bold words, their ** as syntax",
      "Say **bold** now",
      [
        ["Say ", []],
        ["**", [STRONG, SYNTAX]],
        ["bold", [STRONG]],
        ["**", [STRONG, SYNTAX]],
        [" now", []],
      ],
    ],
    [
      "inline code, its backticks as syntax",
      "run `pnpm`",
      [
        ["run ", []],
        ["`", [CODE, SYNTAX]],
        ["pnpm", [CODE]],
        ["`", [CODE, SYNTAX]],
      ],
    ],
    [
      "a fenced block, its fence lines as syntax",
      "```ts\nlet a\n```",
      [
        ["```ts", [CODE_BLOCK, SYNTAX]],
        ["\nlet a\n", [CODE_BLOCK]],
        ["```", [CODE_BLOCK, SYNTAX]],
      ],
    ],
    [
      "a link, its brackets and address as syntax",
      "see [docs](https://x.dev)",
      [
        ["see ", []],
        ["[", [LINK, SYNTAX]],
        ["docs", [LINK]],
        ["](https://x.dev)", [LINK, SYNTAX]],
      ],
    ],
    [
      "a list, each item's mark as a list mark",
      "- one\n- two",
      [
        ["- ", [LIST_MARK]],
        ["one\n", []],
        ["- ", [LIST_MARK]],
        ["two", []],
      ],
    ],
    [
      "a quote, each line's > as syntax",
      "> one\n> two",
      [
        ["> ", [QUOTE, SYNTAX]],
        ["one\n", [QUOTE]],
        ["> ", [QUOTE, SYNTAX]],
        ["two", [QUOTE]],
      ],
    ],
  ])("cuts %s", (_, markdown, spans) => {
    expect(drawn(markdown)).toEqual(spans);
  });

  it("keeps every character, in order, for words it draws plain", () => {
    const markdown =
      "## Plan\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<details>raw</details>\n\n1. **Ship** it\n\n---\n";

    expect(
      markdownStyles(markdown)
        .map((span) => markdown.slice(span.start, span.end))
        .join(""),
    ).toBe(markdown);
  });
});

describe("styledRuns", () => {
  it("stands a mention as its pill and keeps the bold words around it bold", () => {
    const mention = "[@Ada Lovelace](https://vespin.dev/stage/person/u-ada)";
    const markdown = `**Ask ${mention} now**`;
    const runs = styledRuns(markdown, new Set());

    expect(runs).toEqual([
      { kind: PILL_RUN.WORDS, text: "**", styles: [STRONG, SYNTAX] },
      { kind: PILL_RUN.WORDS, text: "Ask ", styles: [STRONG] },
      {
        kind: PILL_RUN.PILL,
        pill: mentionPill("Ada Lovelace", "https://vespin.dev/stage/person/u-ada"),
      },
      { kind: PILL_RUN.WORDS, text: " now", styles: [STRONG] },
      { kind: PILL_RUN.WORDS, text: "**", styles: [STRONG, SYNTAX] },
    ]);
    expect(runsMarkdown(runs)).toBe(markdown);
  });
});
