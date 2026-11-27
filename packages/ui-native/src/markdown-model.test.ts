import { describe, expect, it } from "vitest";
import {
  COLUMN_ALIGN,
  heardLine,
  LINK_TARGET,
  MARKDOWN_BLOCK,
  MARKDOWN_RUN,
  type MarkdownBlock,
  markdownBlocks,
  markdownGithubPages,
  markdownReplyButtons,
  markdownShows,
} from "./markdown-model.js";

const READING = {
  repository: "acme/app",
  now: Date.UTC(2026, 9, 19, 12),
  zone: "UTC",
} as const;

const words = (text: string) => ({
  kind: MARKDOWN_RUN.WORDS,
  text,
  strong: false,
  emphasis: false,
  struck: false,
});

describe("markdownBlocks", () => {
  // A pull request's chip named by its whole title moved to a line of its own and cut it there, where the panel's stands in the line by its key.
  it("draws a mention as its chip, a pull request by its key alone, a date by its day, and any other link as a link", () => {
    const [paragraph] = markdownBlocks(
      "[@#42 Fix the refresh](https://github.com/acme/app/pull/42) on " +
        "[@Oct 20, 2026](mention://date/2026-10-20), see [the docs](https://example.com/docs)",
      READING,
    );

    expect(paragraph).toEqual({
      kind: MARKDOWN_BLOCK.PARAGRAPH,
      runs: [
        {
          kind: MARKDOWN_RUN.CHIP,
          chip: {
            entity: "pull-request",
            name: "#42",
            heard: "pull request #42",
            target: { kind: LINK_TARGET.WEB, href: "https://github.com/acme/app/pull/42" },
            github: "https://github.com/acme/app/pull/42",
            of: { kind: "pull-request", url: "https://github.com/acme/app/pull/42" },
          },
        },
        words(" on "),
        {
          kind: MARKDOWN_RUN.CHIP,
          chip: {
            entity: "date",
            name: "Tomorrow",
            heard: "date Tomorrow",
            target: { kind: LINK_TARGET.NONE },
          },
        },
        words(", see "),
        {
          kind: MARKDOWN_RUN.LINK,
          target: { kind: LINK_TARGET.WEB, href: "https://example.com/docs" },
          runs: [words("the docs")],
        },
      ],
    });
  });

  it("reads a suggestion's link as its button, whose plain link opens the agent whose reply holds it", () => {
    const agentId = "0f6c2a1e-3b4d-4c5e-8f90-1a2b3c4d5e6f";
    const buttonId = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    const href = `https://vespin.dev/acme/agent/${agentId}/button/${buttonId}`;
    const text = `[Fix the flaky test](${href}), then [again](${href})`;
    const [paragraph] = markdownBlocks(text, READING);

    const suggestion = (written: string) => ({
      kind: MARKDOWN_RUN.SUGGESTION,
      suggestion: {
        link: { workspace: "acme", agentId, buttonId },
        words: written,
        target: { kind: LINK_TARGET.PLACE, href: `https://vespin.dev/acme/agent/${agentId}` },
      },
    });

    expect(paragraph).toMatchObject({
      runs: [suggestion("Fix the flaky test"), words(", then "), suggestion("again")],
    });
    expect(markdownReplyButtons(text, READING)).toEqual([{ workspace: "acme", agentId, buttonId }]);
  });

  it("draws a link the panel would not open, one past 2,048 characters, as a link to nowhere", () => {
    const [paragraph] = markdownBlocks(
      `[the log](https://example.com/${"a".repeat(2_048)})`,
      READING,
    );

    expect(paragraph).toMatchObject({
      runs: [{ kind: MARKDOWN_RUN.LINK, target: { kind: LINK_TARGET.NONE } }],
    });
  });

  it("routes a task's chip to its place in the app", () => {
    const [paragraph] = markdownBlocks(
      "[@Teammate invitations](https://vespin.dev/acme/task/42)",
      READING,
    );

    expect(paragraph).toMatchObject({
      runs: [
        {
          kind: MARKDOWN_RUN.CHIP,
          chip: {
            name: "Teammate invitations",
            heard: "task Teammate invitations",
            target: { kind: LINK_TARGET.PLACE, workspace: "acme" },
          },
        },
      ],
    });
  });

  it("calls a place it holds no name for by its kind, which a screen reader hears once", () => {
    const [paragraph] = markdownBlocks(
      "https://vespin.dev/acme/automation/5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b83/run/1f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b83",
      READING,
    );

    expect(paragraph).toMatchObject({
      runs: [
        { kind: MARKDOWN_RUN.CHIP, chip: { name: "Automation run", heard: "Automation run" } },
      ],
    });
  });

  it("joins a paragraph's lines with a space, and keeps them where a person typed the words", () => {
    const written = "A quote stands apart,\nand wraps.";
    expect(markdownBlocks(written, READING)).toEqual([
      { kind: MARKDOWN_BLOCK.PARAGRAPH, runs: [words("A quote stands apart, and wraps.")] },
    ]);
    expect(markdownBlocks(written, { ...READING, typed: true })).toEqual([
      { kind: MARKDOWN_BLOCK.PARAGRAPH, runs: [words("A quote stands apart,\nand wraps.")] },
    ]);
  });

  it("draws a marker of a picture the message carries as its chip, and any other marker, one in code, or one escaped into words, as its words", () => {
    const written = "See [Picture 1] beside [Picture 2] and \\[Picture 1], not `[Picture 1]`.";

    expect(markdownBlocks(written, { ...READING, pictures: new Set(["Picture 1"]) })).toEqual([
      {
        kind: MARKDOWN_BLOCK.PARAGRAPH,
        runs: [
          words("See "),
          { kind: MARKDOWN_RUN.PICTURE, name: "Picture 1" },
          words(" beside [Picture 2] and [Picture 1], not "),
          { kind: MARKDOWN_RUN.CODE, text: "[Picture 1]" },
          words("."),
        ],
      },
    ]);
  });

  // A bot's table, a folded log, and a screenshot pasted on GitHub are raw HTML in a comment's Markdown, which the app hid in a row and printed as tags on a thread's screen.
  it("reads GitHub's raw HTML as GitHub's page draws it, every other tag and comment unseen", () => {
    const body = [
      "<!-- What changed and why? -->",
      "",
      '<p align="center"><img src="https://example.com/shot.png" alt="Shot"></p>',
      "",
      '<table><tr><th>Name</th><th>Status</th></tr><tr><td><b>web</b></td><td><a href="https://example.com/preview">Visit</a></td></tr></table>',
      "",
      "<details>",
      "<summary>Coverage &amp; lint</summary>",
      "",
      "All files are **covered**.",
      "",
      "</details>",
      "",
      "Done<br>now <blink>really</blink>.",
    ].join("\n");

    expect(markdownBlocks(body, { ...READING, githubWords: true })).toEqual([
      { kind: MARKDOWN_BLOCK.PICTURE, source: "https://example.com/shot.png", alt: "Shot" },
      {
        kind: MARKDOWN_BLOCK.TABLE,
        align: [COLUMN_ALIGN.START, COLUMN_ALIGN.START],
        rows: [
          [[words("Name")], [words("Status")]],
          [
            [{ ...words("web"), strong: true }],
            [
              {
                kind: MARKDOWN_RUN.LINK,
                target: { kind: LINK_TARGET.WEB, href: "https://example.com/preview" },
                runs: [words("Visit")],
              },
            ],
          ],
        ],
      },
      {
        kind: MARKDOWN_BLOCK.DETAILS,
        summary: [words("Coverage & lint")],
        blocks: [
          {
            kind: MARKDOWN_BLOCK.PARAGRAPH,
            runs: [words("All files are "), { ...words("covered"), strong: true }, words(".")],
          },
        ],
      },
      {
        kind: MARKDOWN_BLOCK.PARAGRAPH,
        runs: [
          words("Done"),
          { kind: MARKDOWN_RUN.BREAK },
          words("now "),
          words("really"),
          words("."),
        ],
      },
    ]);
    expect(markdownShows("<!-- What changed and why? -->\n", { githubWords: true })).toBe(false);
  });

  // A pull request's comments reach the app as GitHub's Markdown, in which `@ada` and `#126` are words GitHub links on its own page alone.
  it("links the words GitHub links on its own in GitHub's words, but none inside a link's own words", () => {
    const [paragraph] = markdownBlocks(
      'cc @ada: #126, not [#9](https://example.com/9) or <a href="https://example.com/7">#7</a>',
      { ...READING, githubWords: true },
    );

    expect(paragraph).toMatchObject({
      kind: MARKDOWN_BLOCK.PARAGRAPH,
      runs: [
        words("cc "),
        {
          kind: MARKDOWN_RUN.CHIP,
          chip: { name: "ada", target: { kind: LINK_TARGET.WEB, href: "https://github.com/ada" } },
        },
        words(": "),
        {
          kind: MARKDOWN_RUN.CHIP,
          chip: {
            name: "#126",
            target: { kind: LINK_TARGET.WEB, href: "https://github.com/acme/app/issues/126" },
          },
        },
        words(", not "),
        {
          kind: MARKDOWN_RUN.LINK,
          target: { kind: LINK_TARGET.WEB, href: "https://example.com/9" },
          runs: [words("#9")],
        },
        words(" or "),
        {
          kind: MARKDOWN_RUN.LINK,
          target: { kind: LINK_TARGET.WEB, href: "https://example.com/7" },
          runs: [words("#7")],
        },
      ],
    });
    expect(markdownBlocks("cc @ada", READING)).toEqual([
      { kind: MARKDOWN_BLOCK.PARAGRAPH, runs: [words("cc @ada")] },
    ]);
  });

  it.each([
    ['<a href="javascript:alert(1)">x</a>'],
    ['<a href="data:text/html,<p>hi</p>">x</a>'],
    ['<img src="data:image/png;base64,AAAA" alt="x">'],
    ['<img src="javascript:alert(1)" alt="x">'],
  ])("draws only the words of a link or picture GitHub's HTML names off the web: %s", (html) => {
    expect(markdownBlocks(`<p>${html}</p>`, { ...READING, githubWords: true })).toEqual([
      { kind: MARKDOWN_BLOCK.PARAGRAPH, runs: [words("x")] },
    ]);
  });

  // A comment of tags opened and never closed read each one to the words' end and nested a block per tag, past the stack's depth.
  it("reads 100 kB of GitHub's tags left open in one pass, nesting no deeper than a few", () => {
    const blocks = markdownBlocks(`${"<details>".repeat(11_000)}end`, {
      ...READING,
      githubWords: true,
    });

    const detailsDepth = (within: readonly MarkdownBlock[]): number => {
      const [first] = within;

      return first?.kind === MARKDOWN_BLOCK.DETAILS ? 1 + detailsDepth(first.blocks) : 0;
    };

    const depth = detailsDepth(blocks);

    expect(depth).toBeLessThanOrEqual(8);
    expect(JSON.stringify(blocks)).toContain('"end"');
  });

  it("draws a table as rows as wide as its header, each column aligned as written", () => {
    const [table] = markdownBlocks("| Name | Count |\n| :-- | --: |\n| a | 1 |\n| b |", READING);
    expect(table).toEqual({
      kind: MARKDOWN_BLOCK.TABLE,
      align: [COLUMN_ALIGN.START, COLUMN_ALIGN.END],
      rows: [
        [[words("Name")], [words("Count")]],
        [[words("a")], [words("1")]],
        [[words("b")], []],
      ],
    });
  });

  it("draws a task list's items ticked, open, and an item that is no task", () => {
    const [list] = markdownBlocks("- [x] Ship it\n- [ ] Test it\n- Note it", READING);
    expect(list).toEqual({
      kind: MARKDOWN_BLOCK.LIST,
      start: undefined,
      items: [
        { checked: true, blocks: [{ kind: MARKDOWN_BLOCK.PARAGRAPH, runs: [words("Ship it")] }] },
        { checked: false, blocks: [{ kind: MARKDOWN_BLOCK.PARAGRAPH, runs: [words("Test it")] }] },
        {
          checked: undefined,
          blocks: [{ kind: MARKDOWN_BLOCK.PARAGRAPH, runs: [words("Note it")] }],
        },
      ],
    });
  });

  it("draws a fence named for where its words go as a draft, and any other fence as code", () => {
    expect(
      markdownBlocks("```slack\nShip *today*\n```\n\n```ts\nconst a = 1;\n```", READING),
    ).toEqual([
      {
        kind: MARKDOWN_BLOCK.DRAFT,
        draft: {
          kind: "slack",
          subject: undefined,
          runs: [
            { kind: "text", text: "Ship " },
            { kind: "mark", mark: "bold", runs: [{ kind: "text", text: "today" }] },
          ],
        },
      },
      { kind: MARKDOWN_BLOCK.CODE, text: "const a = 1;" },
    ]);
  });

  // A description's Mermaid fence drew as its code on iOS where the panel draws its diagram, and a transcript still being written must not redraw one at each word.
  it("draws a Mermaid fence as its diagram where the words are read for diagrams, and as code elsewhere", () => {
    const words = "```mermaid\nflowchart LR\n  A --> B\n```";

    expect(markdownBlocks(words, { ...READING, diagrams: true })).toEqual([
      { kind: MARKDOWN_BLOCK.DIAGRAM, code: "flowchart LR\n  A --> B" },
    ]);
    expect(markdownBlocks(words, READING)).toEqual([
      { kind: MARKDOWN_BLOCK.CODE, text: "flowchart LR\n  A --> B" },
    ]);
  });

  it("draws words nested too deep to parse as one block of plain text", () => {
    const deep = `${">".repeat(8000)} **hi**`;
    expect(markdownBlocks(deep, READING)).toEqual([{ kind: MARKDOWN_BLOCK.CODE, text: deep }]);
  });
});

describe("markdownGithubPages", () => {
  // A chip whose page is never listed is never followed, so it never says where its pull request stands.
  it("lists each GitHub pull request and issue a chip names once, through a definition too, and no other link", () => {
    const pages = markdownGithubPages(
      "[@#42 Fix](https://github.com/acme/app/pull/42), [@#7 Bug][bug], " +
        "[again](https://github.com/acme/app/pull/42), [the docs](https://example.com/docs)\n\n" +
        "[bug]: https://github.com/acme/app/issues/7",
      READING,
    );

    expect(pages).toEqual([
      "https://github.com/acme/app/pull/42",
      "https://github.com/acme/app/issues/7",
    ]);
  });
});

describe("heardLine", () => {
  it("hears a line's chips by their kind and name, and leaves a line of words as drawn", () => {
    const [chipLine, plainLine] = markdownBlocks(
      "Pull request: [@#128 Invite a teammate by email](https://github.com/acme/app/pull/128)\n\n" +
        "See [the docs](https://example.com/docs)",
      READING,
    );

    expect(chipLine?.kind === MARKDOWN_BLOCK.PARAGRAPH && heardLine(chipLine.runs)).toBe(
      "Pull request: pull request #128",
    );
    expect(plainLine?.kind === MARKDOWN_BLOCK.PARAGRAPH && heardLine(plainLine.runs)).toBe(
      undefined,
    );
  });
});
