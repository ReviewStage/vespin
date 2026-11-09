/**
 * transcript-model.ts -- an agent's transcript as the iPhone's one lazy list draws it: each row an item of its own, read from the panel's own parts and folds.
 *
 * What a message's parts are, how a turn folds, and how each call is named
 * are the panel's (`@repo/features/agent-parts`, `turn-rows`,
 * `tool-call-model`), read here as they are read there; this only lays the
 * rows out flat, one item each, so the list draws each lazily. A fold or a
 * group stands as one line, and the rows it holds follow it as items of
 * their own while it stands open, set in a step. A call is one line that
 * opens in place to its body. What the agent thought is left out, as the
 * phone has no room for it. A finished turn ends on how long it worked, and
 * the transcript on Working… while its agent works. The pictures and the recordings it showed
 * stand under the call that showed them, and a page it showed as a card
 * under its line, which opens it whole.
 */

import {
  AGENT_PART,
  type AgentPart,
  agentRows,
  messageWords,
  placedMessages,
  turnStretches,
} from "@repo/features/agent-parts";
import { recordedVideosOf, shownPicturesOf } from "@repo/features/agent-pictures-model";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { fileName } from "@repo/features/code-ref-words";
import { isVideoType } from "@repo/features/conversation-picture-wire";
import { callHeading, WORKING_LINE, workedForText } from "@repo/features/time-format";
import {
  COMMAND_PROMPT,
  readableBlock,
  shownOutput,
  TOOL_BLOCK,
  TOOL_STATE,
  type ToolBlock,
  type ToolState,
} from "@repo/features/tool-call-block";
import { shownPageVersion, type ToolCallView, toolCallView } from "@repo/features/tool-call-model";
import {
  CALL_KIND,
  type CallKind,
  type CallLine,
  calledFile,
  callLine,
  callPlace,
  isMadeCallKind,
  madeCallLine,
  moreFiles,
  siteName,
  TURN_ROW,
  type TurnRow,
} from "@repo/features/turn-rows";
import { isRecord, MESSAGE_ROLE } from "@repo/wire";

/** The kinds of item the transcript's list draws. */
export const TRANSCRIPT_ITEM = {
  /** A line someone sent the agent: the reader's, a teammate's, or another sender's. */
  SAID: "said",
  /** The agent's own words, in Markdown. */
  WORDS: "words",
  /** One tool call, its line, and its body where it stands open. */
  CALL: "call",
  /** A run of calls, or a finished turn's lead, as one line that opens on the rows it holds. */
  FOLD: "fold",
  /** The pictures or recordings a call showed, under its line. */
  MEDIA: "media",
  /** A page a call showed, as a card that opens it whole. */
  PAGE: "page",
  /** The quiet line a finished turn ends on: how long it worked and when it ended. */
  FOOT: "foot",
  /** The line the transcript ends on while its agent works. */
  WORKING: "working",
} as const;

/** Which piece of a row an item draws: its line, the page it showed, or what it showed. */
export const TRANSCRIPT_PIECE = {
  LINE: "line",
  PAGE: "page",
  MEDIA: "media",
  FOOT: "foot",
  WORKING: "working",
} as const;

export type TranscriptPiece = (typeof TRANSCRIPT_PIECE)[keyof typeof TRANSCRIPT_PIECE];

/** Where an item stands among the list's: its turn's message, its row in that turn, the block within a group where it is one, and the piece of it drawn. */
export interface TranscriptPlace {
  readonly message: string;
  readonly row: string;
  readonly member: number | undefined;
  readonly piece: TranscriptPiece;
}

/** Where a call stands, as its line's end mark says it. */
export const CALL_STANDING = {
  RUNNING: "running",
  FAILED: "failed",
  DONE: "done",
} as const;

export type CallStanding = (typeof CALL_STANDING)[keyof typeof CALL_STANDING];

/** One block of an open call's body, as its card draws it: its title, its words, and whether they are code. */
export interface CallBodyBlock {
  readonly title: string;
  readonly text: string;
}

/** One picture or recording a call showed, by the id the service kept it under. */
export interface ShownMedia {
  readonly id: string;
  readonly caption: string;
  readonly video: boolean;
}

export type TranscriptItem = { readonly place: TranscriptPlace; readonly depth: number } & (
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.SAID;
      readonly words: string;
      /** Who sent it, where the reader did not. */
      readonly sender: string | undefined;
      /** When it was sent, as a call's header says the day and the time; none where the row kept no time. */
      readonly sent: string | undefined;
    }
  | { readonly kind: typeof TRANSCRIPT_ITEM.WORDS; readonly words: string }
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.CALL;
      /** The call's id, which opens and closes it. */
      readonly callId: string;
      readonly callKind: CallKind;
      readonly line: CallLine;
      /** What the call made or is about, named after the line's verb as the panel's chip names it. */
      readonly chip: string | undefined;
      /** Where it ran, beside its line, where it ran somewhere the transcript does not say. */
      readonly runOn: string | undefined;
      readonly standing: CallStanding;
      readonly open: boolean;
      /** Its body's blocks while it stands open: what it was given and what it answered, or the error it ended in. */
      readonly body: readonly CallBodyBlock[];
    }
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.FOLD;
      readonly summary: string;
      readonly open: boolean;
      readonly running: boolean;
    }
  | { readonly kind: typeof TRANSCRIPT_ITEM.MEDIA; readonly media: readonly ShownMedia[] }
  | { readonly kind: typeof TRANSCRIPT_ITEM.FOOT; readonly words: string }
  | { readonly kind: typeof TRANSCRIPT_ITEM.WORKING; readonly words: string }
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.PAGE;
      readonly title: string;
      readonly page: string;
      readonly version: number;
    }
);

/** Which folds the reader turned from how they stand on their own, by their turn and then their row, and which calls they opened, by the call. */
export interface TranscriptToggles {
  readonly folds: ReadonlyMap<string, ReadonlySet<string>>;
  readonly calls: ReadonlySet<string>;
}

/** Nothing turned. */
export const NO_TOGGLES: TranscriptToggles = { folds: new Map(), calls: new Set() };

/** How a transcript is read for its list. */
export interface TranscriptReading {
  /** Whether the agent may still write, so its newest turn moves. */
  readonly writing: boolean;
  /** The reader, whose own lines name no sender. */
  readonly readerId: string | undefined;
  readonly toggles: TranscriptToggles;
  /** What the times count from. */
  readonly now: number;
}

/** How many lines of a call's block its card draws, as the panel's card cuts one. */
const BLOCK_LINES = 40;

/** What a call's body says where it answered nothing. */
const NO_OUTPUT = "No output";

/** What each block of a call's body is headed, as the panel's cards head them. */
const BLOCK_TITLE = {
  INPUT: "Input",
  OUTPUT: "Output",
  TERMINAL: "Terminal",
  ERROR: "Error",
} as const;

/** A block's words cut to the lines its card draws. */
function cutLines(text: string): string {
  const lines = text.trimEnd().split("\n");
  return lines.length <= BLOCK_LINES ? lines.join("\n") : lines.slice(0, BLOCK_LINES).join("\n");
}

/** Whether a reader turned a fold from how it stands on its own. */
function foldTurned(toggles: TranscriptToggles, place: TranscriptPlace): boolean {
  return toggles.folds.get(place.message)?.has(place.row) === true;
}

/** An item's place with another piece of its row. */
function pieceOf(place: TranscriptPlace, piece: TranscriptPiece): TranscriptPlace {
  return { ...place, piece };
}

/** A call's body as its cards draw it: a command and what it printed as one terminal, or what it was given and what it answered; then the error it ended in. */
function callBody(
  input: ToolBlock,
  output: ToolBlock | undefined,
  errorText: string | undefined,
): readonly CallBodyBlock[] {
  const error = errorText === undefined ? [] : [{ title: BLOCK_TITLE.ERROR, text: errorText }];
  if (input.kind === TOOL_BLOCK.COMMAND) {
    const printed = output === undefined ? "" : readableBlock(output).text.trimEnd();
    const prompt = `${COMMAND_PROMPT}${input.text}`;
    return [
      {
        title: BLOCK_TITLE.TERMINAL,
        text: cutLines(printed === "" ? prompt : `${prompt}\n${printed}`),
      },
      ...error,
    ];
  }
  const given = readableBlock(input).text;
  const shown = output === undefined ? undefined : shownOutput(output);
  const answer =
    errorText !== undefined || shown === undefined
      ? []
      : [
          {
            title: BLOCK_TITLE.OUTPUT,
            text: shown.text.trim() === "" ? NO_OUTPUT : cutLines(shown.text),
          },
        ];
  return [
    ...(given === "" ? [] : [{ title: BLOCK_TITLE.INPUT, text: cutLines(given) }]),
    ...answer,
    ...error,
  ];
}

/** Where a call stands by its state. */
function standingOf(state: ToolState): CallStanding {
  if (state === TOOL_STATE.OUTPUT_ERROR) return CALL_STANDING.FAILED;
  return state === TOOL_STATE.OUTPUT_AVAILABLE ? CALL_STANDING.DONE : CALL_STANDING.RUNNING;
}

/** Whether a call is a set of pictures shown, which draws as its pictures. */
function showedPictures(part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>): boolean {
  return (
    part.tool === AGENT_TOOL.SHOW_IMAGE &&
    part.state === TOOL_STATE.OUTPUT_AVAILABLE &&
    isRecord(part.output) &&
    part.output.status === "accepted"
  );
}

type ItemBase = Pick<TranscriptItem, "place" | "depth">;

/** A line someone sent, as its item. */
function saidItem(
  line: AgentTranscriptMessage,
  base: ItemBase,
  reading: TranscriptReading,
): TranscriptItem {
  const sender =
    line.sentBy === undefined || line.sentBy.userId === reading.readerId
      ? undefined
      : line.sentBy.name;
  return {
    ...base,
    kind: TRANSCRIPT_ITEM.SAID,
    words: messageWords(line),
    sender,
    sent: line.sentAt === undefined ? undefined : callHeading(line.sentAt, reading.now),
  };
}

/** A line's place in the list: its own row, in the turn it stands in. */
function linePlace(message: string, row: string): TranscriptPlace {
  return { message, row, member: undefined, piece: TRANSCRIPT_PIECE.LINE };
}

/**
 * How a call's line names what it did, as the panel's row does: a call that
 * made something by that thing's chip after its verb; a read or a write by
 * its first file's chip and how many more it named; a page read by its
 * site's chip; and any other by its verb and subject.
 */
function callNaming(
  view: ToolCallView,
): Pick<Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.CALL }>, "line" | "chip"> {
  if (isMadeCallKind(view.kind)) {
    return { line: madeCallLine(view.kind), chip: view.subject === "" ? undefined : view.subject };
  }
  const file = calledFile(view.kind, view.files);
  const site =
    view.kind === CALL_KIND.WEB_PAGE && view.page !== undefined ? siteName(view.page) : undefined;
  const chip = file === undefined ? site : fileName(file);
  if (chip === undefined) {
    return { line: callLine(view.kind, view.subject, view.description), chip: undefined };
  }
  return { line: { ...callLine(view.kind, moreFiles(view.files), undefined), code: false }, chip };
}

/** One tool call as its items: its line, then what it showed. */
function callItems(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
  base: ItemBase,
  toggles: TranscriptToggles,
): readonly TranscriptItem[] {
  const shownSet = showedPictures(part);
  const pictures = shownSet ? shownPicturesOf(part.input, part.output) : [];
  const media: readonly ShownMedia[] = [
    ...pictures.flatMap(({ picture, caption }) =>
      picture === undefined
        ? []
        : [{ id: picture.id, caption, video: isVideoType(picture.mediaType) }],
    ),
    ...recordedVideosOf(part.tool, part.output).map(({ picture, caption }) => ({
      id: picture.id,
      caption,
      video: true,
    })),
  ];
  const mediaItem: readonly TranscriptItem[] =
    media.length === 0
      ? []
      : [
          {
            ...base,
            place: pieceOf(base.place, TRANSCRIPT_PIECE.MEDIA),
            kind: TRANSCRIPT_ITEM.MEDIA,
            media,
          },
        ];
  // Note that a set of pictures shown stands as its pictures alone, as the panel draws it.
  if (shownSet) return mediaItem;
  const view = toolCallView({ tool: part.tool, input: part.input, output: part.output });
  const shown = shownPageVersion({
    tool: part.tool,
    callId: part.callId,
    input: part.input,
    output: part.output,
  });
  const open = toggles.calls.has(part.callId);
  const call: TranscriptItem = {
    ...base,
    kind: TRANSCRIPT_ITEM.CALL,
    callId: part.callId,
    callKind: view.kind,
    ...callNaming(view),
    runOn: callPlace(view.kind, view.server),
    standing: standingOf(part.state),
    open,
    body: open ? callBody(view.input, view.output, part.errorText) : [],
  };
  const page: readonly TranscriptItem[] =
    shown === undefined
      ? []
      : [
          {
            ...base,
            place: pieceOf(base.place, TRANSCRIPT_PIECE.PAGE),
            kind: TRANSCRIPT_ITEM.PAGE,
            title: view.subject,
            page: shown.page,
            version: shown.version,
          },
        ];
  return [call, ...page, ...mediaItem];
}

/** One part as its items; none for what the agent thought, or a part with nothing to draw. */
function partItems(
  part: AgentPart,
  base: ItemBase,
  reading: TranscriptReading,
): readonly TranscriptItem[] {
  switch (part.kind) {
    case AGENT_PART.TEXT:
      return part.text.trim() === ""
        ? []
        : [{ ...base, kind: TRANSCRIPT_ITEM.WORDS, words: part.text }];
    case AGENT_PART.TOOL:
      return callItems(part, base, reading.toggles);
    case AGENT_PART.ARRIVED:
      return [saidItem(part.line, base, reading)];
    default:
      return [];
  }
}

/** A turn's rows as items, a fold's or a group's rows after its line while it stands open. */
function rowItems(
  rows: readonly TurnRow<AgentPart>[],
  message: string,
  depth: number,
  reading: TranscriptReading,
): readonly TranscriptItem[] {
  return rows.flatMap((row): readonly TranscriptItem[] => {
    const base = {
      place: { message, row: row.key, member: undefined, piece: TRANSCRIPT_PIECE.LINE },
      depth,
    };
    if (row.kind === TURN_ROW.BLOCK) return partItems(row.block, base, reading);
    const standsOpen = row.kind === TURN_ROW.GROUP ? row.open : false;
    const open = standsOpen !== foldTurned(reading.toggles, base.place);
    const line: TranscriptItem = {
      ...base,
      kind: TRANSCRIPT_ITEM.FOLD,
      summary: row.summary,
      open,
      running: row.kind === TURN_ROW.GROUP && row.running,
    };
    if (!open) return [line];
    const held =
      row.kind === TURN_ROW.GROUP
        ? row.blocks.flatMap((block, at) =>
            partItems(block, { place: { ...base.place, member: at }, depth: depth + 1 }, reading),
          )
        : rowItems(row.rows, message, depth + 1, reading);
    return [line, ...held];
  });
}

/**
 * The transcript as the list's items, oldest first: each line sent, and each
 * of the agent's turns as the panel folds it, its newest moving while the
 * agent may still write, each line that reached a turn while it ran standing
 * where it arrived.
 */
export function transcriptItems(
  messages: readonly AgentTranscriptMessage[],
  reading: TranscriptReading,
): readonly TranscriptItem[] {
  const placed = placedMessages(messages);
  const items = placed.flatMap(({ message, arrived }, at): readonly TranscriptItem[] => {
    if (message.role === MESSAGE_ROLE.USER) {
      return [saidItem(message, { place: linePlace(message.id, message.id), depth: 0 }, reading)];
    }
    const moving = reading.writing && at === placed.length - 1;
    const rows = agentRows(message, moving, { arrived });
    const turn = turnStretches(rows).flatMap((stretch) =>
      stretch.line === undefined
        ? rowItems(stretch.rows, message.id, 0, reading)
        : [
            saidItem(
              stretch.line,
              { place: linePlace(message.id, stretch.line.id), depth: 0 },
              reading,
            ),
          ],
    );
    const { startedAt, finishedAt } = message;
    // Note that a turn that finished ends on how long it worked, as the panel's turn does.
    const foot: readonly TranscriptItem[] =
      moving || startedAt === undefined || finishedAt === undefined
        ? []
        : [
            {
              place: { ...linePlace(message.id, message.id), piece: TRANSCRIPT_PIECE.FOOT },
              depth: 0,
              kind: TRANSCRIPT_ITEM.FOOT,
              words: workedForText(startedAt, finishedAt, reading.now),
            },
          ];
    return [...turn, ...foot];
  });
  const last = placed.at(-1)?.message.id;
  if (!reading.writing || last === undefined) return items;
  return [
    ...items,
    {
      place: { ...linePlace(last, last), piece: TRANSCRIPT_PIECE.WORKING },
      depth: 0,
      kind: TRANSCRIPT_ITEM.WORKING,
      words: WORKING_LINE,
    },
  ];
}

/** The toggles with a fold's, by its place, or a call's, by its id, turned the other way. */
export function toggledAt(toggles: TranscriptToggles, item: TranscriptItem): TranscriptToggles {
  if (item.kind === TRANSCRIPT_ITEM.CALL) {
    const calls = new Set(toggles.calls);
    if (!calls.delete(item.callId)) calls.add(item.callId);
    return { ...toggles, calls };
  }
  const { message, row } = item.place;
  const held = new Set(toggles.folds.get(message));
  if (!held.delete(row)) held.add(row);
  return { ...toggles, folds: new Map(toggles.folds).set(message, held) };
}

/** The ids of every picture and recording the items show, which the list reads the bytes of. */
export function shownMediaIds(items: readonly TranscriptItem[]): readonly string[] {
  return items.flatMap((item) =>
    item.kind === TRANSCRIPT_ITEM.MEDIA ? item.media.map(({ id }) => id) : [],
  );
}
