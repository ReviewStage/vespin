// document-field-model.test.ts -- a document laid into a rich field's lines and told back unchanged writes the same bytes, and a Return typed in it makes the block a rich editor's Return makes.

import {
  BLOCK_KIND,
  documentBlocks,
  INLINE_RUN,
  LIST_MARKER,
  writtenDocument,
} from "@repo/features/document-blocks";
import { describe, expect, it } from "vitest";
import { editedBlocks, editedLines, type FieldLine, fieldLines } from "./document-field-model.js";

/** A description holding each block the field draws, and a table it stands as a card. */
const DOCUMENT = [
  "# Plan",
  "",
  "Ship the **invite** flow.",
  "",
  "- [x] Model",
  "- [ ] Screen",
  "",
  "> Owners may withdraw.",
  "",
  "```ts",
  "const days = 7;",
  "",
  "export { days };",
  "```",
  "",
  "---",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
].join("\n");

/** The lines with one typed after the line at `after`, carrying on that line's block as a Return does. */
function returnedAfter(
  lines: readonly FieldLine[],
  after: number,
  text: string,
): readonly FieldLine[] {
  const line = lines[after];

  if (line === undefined) return lines;
  const typed: FieldLine = { ...line, runs: [{ kind: INLINE_RUN.WORDS, text, marks: [] }] };

  return [...lines.slice(0, after + 1), typed, ...lines.slice(after + 1)];
}

describe("editedBlocks", () => {
  it("tells a document laid in and left alone back as its same bytes", () => {
    expect(writtenDocument(DOCUMENT, editedBlocks(fieldLines(documentBlocks(DOCUMENT))))).toBe(
      DOCUMENT,
    );
  });

  it("makes a Return after a heading a paragraph of its own", () => {
    const markdown = "# Plan\n\nBody.\n";
    const lines = returnedAfter(fieldLines(documentBlocks(markdown)), 0, "Next");

    expect(writtenDocument(markdown, editedBlocks(lines))).toBe("# Plan\n\nNext\n\nBody.\n");
  });

  it("makes a Return in a list another item", () => {
    const markdown = "- one\n- two\n";
    const lines = returnedAfter(fieldLines(documentBlocks(markdown)), 1, "three");

    expect(writtenDocument(markdown, editedBlocks(lines))).toBe("- one\n- two\n- three\n");
  });

  it("writes an item the field indented under the item before it, in a list of its own", () => {
    const markdown = "1. Model\n2. Screen\n3. Ship\n";

    const lines = fieldLines(documentBlocks(markdown)).map((line, index) =>
      index === 1 ? { ...line, depth: 1, marker: LIST_MARKER.BULLET } : line,
    );

    expect(writtenDocument(markdown, editedBlocks(lines))).toBe("1. Model\n   - Screen\n2. Ship\n");
  });

  it("lays a field's lines back out of the blocks they write, its edge spaces and empty paragraph kept", () => {
    const markdown = "# Plan\n\nBody.\n";
    const laid = fieldLines(documentBlocks(markdown));

    const typed: FieldLine[] = [
      ...laid,
      { block: laid.length, kind: BLOCK_KIND.PARAGRAPH, runs: [] },
      {
        block: laid.length + 1,
        kind: BLOCK_KIND.PARAGRAPH,
        runs: [{ kind: INLINE_RUN.WORDS, text: "Ask ", marks: [] }],
      },
    ];

    const edited = editedBlocks(typed);

    expect(editedBlocks(editedLines(edited))).toEqual(edited);
    expect(writtenDocument(markdown, editedBlocks(editedLines(edited)))).toBe(
      writtenDocument(markdown, edited),
    );
  });
});
