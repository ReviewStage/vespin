// document-field-model.ts -- a document's blocks as the lines a rich field holds, each line knowing its block, and the lines a field tells back as the blocks a document is written from.

import {
  BLOCK_KIND,
  type BlockContent,
  type BlockLine,
  type DocumentBlock,
  type EditedBlock,
  INLINE_RUN,
  LOCKED_KIND,
  type LockedKind,
} from "@repo/features/document-blocks";

/**
 * A rich field holds a document as lines, a paragraph each, as UIKit's text
 * view holds paragraphs: a heading's words, a list's item, a quote's
 * paragraph, a code block's line of text, a locked block's card. Each line
 * carries what block it belongs to (`block`, a key the field keeps on the
 * line as it is edited), the block's kind and what its kind holds (a
 * heading's level, a list's start, a code block's language, a locked card's
 * kind), a task's box, and which block of the document as read it came from,
 * none for a block made in the field. Written back, lines sharing a key are
 * one block again, but for a Return typed in a block that holds one line (a
 * paragraph, a heading, a rule, a card), whose new lines are new paragraphs,
 * as a rich editor's Return starts one.
 */

/** A line of a rich field: its runs, and the block it belongs to. */
export interface FieldLine {
  /** The key of the block the line belongs to, which a line typed by Return carries on from the line it was typed in. */
  readonly block: number;
  readonly kind: BlockContent["kind"];
  readonly level?: number | undefined;
  readonly start?: number | undefined;
  readonly language?: string | undefined;
  readonly locked?: LockedKind | undefined;
  readonly checked?: boolean | undefined;
  /** Which block of the document as read the line's block came from; none for one made in the field. */
  readonly from?: number | undefined;
  readonly runs: BlockLine["runs"];
}

/** The kinds a block holds one line of, whose further lines a Return makes paragraphs of their own. */
const ONE_LINE_KINDS: ReadonlySet<BlockContent["kind"]> = new Set([
  BLOCK_KIND.PARAGRAPH,
  BLOCK_KIND.HEADING,
  BLOCK_KIND.RULE,
  BLOCK_KIND.LOCKED,
]);

/** A rule's one line, since a rule holds no words but stands on a line of its own. */
const RULE_LINE: BlockLine = { runs: [] };

/** What a line carries of its block, its kind's own facts with it. */
function blockFacts(block: BlockContent): Omit<FieldLine, "block" | "from" | "runs" | "checked"> {
  switch (block.kind) {
    case BLOCK_KIND.HEADING:
      return { kind: block.kind, level: block.level };
    case BLOCK_KIND.ORDERED_LIST:
      return { kind: block.kind, start: block.start };
    case BLOCK_KIND.CODE:
      return { kind: block.kind, language: block.language };
    case BLOCK_KIND.LOCKED:
      return { kind: block.kind, locked: block.locked };
    default:
      return { kind: block.kind };
  }
}

/** A code block's text as its lines, one run each, which the field holds a line apiece. */
function codeLines(block: BlockContent): readonly BlockLine[] {
  const text = block.lines
    .flatMap((line) => line.runs.map((run) => (run.kind === INLINE_RUN.WORDS ? run.text : "")))
    .join("");

  return text.split("\n").map((line) => ({
    runs: line === "" ? [] : [{ kind: INLINE_RUN.WORDS, text: line, marks: [] }],
  }));
}

/** A block's lines as a field holds them, keyed by `key`, naming the block of the document as read it came from, none for one made in the field. */
function blockLines(
  block: BlockContent,
  key: number,
  from: number | undefined,
): readonly FieldLine[] {
  const facts = blockFacts(block);

  const lines =
    block.kind === BLOCK_KIND.CODE
      ? codeLines(block)
      : block.kind === BLOCK_KIND.RULE
        ? [RULE_LINE]
        : block.lines;

  return lines.map((line): FieldLine => {
    const laid: FieldLine = { ...facts, block: key, from, runs: line.runs };

    if (line.checked === undefined) return laid;

    return { ...laid, checked: line.checked };
  });
}

/** The document's blocks as a field's lines, each block keyed by its place and naming it as where it came from. */
export function fieldLines(blocks: readonly DocumentBlock[]): readonly FieldLine[] {
  return blocks.flatMap((block, index) => blockLines(block, index, index));
}

/**
 * The blocks a field's lines were read as (`editedBlocks`), laid out as its
 * lines again, each naming the block it came from as it did. Note that a
 * field's own edits are handed back this way rather than read again from the
 * Markdown they write, since Markdown keeps neither a paragraph's spaces at
 * its edges nor an empty paragraph, and a field handed lines without them
 * would take away a space or a line the reader just typed.
 */
export function editedLines(blocks: readonly EditedBlock[]): readonly FieldLine[] {
  return blocks.flatMap((block, index) => blockLines(block, index, block.from));
}

/** A block's content from its kind's facts and its lines. */
function blockOf(first: FieldLine, lines: readonly BlockLine[]): BlockContent {
  switch (first.kind) {
    case BLOCK_KIND.HEADING:
      return { kind: first.kind, level: first.level ?? 1, lines };
    case BLOCK_KIND.ORDERED_LIST:
      return { kind: first.kind, start: first.start ?? 1, lines };
    case BLOCK_KIND.CODE: {
      // Note that a code block's lines are one text again, joined by the line breaks the field held them apart by.
      const text = lines
        .map((line) =>
          line.runs.map((run) => (run.kind === INLINE_RUN.WORDS ? run.text : "")).join(""),
        )
        .join("\n");

      return {
        kind: first.kind,
        language: first.language ?? "",
        lines: [{ runs: [{ kind: INLINE_RUN.WORDS, text, marks: [] }] }],
      };
    }

    case BLOCK_KIND.LOCKED:
      return { kind: first.kind, locked: first.locked ?? LOCKED_KIND.OTHER, lines };
    case BLOCK_KIND.RULE:
      return { kind: first.kind, lines: [] };
    default:
      return { kind: first.kind, lines };
  }
}

/** A line as a block's line: its runs, and its box where its block is a task list. */
function blockLine(line: FieldLine): BlockLine {
  if (line.kind !== BLOCK_KIND.TASK_LIST) return { runs: line.runs };

  return { runs: line.runs, checked: line.checked === true };
}

/**
 * The lines a field tells back as the blocks a document is written from
 * (`writtenDocument`): side by side lines sharing a key are one block, its
 * first line's facts the block's, and it names where it came from; in a
 * block that holds one line, each line after the first is a paragraph of
 * its own, made in the field.
 */
export function editedBlocks(lines: readonly FieldLine[]): readonly EditedBlock[] {
  const groups: FieldLine[][] = [];
  let previous: FieldLine | undefined;

  for (const line of lines) {
    const group = groups.at(-1);
    const same = previous !== undefined && previous.block === line.block;

    if (group !== undefined && same && !ONE_LINE_KINDS.has(line.kind)) {
      group.push(line);
    } else if (same) {
      // Note that a Return typed in a one-line block makes a paragraph, as a rich editor's Return does after a heading.
      groups.push([{ ...line, kind: BLOCK_KIND.PARAGRAPH, from: undefined }]);
    } else {
      groups.push([line]);
    }

    previous = line;
  }

  return groups.flatMap((group) => {
    const [first] = group;

    if (first === undefined) return [];
    const block = blockOf(first, group.map(blockLine));

    return [first.from === undefined ? block : { ...block, from: first.from }];
  });
}
