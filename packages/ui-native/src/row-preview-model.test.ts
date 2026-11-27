import { AGENT_STATUS, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { ANSWER_TONE } from "@repo/features/inbox-list-model";
import { MANAGER_FACE_CHARACTER, MANAGER_FACE_COLOR } from "@repo/features/manager-face";
import { CALL_KIND } from "@repo/features/turn-rows";
import { describe, expect, it } from "vitest";
import { latestStep, managerPreview, previewMessages, previewTree } from "./row-preview-model.js";
import {
  CALL_STANDING,
  TRANSCRIPT_ITEM,
  TRANSCRIPT_PIECE,
  type TranscriptItem,
} from "./transcript-model.js";

/** A Manager's face, as the service picks one. */
const FACE = { character: MANAGER_FACE_CHARACTER.CAT, color: MANAGER_FACE_COLOR.TEAL };

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
        provider: undefined,
        appIcon: undefined,
        line: { verb: "Read", subject: "list-row.tsx", code: true },
        chip: undefined,
        thread: undefined,
        runOn: undefined,
        standing: CALL_STANDING.DONE,
        open: false,
        body: [],
        cut: undefined,
        answered: [],
      },
      {
        place: PLACE,
        depth: 0,
        kind: TRANSCRIPT_ITEM.SAID,
        words: "Hurry up",
        sender: undefined,
        received: false,
        by: undefined,
        at: undefined,
        stamp: undefined,
        joinsAbove: false,
        joinsBelow: false,
      },
      { place: PLACE, depth: 0, kind: TRANSCRIPT_ITEM.WORKING, words: "Working" },
    ];

    expect(latestStep(items)).toBe("Read list-row.tsx");
  });

  const WORDS_FIRST: TranscriptItem = {
    place: PLACE,
    depth: 0,
    kind: TRANSCRIPT_ITEM.WORDS,
    words: "Writing it up.",
  };

  it.each<{ readonly card: TranscriptItem; readonly step: string }>([
    {
      card: {
        place: PLACE,
        depth: 0,
        kind: TRANSCRIPT_ITEM.PAGE,
        title: "Invite plan",
        page: "p1",
        version: 1,
      },
      step: "Showed Invite plan",
    },
    {
      card: {
        place: PLACE,
        depth: 0,
        kind: TRANSCRIPT_ITEM.PULL_REQUEST,
        number: 12,
        title: "Resend expired invites",
        url: "https://github.com/acme/relay/pull/12",
        state: PULL_REQUEST_STATE.OPEN,
        additions: undefined,
        deletions: undefined,
      },
      step: "Opened Resend expired invites",
    },
  ])("says a call that stands as its card alone as its row would ($step)", ({ card, step }) => {
    expect(latestStep([WORDS_FIRST, card])).toBe(step);
  });
});

/** A node of a preview's tree as far as its words go. */
type Drawn = {
  readonly kind: string;
  readonly words?: string | undefined;
  readonly nodes?: readonly Drawn[] | undefined;
};

/** Every word a preview's tree draws, in the order it draws them. */
function wordsOf(node: Drawn): string[] {
  if (node.words !== undefined) return [node.words];

  return (node.nodes ?? []).flatMap(wordsOf);
}

describe("managerPreview", () => {
  it("says a resting Manager idle since it last moved, who started it, and only its counts above none", () => {
    const HOUR = 60 * 60 * 1000;
    const now = 100 * HOUR;

    const look = {
      colors: {
        GROUND: "g",
        TEXT: "t",
        TEXT_BODY: "b",
        TEXT_MUTED: "m",
        ACCENT_TEXT: "a",
        CHIP_EDGE: "e",
        WELL: "w",
        DANGER: "d",
      },
      tone: () => "tone",
      scale: 1,
      dark: false,
      pixelRatio: 2,
      now,
    };

    const tree = previewTree(
      managerPreview({
        name: "Frontend Manager",
        face: FACE,
        status: AGENT_STATUS.COMPLETED,
        archived: false,
        movedAt: now - 2 * HOUR,
        model: "Opus 5.5",
        startedBy: { name: "Ada Lovelace", you: true, at: now - 48 * HOUR },
        counts: [{ label: "Agents at work", count: 3 }],
      }),
      look,
    );

    expect(wordsOf(tree.root)).toEqual([
      "Frontend Manager",
      "Idle · 2h · Opus 5.5",
      "Started by you · 2d ago",
      "3",
      "Agents at work",
    ]);
  });
});
