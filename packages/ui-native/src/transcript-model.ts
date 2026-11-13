/**
 * transcript-model.ts -- an agent's transcript as the iPhone's one lazy list draws it: each row an item of its own, read from the panel's own parts and folds.
 *
 * What a message's parts are, how a turn folds, and how each call is named
 * are the panel's (`@repo/features/agent-parts`, `turn-rows`,
 * `tool-call-model`), read here as they are read there; this only lays the
 * rows out flat, one item each, so the list draws each lazily. A group of
 * calls stands as one line, and the rows it holds follow it as items of
 * their own while it stands open, set in a step. A call is one line that
 * opens in place to its body. What the agent thought is left out, as the
 * phone has no room for it. A finished turn ends on how long it worked, and
 * the transcript on Working… while its agent works. The pictures and the
 * recordings it showed, and those a call answered and the service kept (a
 * browser's screenshots, an integration's pictures), stand under the call
 * that showed them, a page it
 * showed as a card under its line, which opens it whole, and a pull request
 * it opened as the pull request's card, as it stands now where the task list
 * holds it. A call whose answer its page carried cut is read whole as it
 * opens, as the panel's is (`AGENTS_PART`): its body says so while the read
 * is under way, draws the call read whole once it lands, and its two ends
 * where it could not be read.
 */

import {
  AGENT_PART,
  type AgentPart,
  type AgentPartCut,
  agentRows,
  CUT_PART_WORDS,
  cutPartText,
  messageWords,
  placedMessages,
  turnStretches,
  WHOLE_PART,
  type WholePartRead,
  wholeCallOf,
} from "@repo/features/agent-parts";
import {
  calledPicturesOf,
  recordedVideosOf,
  shownPicturesOf,
} from "@repo/features/agent-pictures-model";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { SendingMessage } from "@repo/features/agent-view";
import {
  type AgentOrigin,
  type AgentPullRequest,
  type AgentTranscriptMessage,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { fileName } from "@repo/features/code-ref-words";
import { isVideoType } from "@repo/features/conversation-picture-wire";
import { INTEGRATION_NAME } from "@repo/features/integration-wire";
import { type PullRequestMarkState, pullRequestMarkState } from "@repo/features/pull-request-model";
import { SUGGESTION_LEAD, suggestionWords } from "@repo/features/reply-button-wire";
import { callHeading, WORKING_LINE, workedForText } from "@repo/features/time-format";
import {
  BLOCK_TITLE,
  COMMAND_PROMPT,
  NO_OUTPUT,
  readableBlock,
  shownOutput,
  TOOL_BLOCK,
  TOOL_STATE,
  type ToolBlock,
  type ToolState,
} from "@repo/features/tool-call-block";
import { shownPageVersion, type ToolCallView, toolCallView } from "@repo/features/tool-call-model";
import { suggestedByOf, suggestionStartOf } from "@repo/features/transcript-lines";
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
import { isRecord, isWireNumber, isWireString, MESSAGE_ROLE } from "@repo/wire";

/** The kinds of item the transcript's list draws. */
export const TRANSCRIPT_ITEM = {
  /** A line someone sent the agent: the reader's, a teammate's, or another sender's. */
  SAID: "said",
  /** The agent's own words, in Markdown. */
  WORDS: "words",
  /** One tool call, its line, and its body where it stands open. */
  CALL: "call",
  /** A run of calls, as one line that opens on the rows it holds. */
  FOLD: "fold",
  /** The pictures or recordings a call showed, under its line. */
  MEDIA: "media",
  /** A page a call showed, as a card that opens it whole. */
  PAGE: "page",
  /** A pull request a call opened, as its card. */
  PULL_REQUEST: "pull-request",
  /** The quiet line a finished turn ends on: how long it worked and when it ended. */
  FOOT: "foot",
  /** The line the transcript ends on while its agent works. */
  WORKING: "working",
} as const;

/** Which piece of a row an item draws: its line, the page it showed, or what it showed. */
export const TRANSCRIPT_PIECE = {
  LINE: "line",
  PAGE: "page",
  PULL_REQUEST: "pull-request",
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
  /** The words drawn under it; empty for none. */
  readonly caption: string;
  /** What it is heard as: its caption, or where it has none its name among the call's (`screenshot-1`), as the panel's viewer names it. */
  readonly label: string;
  readonly video: boolean;
}

/** One part of the line naming who sent a line: words before it and after it in the muted ink, such as "Suggested by" and who started an agent, where it has any; its words; and the address a press opens, where it has one. */
export interface OriginPart {
  readonly lead?: string | undefined;
  readonly words: string;
  readonly after?: string | undefined;
  readonly address: string | undefined;
}

/**
 * What an automation's agent's transcript opens on, as the panel's card
 * draws it: the automation's prompt alone, in place of the first line's
 * words, which carry the lines we add of the firing; who sent it, the
 * automation, then what its run was about and who asked for it; and a
 * webhook call's body, folded under it.
 */
export interface TranscriptOrigin {
  /** The automation's prompt alone; none until the run is read, when the first line's own words stand. */
  readonly prompt: string | undefined;
  readonly from: readonly OriginPart[];
  readonly body: string | undefined;
}

export type TranscriptItem = { readonly place: TranscriptPlace; readonly depth: number } & (
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.SAID;
      readonly words: string;
      /** Who sent it, where the reader did not. */
      readonly sender: string | undefined;
      /** Who sent an automation's prompt, or the agent whose suggestion a line was sent from, part by part; it stands over the sender. */
      readonly from?: readonly OriginPart[] | undefined;
      /** A webhook call's body, which rode in with an automation's prompt. */
      readonly body?: string | undefined;
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
      /** Where it stands open with an answer its page carried cut whose whole read has not settled: the part to read whole. */
      readonly cut: AgentPartCut | undefined;
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
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.PULL_REQUEST;
      readonly number: number;
      readonly title: string;
      /** Its own page on GitHub. */
      readonly url: string;
      /** Where its mark says it stands: queued where it is open and the merge queue holds it. */
      readonly state: PullRequestMarkState;
      /** The lines it adds and removes, where the task list holds it. */
      readonly additions: number | undefined;
      readonly deletions: number | undefined;
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
  /** The pull requests the agent opened as the task list holds them now, which a card opened by a call stands as. */
  readonly pullRequests: readonly AgentPullRequest[];
  /** How the whole read of a part its page carried cut stands, where it was asked; none where it was not yet. */
  readonly wholePart?: ((cut: AgentPartCut) => WholePartRead | undefined) | undefined;
  /** What the transcript opens on where an automation's run started the agent, drawn on its first line; none for any other agent, or while older pages are still unread. */
  readonly origin?: TranscriptOrigin | undefined;
  /** The address of an agent whose suggestion a line was sent from, which the line's head opens; none where it can't be named, when the head names the agent alone. */
  readonly suggestionAddress?: ((agentId: string) => string | undefined) | undefined;
}

/** What an automation is called where it can't be named: by the panel's words (`namedAutomationActor`). */
const ORIGIN_WORDS = {
  AUTOMATION: "Automation",
  DELETED: "(deleted)",
  RUN_BY: "Run by",
  ISSUE: "issue",
} as const;

/** How many lines of a call's block its card draws, as the panel's card cuts one. */
const BLOCK_LINES = 40;

/** What the block a failed call's body ends with is headed. */
const ERROR_TITLE = "Error";

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

/**
 * A call's body as its cards draw it: a command and what it printed as one
 * terminal, or what it was given and what it answered; then the error it
 * ended in. What it answered is cut to the lines a card draws unless it is
 * `whole`, as an answer its page carried cut is drawn once read whole, and
 * its two ends where that read failed.
 */
function callBody(
  input: ToolBlock,
  output: ToolBlock | undefined,
  errorText: string | undefined,
  whole = false,
): readonly CallBodyBlock[] {
  const answered = whole ? (text: string) => text.trimEnd() : cutLines;
  const error = errorText === undefined ? [] : [{ title: ERROR_TITLE, text: errorText }];

  if (input.kind === TOOL_BLOCK.COMMAND) {
    const printed = output === undefined ? "" : readableBlock(output).text.trimEnd();
    const prompt = `${COMMAND_PROMPT}${input.text}`;

    return [
      {
        title: BLOCK_TITLE.TERMINAL,
        text: answered(printed === "" ? prompt : `${prompt}\n${printed}`),
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
            text: shown.text.trim() === "" ? NO_OUTPUT : answered(shown.text),
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

/** What the line under a suggestion's card says of who started the agent from it, after the suggesting agent, as the panel's says it. */
const STARTED_BY = {
  YOU: ", started by you",
  MEMBER: (name: string) => `, started by ${name}`,
} as const;

/**
 * Who a line sent from a suggestion came from, as the panel heads it: Suggested
 * by the agent whose reply held it, opening that agent; and, on the first
 * line of an agent started from it, who started it, the reader where it is
 * their own, in the sender's place. None for any other line. Note that the
 * line's own metadata says so, as on the panel, so no experiment gates it:
 * only a send from a suggestion writes one.
 */
function suggestionFrom(
  line: AgentTranscriptMessage,
  reading: TranscriptReading,
  sender: string | undefined,
): readonly OriginPart[] | undefined {
  const suggestedBy = suggestedByOf(line);

  if (suggestedBy === undefined) return undefined;

  const by = {
    lead: SUGGESTION_LEAD,
    words: suggestedBy.name,
    address: reading.suggestionAddress?.(suggestedBy.agent_id),
  };

  if (suggestionStartOf(line) === undefined) return [by];

  return [{ ...by, after: sender === undefined ? STARTED_BY.YOU : STARTED_BY.MEMBER(sender) }];
}

/** A line someone sent, as its item: one sent from a suggestion headed by who suggested it, its words without the lead that names that agent to the agent reading them. */
function saidItem(
  line: AgentTranscriptMessage,
  base: ItemBase,
  reading: TranscriptReading,
): TranscriptItem {
  const sender =
    line.sentBy === undefined || line.sentBy.userId === reading.readerId
      ? undefined
      : line.sentBy.name;

  const from = suggestionFrom(line, reading, sender);
  const words = messageWords(line);
  // Note that a started agent's first line names who started it in its head, so its sender stands nowhere else.
  const started = from !== undefined && suggestionStartOf(line) !== undefined;

  return {
    ...base,
    kind: TRANSCRIPT_ITEM.SAID,
    words: from === undefined ? words : suggestionWords(words),
    sender: started ? undefined : sender,
    from,
    sent: line.sentAt === undefined ? undefined : callHeading(line.sentAt, reading.now),
  };
}

/** An automation's prompt as its agent's first line, in place of the line's own words and sender. */
function originItem(
  line: AgentTranscriptMessage,
  base: ItemBase,
  reading: TranscriptReading,
  origin: TranscriptOrigin,
): TranscriptItem {
  return {
    ...base,
    kind: TRANSCRIPT_ITEM.SAID,
    words: origin.prompt ?? messageWords(line),
    sender: undefined,
    sent: line.sentAt === undefined ? undefined : callHeading(line.sentAt, reading.now),
    from: origin.from,
    body: origin.body,
  };
}

/**
 * What an automation's agent's transcript opens on, from the run that
 * started it (`AGENTS_ORIGIN_FOLLOW`), as the panel's `AutomationSender`
 * names it: the automation, opening `automationAddress` where it still
 * stands, "Name (deleted)" once it's gone, and "Automation" where no name
 * was kept; then the issue or pull request its GitHub event named, or the
 * issue its integration's event was about, each opening its address; and
 * who asked for a run now. None of the run is known while it's unread.
 */
export function transcriptOriginOf(input: {
  readonly automationId: string | undefined;
  readonly automationName: string | undefined;
  readonly automationAddress: string | undefined;
  readonly run: AgentOrigin | undefined;
}): TranscriptOrigin {
  const { automationId, automationName, run } = input;

  const automation =
    automationId === undefined && automationName !== undefined
      ? `${automationName} ${ORIGIN_WORDS.DELETED}`
      : (automationName ?? ORIGIN_WORDS.AUTOMATION);

  const subject = run?.subject;
  const issue = run?.issue;

  const from: readonly (OriginPart | undefined)[] = [
    {
      words: automation,
      address: automationId === undefined ? undefined : input.automationAddress,
    },
    subject === undefined
      ? undefined
      : {
          words:
            subject.title === undefined
              ? `#${subject.number}`
              : `#${subject.number} ${subject.title}`,
          address: subject.url,
        },
    issue === undefined
      ? undefined
      : {
          words: issue.title ?? `${INTEGRATION_NAME[issue.provider]} ${ORIGIN_WORDS.ISSUE}`,
          address: issue.url,
        },
    run?.runBy === undefined
      ? undefined
      : { words: `${ORIGIN_WORDS.RUN_BY} ${run.runBy.name}`, address: undefined },
  ];

  return {
    prompt: run?.prompt,
    from: from.filter((part) => part !== undefined),
    body: run?.body,
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

/**
 * The pull request a call opened, as its card stands: as the task list holds
 * it now where it holds it, and otherwise as the call opened it, a draft or
 * open, with no line counts; none for a call that opened none.
 */
function openedPullRequest(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
  base: ItemBase,
  pullRequests: readonly AgentPullRequest[],
): readonly TranscriptItem[] {
  const { input, output } = part;

  if (part.tool !== AGENT_TOOL.OPEN_PULL_REQUEST || !isRecord(output)) return [];
  const { number, url } = output;

  if (!isWireNumber(number) || !isWireString(url)) return [];
  const place = pieceOf(base.place, TRANSCRIPT_PIECE.PULL_REQUEST);
  const held = pullRequests.find((each) => each.number === number && each.url === url);

  if (held !== undefined) {
    const { title, additions, deletions } = held;
    const state = pullRequestMarkState(held);
    const kind = TRANSCRIPT_ITEM.PULL_REQUEST;

    return [{ ...base, place, kind, number, title, url, state, additions, deletions }];
  }

  const title = isRecord(input) && isWireString(input.title) ? input.title : "";
  const draft = isRecord(input) && input.draft === true;

  return [
    {
      ...base,
      place,
      kind: TRANSCRIPT_ITEM.PULL_REQUEST,
      number,
      title,
      url,
      state: draft ? PULL_REQUEST_STATE.DRAFT : PULL_REQUEST_STATE.OPEN,
      additions: undefined,
      deletions: undefined,
    },
  ];
}

/**
 * An open call's answer its page carried cut, as its body draws it: the call
 * read whole once its read lands and answers the same call; until then the
 * words saying it is read, and its two ends where the read failed or
 * answered some other part.
 */
function wholeRead(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
  cut: AgentPartCut,
  reading: TranscriptReading,
):
  | {
      readonly whole: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
      readonly output?: never;
      readonly reading?: never;
    }
  | { readonly whole?: never; readonly output: ToolBlock; readonly reading: boolean } {
  const read = reading.wholePart?.(cut);
  const whole = read?.state === WHOLE_PART.WHOLE ? wholeCallOf(read.part, part.callId) : undefined;

  if (whole !== undefined) return { whole };
  const failed = read?.state === WHOLE_PART.FAILED || read?.state === WHOLE_PART.WHOLE;

  return {
    output: { kind: TOOL_BLOCK.TEXT, text: failed ? cutPartText(cut) : CUT_PART_WORDS.OUTPUT },
    reading: !failed,
  };
}

/** One tool call as its items: its line, then what it showed. */
function callItems(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
  base: ItemBase,
  reading: TranscriptReading,
): readonly TranscriptItem[] {
  const { toggles } = reading;
  const shownSet = showedPictures(part);
  const pictures = shownSet ? shownPicturesOf(part.input, part.output) : [];

  const media: readonly ShownMedia[] = [
    ...pictures.flatMap(({ picture, caption, name }) =>
      picture === undefined
        ? []
        : [
            {
              id: picture.id,
              caption,
              label: caption === "" ? name : caption,
              video: isVideoType(picture.mediaType),
            },
          ],
    ),
    ...recordedVideosOf(part.tool, part.output).map(({ picture, caption, name }) => ({
      id: picture.id,
      caption,
      label: caption === "" ? name : caption,
      video: true,
    })),
    // Note that a picture a call answered that was not kept has no bytes to draw, so it is left out.
    ...calledPicturesOf(part.tool, part.input, part.output).flatMap((called) =>
      called.kept
        ? [
            {
              id: called.picture.id,
              caption: "",
              label: called.name,
              video: isVideoType(called.picture.mediaType),
            },
          ]
        : [],
    ),
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
  const open = toggles.calls.has(part.callId);
  const read = open && part.cut !== undefined ? wholeRead(part, part.cut, reading) : undefined;
  const drawn = read?.whole ?? part;
  const view = toolCallView({ tool: drawn.tool, input: drawn.input, output: drawn.output });

  const shown = shownPageVersion({
    tool: part.tool,
    callId: part.callId,
    input: part.input,
    output: part.output,
  });

  const call: TranscriptItem = {
    ...base,
    kind: TRANSCRIPT_ITEM.CALL,
    callId: part.callId,
    callKind: view.kind,
    ...callNaming(view),
    runOn: callPlace(view.kind, view.server),
    standing: standingOf(part.state),
    open,
    body: open
      ? callBody(view.input, read?.output ?? view.output, drawn.errorText, read !== undefined)
      : [],
    cut: read?.reading === true ? part.cut : undefined,
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

  return [call, ...page, ...openedPullRequest(part, base, reading.pullRequests), ...mediaItem];
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
      return callItems(part, base, reading);
    case AGENT_PART.ARRIVED:
      return [saidItem(part.line, base, reading)];
    default:
      return [];
  }
}

/** A turn's rows as items, a group's rows after its line while it stands open. */
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
    const open = row.open !== foldTurned(reading.toggles, base.place);

    const line: TranscriptItem = {
      ...base,
      kind: TRANSCRIPT_ITEM.FOLD,
      summary: row.summary,
      open,
      running: row.running,
    };

    if (!open) return [line];

    const held = row.blocks.flatMap((block, at) =>
      partItems(block, { place: { ...base.place, member: at }, depth: depth + 1 }, reading),
    );

    return [line, ...held];
  });
}

/**
 * The transcript with the member's messages on their way at its end, each
 * as their own line under the id its row lands under, so the row takes its
 * place, as the host draws them (`AppTranscript.sending`); a message the
 * service refused is the composer's to give back, and stands nowhere here.
 */
export function withSending(
  messages: readonly AgentTranscriptMessage[],
  sending: readonly SendingMessage[],
): readonly AgentTranscriptMessage[] {
  const going = sending.filter((message) => message.refused === undefined);

  if (going.length === 0) return messages;

  return [
    ...messages,
    ...going.map(
      (message): AgentTranscriptMessage => ({
        id: message.id,
        role: MESSAGE_ROLE.USER,
        parts: [{ type: AGENT_PART.TEXT, text: message.text }],
        sentAt: message.sentAt,
      }),
    ),
  ];
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
  const { origin } = reading;

  // Note that an automation's prompt is the first line anyone sent, which the run's card stands in place of.
  const head =
    origin === undefined
      ? undefined
      : placed.find(({ message }) => message.role === MESSAGE_ROLE.USER)?.message.id;

  const items = placed.flatMap(({ message, arrived }, at): readonly TranscriptItem[] => {
    if (message.role === MESSAGE_ROLE.USER) {
      const base = { place: linePlace(message.id, message.id), depth: 0 };

      return [
        origin !== undefined && message.id === head
          ? originItem(message, base, reading, origin)
          : saidItem(message, base, reading),
      ];
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

/** The parts of every open call whose answer its page carried cut and whose whole read has not settled, which the page reads whole. */
export function openCuts(items: readonly TranscriptItem[]): readonly AgentPartCut[] {
  return items.flatMap((item) =>
    item.kind === TRANSCRIPT_ITEM.CALL && item.cut !== undefined ? [item.cut] : [],
  );
}

/** The ids of every picture and recording the items show, which the list reads the bytes of. */
export function shownMediaIds(items: readonly TranscriptItem[]): readonly string[] {
  return items.flatMap((item) =>
    item.kind === TRANSCRIPT_ITEM.MEDIA ? item.media.map(({ id }) => id) : [],
  );
}
