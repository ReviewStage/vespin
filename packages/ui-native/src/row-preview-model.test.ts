import { ANSWER_TONE } from "@repo/features/inbox-list-model";
import { CALL_KIND } from "@repo/features/turn-rows";
import { describe, expect, it } from "vitest";
import { latestStep, previewMessages } from "./row-preview-model.js";
import {
  CALL_STANDING,
  TRANSCRIPT_ITEM,
  TRANSCRIPT_PIECE,
  type TranscriptItem,
} from "./transcript-model.js";

const PLACE = { message: "turn", row: "row", member: undefined, piece: TRANSCRIPT_PIECE.LINE };

function message(id: string, words: string, stamp?: string) {
  return {
    id,
    writer: { name: "Ada", agent: false },
    at: 1,
    words,
    typed: true,
    media: [],
    drawn: [],
    ...(stamp !== undefined && { stamp: { tone: ANSWER_TONE.AHEAD, words: stamp } }),
  };
}

describe("previewMessages", () => {
  it("keeps the newest three that say something, as plain words with an answer's stamp first", () => {
    const said = previewMessages([
      message("oldest", "Too old to show."),
      message("first", "The **plan** is ready."),
      message("file", ""),
      message("answer", "and say it in the docs", "Chose 7 days"),
      message("newest", "Merged."),
    ]);

    expect(said.map(({ id, words }) => [id, words])).toEqual([
      ["first", "The plan is ready."],
      ["answer", "Chose 7 days · and say it in the docs"],
      ["newest", "Merged."],
    ]);
  });
});

describe("latestStep", () => {
  it("says the agent's last call, passing over the working line and a line sent to it", () => {
    const items: readonly TranscriptItem[] = [
      { place: PLACE, depth: 0, kind: TRANSCRIPT_ITEM.WORDS, words: "Reading the code." },
      {
        place: PLACE,
        depth: 0,
        kind: TRANSCRIPT_ITEM.CALL,
        callId: "call",
        callKind: CALL_KIND.READ_FILE,
        line: { verb: "Read", subject: "list-row.tsx", code: true },
        chip: undefined,
        runOn: undefined,
        standing: CALL_STANDING.DONE,
        open: false,
        body: [],
      },
      {
        place: PLACE,
        depth: 0,
        kind: TRANSCRIPT_ITEM.SAID,
        words: "Hurry up",
        sender: undefined,
        sent: undefined,
      },
      { place: PLACE, depth: 0, kind: TRANSCRIPT_ITEM.WORKING, words: "Working" },
    ];

    expect(latestStep(items)).toBe("Read list-row.tsx");
  });
});
