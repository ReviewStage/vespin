import {
  BLOCK_KIND,
  documentBlocks,
  type EditedBlock,
  INLINE_RUN,
  writtenPieces,
} from "@repo/features/document-blocks";
import { describe, expect, it } from "vitest";
import {
  anchoredSpans,
  blockThreads,
  keptWrites,
  readSpans,
  writtenSpans,
} from "./document-field-comments.js";

/** A description of four blocks: Context's heading and words, then Flow's heading, which a thread is on, and its words. */
const OPENED = "## Context\n\nOnly an admin can add someone.\n\n## Flow\n\nThe invite ends here.\n";

/** The words typed above Flow, long enough to move its heading past where it stood. */
const TYPED = "A line typed well above the flow, so its heading moves down.";

describe("blockThreads", () => {
  it("stands a thread re-anchored against a save on the block its words are in", () => {
    const read = documentBlocks(OPENED);

    // A paragraph typed between Context's words and Flow's heading, every block as read kept as it stood.
    const typed: EditedBlock = {
      kind: BLOCK_KIND.PARAGRAPH,
      lines: [{ runs: [{ kind: INLINE_RUN.WORDS, text: TYPED, marks: [] }] }],
    };

    const kept = read.map((block, at): EditedBlock => ({ ...block, from: at }));
    const edited = [...kept.slice(0, 2), typed, ...kept.slice(2)];

    const wrote = writtenSpans(
      writtenPieces(OPENED, edited, undefined, read),
      edited.map((block) => block.from),
    );

    // The service moves the thread with its words on the save, so it is anchored on Flow's heading as the save wrote it.
    const saved = `## Context\n\nOnly an admin can add someone.\n\n${TYPED}\n\n## Flow\n\nThe invite ends here.\n`;
    const threads = [{ at: saved.indexOf("## Flow"), onOpen: () => undefined }];
    const opened = { markdown: OPENED, spans: readSpans(read) };
    const spans = anchoredSpans(saved, opened, keptWrites(wrote, []));

    const counted =
      spans === undefined
        ? []
        : blockThreads(spans, {
            markdown: saved,
            threads,
            heard: (count) => `${count} comment`,
            onComment: () => undefined,
          }).marks;

    // Flow's heading is the third block of the description as opened, the one the field's lines name it by.
    expect(counted).toEqual([{ block: 2, count: 1, heard: "1 comment" }]);
  });
});
