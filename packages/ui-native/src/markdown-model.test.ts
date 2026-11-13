import { describe, expect, it } from "vitest";
import {
  COLUMN_ALIGN,
  heardLine,
  LINK_TARGET,
  MARKDOWN_BLOCK,
  MARKDOWN_RUN,
  markdownBlocks,
  markdownGithubPages,
  markdownReplyButtons,
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
  it("draws a mention as its chip, a date by its day, and any other link as a link", () => {
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
            name: "#42 Fix the refresh",
            heard: "pull request #42 Fix the refresh",
            target: { kind: LINK_TARGET.WEB, href: "https://github.com/acme/app/pull/42" },
            github: "https://github.com/acme/app/pull/42",
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
      "Pull request: pull request #128 Invite a teammate by email",
    );
    expect(plainLine?.kind === MARKDOWN_BLOCK.PARAGRAPH && heardLine(plainLine.runs)).toBe(
      undefined,
    );
  });
});
