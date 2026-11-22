// document-blocks.test.ts -- a document read as blocks is written back byte for byte where nothing changed, prints again only the block that did, and each block the editor draws prints and reads back as the same content.

import { describe, expect, it } from "vitest";
import {
  BLOCK_KIND,
  type BlockContent,
  documentBlocks,
  type EditedBlock,
  INLINE_MARK,
  INLINE_RUN,
  type InlineMark,
  type InlineRun,
  LIST_MARKER,
  LOCKED_KIND,
  printBlock,
  writtenDocument,
} from "./document-blocks.js";
import { mentionPill } from "./pill-words.js";

const { STRONG, EMPHASIS, CODE } = INLINE_MARK;

/** A numbered list with bullets under its first item and a numbered run under a bullet, as an agent nests a plan's steps. */
const NESTED: BlockContent = {
  kind: BLOCK_KIND.ORDERED_LIST,
  start: 1,
  lines: [
    { runs: [{ kind: INLINE_RUN.WORDS, text: "Model", marks: [] }] },
    {
      runs: [{ kind: INLINE_RUN.WORDS, text: "memberships", marks: [] }],
      depth: 1,
      marker: LIST_MARKER.BULLET,
    },
    {
      runs: [{ kind: INLINE_RUN.WORDS, text: "pending", marks: [] }],
      depth: 2,
      marker: LIST_MARKER.ORDERED,
    },
    {
      runs: [{ kind: INLINE_RUN.WORDS, text: "accepted", marks: [] }],
      depth: 2,
      marker: LIST_MARKER.ORDERED,
    },
    { runs: [{ kind: INLINE_RUN.WORDS, text: "Screen", marks: [] }] },
  ],
};

/** An agent-written description: a heading, a paragraph, a table, a Mermaid diagram, HTML, and a list. */
const DOCUMENT = [
  "# Invites",
  "",
  "An invite **expires** after seven days.",
  "",
  "| Role | May withdraw |",
  "| - | - |",
  "| Owner | yes |",
  "",
  "```mermaid",
  "graph TD",
  "  A-->B",
  "```",
  "",
  "<details>raw</details>",
  "",
  "- one",
  "- two",
  "",
].join("\n");

/** Words with marks, as a run reads. */
function words(text: string, ...marks: InlineMark[]): InlineRun {
  return { kind: INLINE_RUN.WORDS, text, marks };
}

/** Each block as read, handed back untouched with where it came from. */
function untouched(markdown: string): readonly EditedBlock[] {
  return documentBlocks(markdown).map((block, index) => ({ ...block, from: index }));
}

describe("documentBlocks", () => {
  it("reads each block as what the editor draws, or locked as a card", () => {
    expect(
      documentBlocks(DOCUMENT).map((block) =>
        block.kind === BLOCK_KIND.LOCKED ? [block.kind, block.locked] : [block.kind],
      ),
    ).toEqual([
      [BLOCK_KIND.HEADING],
      [BLOCK_KIND.PARAGRAPH],
      [BLOCK_KIND.LOCKED, LOCKED_KIND.TABLE],
      [BLOCK_KIND.LOCKED, LOCKED_KIND.DIAGRAM],
      [BLOCK_KIND.LOCKED, LOCKED_KIND.HTML],
      [BLOCK_KIND.BULLET_LIST],
    ]);
  });

  it("reads a mention as its pill between words", () => {
    const mention = "[@Ada Lovelace](https://vespin.dev/stage/person/u-ada)";
    const [block] = documentBlocks(`Ask ${mention} now`);

    expect(block?.lines[0]?.runs).toEqual([
      words("Ask "),
      {
        kind: INLINE_RUN.PILL,
        pill: mentionPill("Ada Lovelace", "https://vespin.dev/stage/person/u-ada"),
      },
      words(" now"),
    ]);
  });
});

describe("writtenDocument", () => {
  it.each([
    ["with LF line endings", DOCUMENT],
    ["with CR LF line endings", DOCUMENT.replaceAll("\n", "\r\n")],
  ])("writes an untouched document back byte for byte, %s", (_, markdown) => {
    expect(writtenDocument(markdown, untouched(markdown))).toBe(markdown);
  });

  it("prints again only the block that changed", () => {
    const edited = untouched(DOCUMENT).map((block, index) =>
      index === 1
        ? {
            ...block,
            lines: [
              {
                runs: [
                  words("An invite "),
                  words("expires", STRONG),
                  words(" after "),
                  words("one", EMPHASIS),
                  words(" week."),
                ],
              },
            ],
          }
        : block,
    );

    expect(writtenDocument(DOCUMENT, edited)).toBe(
      DOCUMENT.replace(
        "An invite **expires** after seven days.",
        "An invite **expires** after _one_ week.",
      ),
    );
  });

  it("leaves a blank line before a block added after the last", () => {
    const markdown = "One paragraph.\n";

    const added: EditedBlock = {
      kind: BLOCK_KIND.PARAGRAPH,
      lines: [{ runs: [words("Another.")] }],
    };

    expect(writtenDocument(markdown, [...untouched(markdown), added])).toBe(
      "One paragraph.\n\nAnother.\n",
    );
  });
});

describe("printBlock", () => {
  const ada = mentionPill("Ada Lovelace", "https://vespin.dev/stage/person/u-ada");

  it.each<[string, BlockContent, string]>([
    [
      "a heading",
      { kind: BLOCK_KIND.HEADING, level: 2, lines: [{ runs: [words("Plan")] }] },
      "## Plan",
    ],
    [
      "a paragraph with a pill, bold words and a link",
      {
        kind: BLOCK_KIND.PARAGRAPH,
        lines: [
          {
            runs: [
              words("Ask "),
              { kind: INLINE_RUN.PILL, pill: ada },
              words(" about "),
              words("limits", STRONG),
              words(", see "),
              { kind: INLINE_RUN.WORDS, text: "docs", marks: [], link: "https://x.dev" },
              words("."),
            ],
          },
        ],
      },
      `Ask ${ada.markdown} about **limits**, see [docs](https://x.dev).`,
    ],
    [
      "nested marks wrapped once",
      {
        kind: BLOCK_KIND.PARAGRAPH,
        lines: [{ runs: [words("a ", STRONG), words("b", STRONG, EMPHASIS)] }],
      },
      "**a _b_**",
    ],
    [
      "a space typed at bold words' end outside their marks",
      {
        kind: BLOCK_KIND.PARAGRAPH,
        lines: [{ runs: [words("seven "), words("days ", STRONG), words("soon")] }],
      },
      "seven **days** soon",
    ],
    [
      "inline code",
      { kind: BLOCK_KIND.PARAGRAPH, lines: [{ runs: [words("pnpm test", CODE)] }] },
      "`pnpm test`",
    ],
    [
      "words that would read as marks, escaped",
      { kind: BLOCK_KIND.PARAGRAPH, lines: [{ runs: [words("# 2 * 3 [x]")] }] },
      "\\# 2 \\* 3 \\[x\\]",
    ],
    [
      "a task list",
      {
        kind: BLOCK_KIND.TASK_LIST,
        lines: [
          { runs: [words("Ship")], checked: true },
          { runs: [words("Test")], checked: false },
        ],
      },
      "- [x] Ship\n- [ ] Test",
    ],
    [
      "an ordered list from its start",
      {
        kind: BLOCK_KIND.ORDERED_LIST,
        start: 3,
        lines: [{ runs: [words("a")] }, { runs: [words("b")] }],
      },
      "3. a\n4. b",
    ],
    [
      "a code block",
      { kind: BLOCK_KIND.CODE, language: "ts", lines: [{ runs: [words("let a = 1")] }] },
      "```ts\nlet a = 1\n```",
    ],
    [
      "nested items each indented to where their parent's words start, a numbered run counting from one",
      NESTED,
      "1. Model\n   - memberships\n     1. pending\n     2. accepted\n2. Screen",
    ],
    [
      "a task nested under a task, two spaces in",
      {
        kind: BLOCK_KIND.TASK_LIST,
        lines: [
          { runs: [words("Ship")], checked: true },
          { runs: [words("Test")], checked: false, depth: 1, marker: LIST_MARKER.TASK },
        ],
      },
      "- [x] Ship\n  - [ ] Test",
    ],
  ])("prints %s", (_, block, markdown) => {
    expect(printBlock(block)).toBe(markdown);
  });

  it.each<[string, BlockContent]>([
    [
      "a line of words in their looks",
      {
        kind: BLOCK_KIND.PARAGRAPH,
        lines: [
          {
            runs: [
              words("Ship "),
              words("now", STRONG),
              words(" or "),
              words("later", STRONG, EMPHASIS),
              words(", then "),
              words("pnpm test", CODE),
              words(" with 2 * 3."),
            ],
          },
        ],
      },
    ],
    [
      "a task list holding an empty task",
      {
        kind: BLOCK_KIND.TASK_LIST,
        lines: [
          { runs: [words("Ship")], checked: true },
          { runs: [], checked: false },
        ],
      },
    ],
    ["a list nested three deep under numbered items, each item editable", NESTED],
  ])("reads %s printed back as the same content", (_, block) => {
    const [read] = documentBlocks(printBlock(block));

    expect(read?.lines).toEqual(block.lines);
  });
});
