/**
 * reply-quote.ts -- words picked out of an agent's message to answer, held in a message as quotes between the developer's own lines: the reply as picked, and a message read as its blocks and written back.
 *
 * A reply is laid into the message box where the caret stands, as a quote
 * block of its own, and the developer writes under it, so a message may
 * answer several of the agent's points, each under its quote, or ask one
 * thing under several stacked together. The message is one string all the
 * same, as the wire takes it: each quote a Markdown blockquote with a blank
 * line before and after it, so the agent reads it as any quote, the
 * transcript draws it as one, and the line after a quote is never pulled
 * into it. Read back, as a draft or a message that did not go comes back
 * into the box, a run of quoted lines with a blank line or the message's
 * edge on each side is a quote again, but inside a fenced block, whose
 * lines are its code as written (`fenceAfter`); any other line is the
 * words it is.
 * The picked words are kept as the selection read them, but for the blank
 * lines around them and runs of them inside, whole: only the message's own
 * bound cuts a quote, where the box has no room left for all of it
 * (`cutReply`).
 */

import { fenceAfter } from "./description-document.js";

const ELLIPSIS = "…";
const NEWLINE = "\n";

/** What stands between a quote and the block beside it: one blank line. */
export const QUOTE_GAP = "\n\n";

/** Spaces at a line's end. */
const TRAILING_SPACES = /[^\S\n]+$/gmu;

/** A line of a blockquote: `>` alone, or `> ` and its words. */
const QUOTE_LINE = /^>(?: |$)/u;

/** The kinds of block a message is read as. */
export const MESSAGE_BLOCK = {
  /** Words of the agent's, quoted. */
  QUOTE: "quote",
  /** The developer's own lines, as typed. */
  WORDS: "words",
} as const;

/** One block of a message: a quote of the agent's words, or a run of the developer's lines. */
export type MessageBlock =
  | { readonly kind: typeof MESSAGE_BLOCK.QUOTE; readonly words: string }
  | { readonly kind: typeof MESSAGE_BLOCK.WORDS; readonly lines: readonly string[] };

/**
 * Words with each run of blank lines outside a fenced block cut to `most`
 * blank lines, as a selection across a message's blocks holds more of them
 * than a quote needs; the lines inside a fence are kept as its code holds
 * them, since a blank line there is part of the code.
 */
export function keptBlankLines(words: string, most: number): string {
  const kept: string[] = [];
  let fence: string | undefined;
  let blanks = 0;

  for (const line of words.split(NEWLINE)) {
    const coded = fence !== undefined;
    fence = fenceAfter(fence, line);

    if (!coded && line.trim() === "") {
      blanks += 1;
      continue;
    }

    for (let at = 0; at < Math.min(blanks, most); at += 1) kept.push("");
    blanks = 0;
    kept.push(line);
  }

  for (let at = 0; at < Math.min(blanks, most); at += 1) kept.push("");

  return kept.join(NEWLINE);
}

/** A reply cut from its end to `chars` characters at most, its ellipsis included; empty where no word of it fits. */
export function cutReply(reply: string, chars: number): string {
  if (reply.length <= chars) return reply;
  const keep = chars - ELLIPSIS.length;

  return keep <= 0 ? "" : `${reply.slice(0, keep).trimEnd()}${ELLIPSIS}`;
}

/** The reply the words picked stand for: trimmed, and one blank line at most between their blocks; empty where nothing but space was picked. */
export function replyOf(picked: string): string {
  return keptBlankLines(picked.replace(/\r\n?/gu, NEWLINE).replace(TRAILING_SPACES, ""), 1).trim();
}

/** A reply as a Markdown blockquote, every line of it quoted. */
export function quoteOf(reply: string): string {
  return reply
    .split(NEWLINE)
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join(NEWLINE);
}

/** Where a quote that starts at `at` ends, past its last line; nothing where no quote starts there, a blank line or the message's edge on either side. */
function quoteEnd(lines: readonly string[], at: number): number | undefined {
  if (!QUOTE_LINE.test(lines[at] ?? "")) return undefined;

  if (at > 0 && lines[at - 1] !== "") return undefined;
  let end = at;

  while (end < lines.length && QUOTE_LINE.test(lines[end] ?? "")) end += 1;

  return end < lines.length && lines[end] !== "" ? undefined : end;
}

/**
 * A message read as its blocks: each quote, the blank lines that only part
 * it from its neighbors left out, and the developer's lines between, as
 * they stand, a fenced block's among them whole, a `>` line in it included.
 * Words with no quote are one block of their lines, and no words at all are
 * one empty line.
 */
export function messageBlocks(text: string): readonly MessageBlock[] {
  const lines = text.split(NEWLINE);
  const blocks: MessageBlock[] = [];
  let words: string[] = [];
  let fence: string | undefined;
  let at = 0;

  while (at < lines.length) {
    // Note that a quote's own lines all open with `>`, so none opens or closes a fence, and only the developer's lines move it.
    const end = fence === undefined ? quoteEnd(lines, at) : undefined;

    if (end === undefined) {
      const line = lines[at] ?? "";
      fence = fenceAfter(fence, line);
      words.push(line);
      at += 1;
      continue;
    }

    // Note that the blank line before a quote is the gap, unless the quote before it took it.
    words.pop();

    if (words.length > 0) blocks.push({ kind: MESSAGE_BLOCK.WORDS, lines: words });
    words = [];
    const quoted = lines.slice(at, end).map((line) => line.slice(2));
    blocks.push({ kind: MESSAGE_BLOCK.QUOTE, words: quoted.join(NEWLINE) });
    // The blank line after it is the gap too, and where it ends the message, an empty line follows.
    at = end + 1;

    if (at === lines.length) words.push("");
  }

  if (words.length > 0 || blocks.length === 0) {
    blocks.push({ kind: MESSAGE_BLOCK.WORDS, lines: words.length > 0 ? words : [""] });
  }

  return blocks;
}

/** A message written from its blocks: each quote a blockquote, the developer's lines as they stand, a blank line between a quote and its neighbors. */
export function messageText(blocks: readonly MessageBlock[]): string {
  return blocks
    .map((block) =>
      block.kind === MESSAGE_BLOCK.QUOTE ? quoteOf(block.words) : block.lines.join(NEWLINE),
    )
    .join(QUOTE_GAP);
}
