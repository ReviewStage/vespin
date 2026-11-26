// document-field-comments.ts -- where a document field stands the counts of its blocks' comment threads: each thread found in the block its anchor falls in, read in the Markdown the service anchored it against, whether the one the field opened on or one the field wrote since.

import type { DocumentBlock } from "@repo/features/document-blocks";
import type { NativeCommentMark } from "./document-field-native.js";

/**
 * The service keeps a thread's anchor as offsets into the description's
 * Markdown and moves it with its words on every save, so the threads a page
 * holds are anchored against the description as last saved. A field names
 * each of its lines by the block of the document as read it came from, never
 * by an offset, so while it is typed in a count stays on its block. Once a
 * save lands, the anchors are offsets into the Markdown that save wrote,
 * which typing above a thread has moved it within; the field keeps where it
 * wrote each block in its last few writes (`writtenSpans`, from the pieces
 * `writtenPieces` writes), so a thread is found in its block in whichever
 * Markdown it was anchored against (`anchoredSpans`). In a Markdown the
 * field neither opened on nor wrote, it finds none, so no count stands
 * rather than one beside the wrong block.
 */

/** Where a comment thread is started: the block's words in the Markdown, and the words it quotes. */
export interface CommentPlace {
  readonly from: number;
  readonly to: number;
  readonly quote: string;
}

/** A document's open comment threads, as the field stands their counts beside its blocks, as the read rows do, and starts one from its edit menu. */
export interface DocumentComments {
  /** The Markdown the threads' anchors are offsets into: the description as the service last saved it, which moves each anchor with its words on every save. */
  readonly markdown: string;
  /** Each open thread on the words, oldest first: where its quoted words start in `markdown`, and what opens it. */
  readonly threads: readonly { readonly at: number; readonly onOpen: () => void }[];
  /** How a block's count of threads is heard. */
  readonly heard: (count: number) => string;
  /** Starts a thread on a block's words. */
  readonly onComment: (place: CommentPlace) => void;
}

/** Where a block stands in a Markdown the field read or wrote: its piece, and the block of the document as read it came from, which the field's lines name it by; none for a block made in the field. */
export interface BlockSpan {
  readonly from: number;
  readonly to: number;
  readonly block: number | undefined;
}

/** A Markdown the field wrote, and where each block stands in it. */
export interface WrittenSpans {
  readonly markdown: string;
  readonly spans: readonly BlockSpan[];
}

/** How many of its own writes the field keeps the blocks' places of, so threads the service anchored against a save a few keys back still find their blocks. */
export const KEPT_WRITES = 8;

/** Where each of `pieces` stands, end to end, each naming its block. */
function piecesSpans(
  pieces: readonly string[],
  blocks: readonly (number | undefined)[],
): readonly BlockSpan[] {
  let at = 0;

  return pieces.map((piece, index) => {
    const from = at;
    at += piece.length;

    return { from, to: at, block: blocks[index] };
  });
}

/** Where each block of the document as read stands in the Markdown it was read from, its sources joined being the Markdown exactly (`documentBlocks`). */
export function readSpans(blocks: readonly DocumentBlock[]): readonly BlockSpan[] {
  return piecesSpans(
    blocks.map((block) => block.source),
    blocks.map((_, index) => index),
  );
}

/** The counts a field stands beside its blocks, and the opener of each block's oldest thread, by the block. */
export interface BlockThreads {
  readonly marks: readonly NativeCommentMark[];
  readonly opens: ReadonlyMap<number, () => void>;
}

/** Each block's count of the threads on its words, and the oldest's opener, by the block. */
export function blockThreads(
  spans: readonly BlockSpan[],
  comments: DocumentComments,
): BlockThreads {
  const counts = new Map<number, number>();
  const opens = new Map<number, () => void>();

  for (const thread of comments.threads) {
    const block = spans.find((span) => thread.at >= span.from && thread.at < span.to)?.block;

    if (block === undefined) continue;
    counts.set(block, (counts.get(block) ?? 0) + 1);

    if (!opens.has(block)) opens.set(block, thread.onOpen);
  }

  const marks = [...counts].map(([block, count]) => ({
    block,
    count,
    heard: comments.heard(count),
  }));

  return { marks, opens };
}

/** Where each block stands in a Markdown the field wrote from its pieces (`writtenPieces`), each piece naming the block of the document as read it came from, as the edited blocks it wrote name it. */
export function writtenSpans(
  pieces: readonly string[],
  blocks: readonly (number | undefined)[],
): WrittenSpans {
  return { markdown: pieces.join(""), spans: piecesSpans(pieces, blocks) };
}

/** The field's writes kept with `write` the newest, the oldest past `KEPT_WRITES` let go. */
export function keptWrites(
  write: WrittenSpans,
  before: readonly WrittenSpans[],
): readonly WrittenSpans[] {
  return [write, ...before].slice(0, KEPT_WRITES);
}

/** Where each block stands in `markdown`, the Markdown the threads were anchored against: the one the field opened on, or one of its writes; none where it is neither. */
export function anchoredSpans(
  markdown: string,
  opened: WrittenSpans,
  written: readonly WrittenSpans[],
): readonly BlockSpan[] | undefined {
  if (markdown === opened.markdown) return opened.spans;

  return written.find((each) => each.markdown === markdown)?.spans;
}
