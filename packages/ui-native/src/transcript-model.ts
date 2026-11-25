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
 * that showed them, but a computer call's window, which stands in its body
 * once it is opened, as the panel's does; a page it
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
  type ComputerApps,
  CUT_PART_WORDS,
  computerAppsOf,
  cutPartText,
  messageWords,
  placedMessages,
  turnStretches,
  WHOLE_PART,
  type WholePartRead,
  wholeCallOf,
  workRows,
} from "@repo/features/agent-parts";
import {
  calledPicturesOf,
  recordedVideosOf,
  shownPicturesOf,
} from "@repo/features/agent-pictures-model";
import { AGENT_TOOL, isShowMediaTool } from "@repo/features/agent-tools";
import type { ManagerChatSending, SendingMessage } from "@repo/features/agent-view";
import {
  type AgentOrigin,
  type AgentPullRequest,
  type AgentTranscriptMessage,
  agentMessageWords,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import {
  ATTACHMENT_VIEW,
  attachmentText,
  attachmentView,
  chipBase64,
  type FileChip,
  linesLabel,
  sizeLabel,
} from "@repo/features/attachment-model";
import { fileName } from "@repo/features/code-ref-words";
import { isAudioType, isVideoType } from "@repo/features/conversation-picture-wire";
import { fileMarkers } from "@repo/features/file-marker";
import { INTEGRATION_NAME, type IntegrationProvider } from "@repo/features/integration-wire";
import { MANAGER_CHAT_AUTHOR, type ManagerChatAttachment } from "@repo/features/manager-chat-live";
import {
  CHAT_RUN_ALONE,
  type ChatRunPlace,
  chatWorkWords,
  type ManagerChatLine,
  type ManagerChatView,
  repliesWords,
} from "@repo/features/manager-chat-view";
import { type MessageFileChip, messageFileChips } from "@repo/features/message-files";
import { PICTURE_TYPE } from "@repo/features/picture-wire";
import { type PullRequestMarkState, pullRequestMarkState } from "@repo/features/pull-request-model";
import { SUGGESTION_LEAD, suggestionWords } from "@repo/features/reply-button-wire";
import {
  callHeading,
  WORKED_WORDS,
  WORKING_LINE,
  workedForText,
  workingTime,
} from "@repo/features/time-format";
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
import {
  shownPageVersion,
  TOOL_TARGET,
  type ToolCallView,
  toolCallView,
  toolTarget,
} from "@repo/features/tool-call-model";
import {
  agentMessageOf,
  type GitHubLineFold,
  githubLineFold,
  githubLineOf,
  githubLineWords,
  suggestedByOf,
  suggestionStartOf,
} from "@repo/features/transcript-lines";
import {
  CALL_KIND,
  CALL_MARK,
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
import { delegatedTurnsOf, isAgentTurn } from "@repo/features/voice-call-lines";
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
  /** What GitHub said on the agent's pull request, as the panel's folding card: its head, opening on what it holds. */
  GITHUB: "github",
  /** The quiet line a finished turn ends on: how long it worked and when it ended. */
  FOOT: "foot",
  /** The line the transcript ends on while its agent works. */
  WORKING: "working",
  /** The rule under a Manager chat thread's message that counts the replies after it. */
  RULE: "rule",
} as const;

/** Which piece of a row an item draws: its line, the page it showed, or what it showed. */
export const TRANSCRIPT_PIECE = {
  LINE: "line",
  PAGE: "page",
  PULL_REQUEST: "pull-request",
  MEDIA: "media",
  FOOT: "foot",
  WORKING: "working",
  RULE: "rule",
} as const;

type TranscriptPiece = (typeof TRANSCRIPT_PIECE)[keyof typeof TRANSCRIPT_PIECE];

/** Where an item stands among the list's: its turn's message, its row in that turn, the block within a group where it is one, and the piece of it drawn. */
export interface TranscriptPlace {
  readonly message: string;
  readonly row: string;
  readonly member: number | undefined;
  readonly piece: TranscriptPiece;
  /** Which work of a Manager's chat it stands in, opened under a message or the working line (`managerChatView`); none for a row of the transcript's own. */
  readonly work?: ChatWorkPlace | undefined;
}

/** Which work of a Manager's chat a row stands in: a message's, under its bubble, or the turn under way's, under its working line. */
const CHAT_WORK_PLACE = {
  MESSAGE: "message",
  LIVE: "live",
} as const;

type ChatWorkPlace = (typeof CHAT_WORK_PLACE)[keyof typeof CHAT_WORK_PLACE];

/** Where a call stands, as its line's end mark says it. */
export const CALL_STANDING = {
  RUNNING: "running",
  FAILED: "failed",
  DONE: "done",
} as const;

export type CallStanding = (typeof CALL_STANDING)[keyof typeof CALL_STANDING];

/** One block of an open call's body, as its card draws it: its title, its words, and whether they are code. */
interface CallBodyBlock {
  readonly title: string;
  readonly text: string;
}

/** How a call's shown media is drawn: a picture, a recording in the system's player, or a sound clip in its strip. */
export const SHOWN_MEDIA = {
  PICTURE: "picture",
  VIDEO: "video",
  AUDIO: "audio",
} as const;

type ShownMediaKind = (typeof SHOWN_MEDIA)[keyof typeof SHOWN_MEDIA];

/** How media kept under `mediaType` is drawn. */
function shownKindOf(mediaType: string): ShownMediaKind {
  if (isVideoType(mediaType)) return SHOWN_MEDIA.VIDEO;

  return isAudioType(mediaType) ? SHOWN_MEDIA.AUDIO : SHOWN_MEDIA.PICTURE;
}

/** One picture, recording, or sound clip a call showed, by the id the service kept it under. */
export interface ShownMedia {
  readonly id: string;
  /** The words drawn under it; empty for none. */
  readonly caption: string;
  /** What it is heard as: its caption, or where it has none its name among the call's (`screenshot-1`), as the panel's viewer names it. */
  readonly label: string;
  readonly kind: ShownMediaKind;
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

/** Who sent a message of a Manager's chat, as its row heads it, as a channel's row does: their name, and the face beside it, the Manager's or a person's by their account. */
export interface ChatSender {
  readonly name: string;
  /** Whether the Manager sent it, which its face stands beside; a person otherwise. */
  readonly manager: boolean;
  /** The person's account, which their picture is read by; none for the Manager or a person no account names. */
  readonly userId: string | undefined;
}

/** The thread a message of a Manager's chat stands in, as its channel row offers it: the message it hangs on, which Reply in thread opens, and its replies summed under it where anyone answered. */
export interface ChatThreadMark {
  /** The message the thread hangs on, by its id: the message itself, or for a reply also posted to the chat, its root. */
  readonly root: string;
  /** How many replies it holds; none where no one answered it. */
  readonly replies: number;
  /** One sender to each replier, the first to answer first, whose faces stand beside the count. */
  readonly repliers: readonly ChatSender[];
  /** How the replies are counted ("2 replies"); empty where no one answered. */
  readonly words: string;
}

export type TranscriptItem = { readonly place: TranscriptPlace; readonly depth: number } & (
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.SAID;
      readonly words: string;
      /** The pictures the line carried that its words name none of, drawn over its words as the panel draws them; none where it carried none. */
      readonly pictures?: readonly SaidPicture[] | undefined;
      /** The pictures its words name by their markers ("[Picture 1]"), by name, each drawn where its marker stands as its chip; none where they name none. */
      readonly wordPictures?: ReadonlyMap<string, SaidPicture> | undefined;
      /** The files the line carried that are no picture, such as a PDF, drawn under its words as their chips; none where it carried none. */
      readonly files?: readonly SaidFile[] | undefined;
      /** Who sent it, where the reader did not. */
      readonly sender: string | undefined;
      /** Whether anyone but the reader sent it (another agent, a teammate, the app, an automation, GitHub), so it stands at the column's leading edge, as the panel stands a received line at its left; the reader's own alone stand trailing. */
      readonly received: boolean;
      /** Whether the Manager whose chat this is said it, or greeted with it, so it stands among the people's lines as their bubbles do. */
      readonly manager?: boolean | undefined;
      /** Whether it stands in a Manager's chat, where the reader's own bubble stands in copper and runs stand as Messages spaces them. */
      readonly chat?: boolean | undefined;
      /** In a Manager's chat, who sent it, which its row heads with their face, their name and its time where it opens their run, as a channel stands every message at its leading edge; none outside one. */
      readonly channel?: ChatSender | undefined;
      /** In a Manager's chat's channel, the thread it stands in, which Reply in thread opens, its replies summed under it; none in a thread's own page, or outside a chat. */
      readonly thread?: ChatThreadMark | undefined;
      /** Who sent an automation's prompt, or the agent whose suggestion a line was sent from, part by part; it stands over the sender. */
      readonly from?: readonly OriginPart[] | undefined;
      /** A webhook call's body, which rode in with an automation's prompt. */
      readonly body?: string | undefined;
      /** The account that sent it, where the reader did not, which a run of lines is told apart by. */
      readonly by: string | undefined;
      /** When it was sent; none where the row kept no time. */
      readonly at: number | undefined;
      /** The day and time standing centered over it, as Messages heads talk that picks up again: on the first line with a time, and on one sent after a pause; none on the rest. */
      readonly stamp: string | undefined;
      /** Whether it follows a line of the same sender's run closely, so it stands tight under it and names no sender. */
      readonly joinsAbove: boolean;
      /** Whether a line of its run follows it closely, so it stands tight over it. */
      readonly joinsBelow: boolean;
    }
  | { readonly kind: typeof TRANSCRIPT_ITEM.WORDS; readonly words: string }
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.CALL;
      /** The call's id, which opens and closes it. */
      readonly callId: string;
      readonly callKind: CallKind;
      /** For a call of an integration's tool, the integration, whose mark leads its row in its kind's glyph's place. */
      readonly provider: IntegrationProvider | undefined;
      /** For a call on an app on the reader's Mac, the picture its app's icon was kept as, which leads its row in its kind's glyph's place once read; none where no call on its app kept one. */
      readonly appIcon: string | undefined;
      readonly line: CallLine;
      /** What the call made or is about, named after the line's verb as the panel's chip names it. */
      readonly chip: string | undefined;
      /** The id of the Inbox thread the call posted, withdrew, or read, which its chip opens, as the panel's thread chip does; none for a call about no one thread. */
      readonly thread: string | undefined;
      /** Where it ran, beside its line, where it ran somewhere the transcript does not say. */
      readonly runOn: string | undefined;
      readonly standing: CallStanding;
      readonly open: boolean;
      /** Its body's blocks while it stands open: what it was given and what it answered, or the error it ended in. */
      readonly body: readonly CallBodyBlock[];
      /** Where it stands open with an answer its page carried cut whose whole read has not settled: the part to read whole. */
      readonly cut: AgentPartCut | undefined;
      /** What its body holds under its answer while it stands open, such as the window a computer call read, as the panel's body holds it; none while it is closed. */
      readonly answered: readonly ShownMedia[];
    }
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.FOLD;
      readonly summary: string;
      readonly open: boolean;
      readonly running: boolean;
      /** In a Manager's chat, the sender whose head stands over a turn's work folded over the message that opens their run, as the panel stands it under the name; none elsewhere. */
      readonly channel?: ChatSender | undefined;
      /** When that message was sent, beside the sender's name. */
      readonly stamp?: string | undefined;
    }
  | { readonly kind: typeof TRANSCRIPT_ITEM.MEDIA; readonly media: readonly ShownMedia[] }
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.FOOT;
      readonly words: string;
      /** The turn's words, which its row's Copy and Share take, as the panel's turn foot copies them (`messageWords`). */
      readonly copy: string;
    }
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.WORKING;
      readonly words: string;
      /** Whether the agent waits on the reader's answer rather than working, which the line says in the attention ink with no spinner. */
      readonly waiting?: boolean | undefined;
      /** Whether it is a Manager's chat's, which says it in a row of the Manager's, as a channel shows who is typing. */
      readonly chat?: boolean | undefined;
      /** In a Manager's chat, the Manager, whose face and name head the line. */
      readonly sender?: ChatSender | undefined;
      /** Whether the turn under way's work stands open under it (Show work); none while it has done none since its last message. */
      readonly workShown?: boolean | undefined;
    }
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.RULE;
      /** How the thread's replies are counted ("2 replies"). */
      readonly words: string;
    }
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.PAGE;
      readonly title: string;
      readonly page: string;
      readonly version: number;
    }
  | {
      readonly kind: typeof TRANSCRIPT_ITEM.GITHUB;
      /** The card as the panel draws it (`githubLineFold`). */
      readonly fold: GitHubLineFold;
      /** Whether it stands open on what it holds; never for a card that folds nothing. */
      readonly open: boolean;
      /** The line as words, as the panel's copy reads it (`githubLineWords`), which its long press copies. */
      readonly copy: string;
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
  /** Whether the reader opened the turn under way's work under its working line. */
  readonly liveWork: boolean;
}

/** Nothing turned. */
export const NO_TOGGLES: TranscriptToggles = {
  folds: new Map(),
  calls: new Set(),
  liveWork: false,
};

/** How a transcript is read for its list. */
interface TranscriptReading {
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
  /** The calls the agent holds for the reader's answer, by id, whose fold stands open until the reader folds it, so their rows and their answers stay drawn rather than standing in a banner over the composer. */
  readonly waitingCalls?: ReadonlySet<string> | undefined;
}

/** How a Manager's chat is read for its list: as a transcript is, and the greeting it opens on. */
interface ChatReading extends Omit<TranscriptReading, "origin"> {
  /** The greeting a Manager's chat opens on, drawn as its first bubble (`managerGreeting`); none while older pages are still unread. */
  readonly greeting?: string | undefined;
  /** The reader's messages on their way to the chat, oldest sent first, as the host draws them until their rows land (`AppManagerChat.sending`). */
  readonly sending?: readonly ManagerChatSending[] | undefined;
  /** The Manager's name, which heads its greeting, as its rows name it. */
  readonly managerName?: string | undefined;
  /** The reader's own name, which heads their messages on their way, as their rows will name them. */
  readonly readerName?: string | undefined;
}

/** What the items are read with: the page's reading, and the apps the transcript's computer calls used, each named once, which a call's row wears the icon of (`computerAppsOf`). */
type ItemsReading = TranscriptReading & { readonly computerApps: ComputerApps };

/** What an automation is called where it can't be named: by the panel's words (`namedAutomationActor`). */
const ORIGIN_WORDS = {
  AUTOMATION: "Automation",
  DELETED: "(deleted)",
  RUN_BY: "Run by",
  ISSUE: "issue",
} as const;

/** How long after one line the same sender's next still joins its run: five minutes, as a thread's runs reach. */
const RUN_REACH_MS = 5 * 60 * 1000;

/** How long a pause between two sent lines has to be for the later one to stand under the day and time again: a quarter of an hour. */
const STAMP_PAUSE_MS = 15 * 60 * 1000;

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

/** Where a call stands by its state, a call the service answered without doing it (`refused`) standing as failed. */
function standingOf(state: ToolState, refused: boolean): CallStanding {
  if (state === TOOL_STATE.OUTPUT_ERROR || refused) return CALL_STANDING.FAILED;

  return state === TOOL_STATE.OUTPUT_AVAILABLE ? CALL_STANDING.DONE : CALL_STANDING.RUNNING;
}

/** Whether a call is a set of pictures shown, which draws as its pictures. */
function showedPictures(part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>): boolean {
  return (
    isShowMediaTool(part.tool) &&
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

/** The media types a sent line's file is drawn as a picture for. */
const PICTURE_TYPES: ReadonlySet<string> = new Set(Object.values(PICTURE_TYPE));

/** A picture a sent line carried: its place on the line, its name, and its bytes where the line kept them, or the picture it was kept as, read by its id. */
export interface SaidPicture {
  readonly key: string;
  readonly name: string;
  readonly url: string | undefined;
  readonly pictureId: string | undefined;
}

/** The pictures a sent line carried, in order, as the panel lists a line's files (`messageFileChips`); a file that is no picture, such as a PDF, stands as its chip (`saidFiles`). */
function saidPictures(chips: readonly MessageFileChip[]): readonly SaidPicture[] {
  return chips.flatMap((file, index): SaidPicture[] =>
    PICTURE_TYPES.has(file.mediaType)
      ? [
          {
            key: String(index),
            name: file.name,
            // Note that a picture kept apart is read by its id, so the empty `data:` address its line keeps in the bytes' place never stands in for it.
            url: file.pictureId === undefined && file.url !== "" ? file.url : undefined,
            pictureId: file.pictureId,
          },
        ]
      : [],
  );
}

/** A sent line's pictures as its words place them: those its words name, by name, drawn where each marker stands, and the rest, drawn over the words. */
interface PlacedPictures {
  readonly pictures: readonly SaidPicture[];
  readonly wordPictures: ReadonlyMap<string, SaidPicture> | undefined;
}

/**
 * A sent line's pictures placed by its words, as the panel places a
 * message's files (`useWordFiles`): each picture a marker outside code
 * names drawn where the marker stands, the first picture of its name alone,
 * so a later one of that name stays over the words with every picture the
 * words name none of, such as a line's sent before markers.
 */
function placedPictures(words: string, all: readonly SaidPicture[]): PlacedPictures {
  const named = new Set(fileMarkers(words).map((marker) => marker.name));
  const wordPictures = new Map<string, SaidPicture>();

  const pictures = all.filter((picture) => {
    if (!named.has(picture.name) || wordPictures.has(picture.name)) return true;
    wordPictures.set(picture.name, picture);

    return false;
  });

  return { pictures, wordPictures: wordPictures.size === 0 ? undefined : wordPictures };
}

/** A file a sent line carried that is no picture, such as a PDF or a text file: its place on the line, its name and type, its bytes where the line kept them, and its size in words. */
export interface SaidFile {
  readonly key: string;
  readonly name: string;
  readonly mediaType: string;
  /** The file's bytes in base64; none where the line kept none, which leaves the chip its name alone. */
  readonly base64: string | undefined;
  readonly size: string | undefined;
}

/** A text file's words, or none where its bytes are no base64 the system reads. */
function saidWords(base64: string): string | undefined {
  try {
    return attachmentText(base64);
  } catch {
    return undefined;
  }
}

/** What a sent file's chip says of its size, as the panel's: a text file's count of lines, any other file's bytes. Note that a damaged text file says its bytes, as the panel's chip does, so the row still draws. */
function saidSize(file: FileChip, base64: string): string {
  const words = attachmentView(file) === ATTACHMENT_VIEW.TEXT ? saidWords(base64) : undefined;

  return words === undefined ? sizeLabel(base64) : linesLabel(words);
}

/** The files a sent line carried that are no picture, in order, as the panel lists a line's files (`messageFileChips`). */
function saidFiles(chips: readonly MessageFileChip[]): readonly SaidFile[] {
  return chips.flatMap((file, index): SaidFile[] => {
    if (PICTURE_TYPES.has(file.mediaType)) return [];
    const base64 = chipBase64(file);
    const kept = base64 === "" ? undefined : base64;

    return [
      {
        key: String(index),
        name: file.name,
        mediaType: file.mediaType,
        base64: kept,
        size: kept === undefined ? undefined : saidSize(file, kept),
      },
    ];
  });
}

/** A line someone sent, as its item: one sent from a suggestion headed by who suggested it, its words without the lead that names that agent to the agent reading them; one GitHub sent as the panel's folding card. */
function saidItem(
  line: AgentTranscriptMessage,
  base: ItemBase,
  reading: TranscriptReading,
): TranscriptItem {
  const github = githubLineOf(line);

  // Note that what GitHub said is drawn as the panel's card, closed as it lands since its head says what happened, never as the prompt the agent read.
  if (github !== undefined) {
    const fold = githubLineFold(github, messageWords(line));

    return {
      ...base,
      kind: TRANSCRIPT_ITEM.GITHUB,
      fold,
      open: fold.folds && foldTurned(reading.toggles, base.place),
      copy: githubLineWords(github, messageWords(line)),
    };
  }

  // Note that a line is the reader's own only by a user id that matches theirs, so an app's line, which has none, keeps its name while the reader is unknown.
  const own =
    line.sentBy === undefined ||
    (line.sentBy.userId !== undefined && line.sentBy.userId === reading.readerId);

  const sender = own ? undefined : line.sentBy?.name;

  const from = suggestionFrom(line, reading, sender);
  const said = messageWords(line);
  // Note that another agent's message reads as a person reads it, without the head and the reply line that are the model's alone, as the panel draws it (`agentMessageWords`).
  const words = agentMessageOf(line) === undefined ? said : (agentMessageWords(said) ?? said);
  // Note that a started agent's first line names who started it in its head, so its sender stands nowhere else.
  const started = from !== undefined && suggestionStartOf(line) !== undefined;

  const shown = from === undefined ? words : suggestionWords(words);

  return {
    ...base,
    kind: TRANSCRIPT_ITEM.SAID,
    words: shown,
    ...placedPictures(shown, saidPictures(messageFileChips(line))),
    files: saidFiles(messageFileChips(line)),
    sender: started ? undefined : sender,
    received: !own,
    from,
    by: sender === undefined ? undefined : line.sentBy?.userId,
    at: line.sentAt,
    stamp: undefined,
    joinsAbove: false,
    joinsBelow: false,
  };
}

/** An automation's prompt as its agent's first line, in place of the line's own words and sender, with the pictures and files the line carried. */
function originItem(
  line: AgentTranscriptMessage,
  base: ItemBase,
  origin: TranscriptOrigin,
): TranscriptItem {
  const words = origin.prompt ?? messageWords(line);

  return {
    ...base,
    kind: TRANSCRIPT_ITEM.SAID,
    words,
    ...placedPictures(words, saidPictures(messageFileChips(line))),
    files: saidFiles(messageFileChips(line)),
    sender: undefined,
    // Note that an automation's prompt is the automation's, so it stands at the leading edge under the run's card, as the panel stands its received lines.
    received: true,
    by: undefined,
    at: line.sentAt,
    stamp: undefined,
    joinsAbove: false,
    joinsBelow: false,
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

/** The Inbox thread a call names by the id its answer gave it, which its chip opens; none for any other call, a refused one, or one still running. */
function calledThread(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
): string | undefined {
  const target = toolTarget(part);

  return target?.kind === TOOL_TARGET.INBOX ? target.item : undefined;
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
  reading: ItemsReading,
): readonly TranscriptItem[] {
  const { toggles } = reading;
  const shownSet = showedPictures(part);
  const pictures = shownSet ? shownPicturesOf(part.input, part.output) : [];
  // Note that a computer call's window stands in its body, seen once it is opened, as the panel's does, because the agent reads a window at nearly every step and shows what matters itself.
  const inBody = part.tool === AGENT_TOOL.COMPUTER;

  // Note that a picture a call answered that was not kept has no bytes to draw, so it is left out.
  const called: readonly ShownMedia[] = calledPicturesOf(
    part.tool,
    part.input,
    part.output,
  ).flatMap((each) =>
    each.kept
      ? [
          {
            id: each.picture.id,
            caption: "",
            label: each.name,
            kind: shownKindOf(each.picture.mediaType),
          },
        ]
      : [],
  );

  const media: readonly ShownMedia[] = [
    ...pictures.flatMap(({ picture, caption, name }) =>
      picture === undefined
        ? []
        : [
            {
              id: picture.id,
              caption,
              label: caption === "" ? name : caption,
              kind: shownKindOf(picture.mediaType),
            },
          ],
    ),
    ...recordedVideosOf(part.tool, part.output).map(({ picture, caption, name }) => ({
      id: picture.id,
      caption,
      label: caption === "" ? name : caption,
      kind: SHOWN_MEDIA.VIDEO,
    })),
    ...(inBody ? [] : called),
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
    provider: view.provider,
    // Note that a computer call that kept no icon wears the one an earlier call on its app kept, as the panel's row does (`useComputerIcon`).
    appIcon: view.appIcon ?? reading.computerApps.byCall.get(part.callId)?.icon,
    ...callNaming(view),
    thread: calledThread(part),
    // Note that the row leads with the integration's mark, so it names only what the mark does not: the account among several, or a server of no integration's.
    runOn: callPlace(view, CALL_MARK.LEADS),
    standing: standingOf(part.state, view.refused === true),
    open,
    body: open
      ? callBody(view.input, read?.output ?? view.output, drawn.errorText, read !== undefined)
      : [],
    cut: read?.reading === true ? part.cut : undefined,
    answered: open && inBody ? called : [],
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

  const opened = openedPullRequest(part, base, reading.pullRequests);

  // Note that a pull request the call opened stands as its card alone, as a set of pictures shown stands as its pictures, since the call's line named the same pull request over it; a call refused opens none and keeps its line with the reason.
  if (opened.length > 0) return [...page, ...opened, ...mediaItem];

  // Note that a finished call a page's card stands for is drawn as its card alone, as the card names the page the call's line would say again.
  if (
    page.length > 0 &&
    call.kind === TRANSCRIPT_ITEM.CALL &&
    call.standing === CALL_STANDING.DONE &&
    !open
  )
    return [...page, ...mediaItem];

  return [call, ...page, ...mediaItem];
}

/** One part as its items; none for what the agent thought, or a part with nothing to draw. */
function partItems(
  part: AgentPart,
  base: ItemBase,
  reading: ItemsReading,
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
  reading: ItemsReading,
): readonly TranscriptItem[] {
  return rows.flatMap((row): readonly TranscriptItem[] => {
    const base = {
      place: { message, row: row.key, member: undefined, piece: TRANSCRIPT_PIECE.LINE },
      depth,
    };

    if (row.kind === TURN_ROW.BLOCK) return partItems(row.block, base, reading);

    // Note that a fold holding a call that waits on the reader stands open as the turn's latest work does, since a line landing after it, such as the reader's own steer, closes the run it stood in and would leave the call undrawn.
    const waits = row.blocks.some(
      (block) => block.kind === AGENT_PART.TOOL && reading.waitingCalls?.has(block.callId) === true,
    );

    const open = (row.open || waits) !== foldTurned(reading.toggles, base.place);

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

type SaidItem = Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.SAID }>;

/** Whether `next` joins the run `last` ends, as Messages groups a sender's bubbles: the same sender, sent within `RUN_REACH_MS`, neither headed by where it came from. */
function joinsRun(last: SaidItem, next: SaidItem): boolean {
  if (last.from !== undefined || next.from !== undefined || next.body !== undefined) return false;

  if (last.by !== next.by || last.sender !== next.sender) return false;

  if (last.at === undefined || next.at === undefined) return false;

  return next.at >= last.at && next.at - last.at <= RUN_REACH_MS;
}

/**
 * The items with the lines sent in runs and their times between them, as
 * Messages draws a conversation: lines one sender sent back to back stand
 * tight under one sender's name, and the day and time stand centered over
 * the first line with a time and over one sent after a pause of
 * `STAMP_PAUSE_MS` since the line before it, rather than under every line.
 * A Manager's chat (`chatRuns`) runs its messages as the panel does
 * (`managerChatView`), by each one's place in its run.
 */
function inRuns(
  items: readonly TranscriptItem[],
  now: number,
  chatRuns: ReadonlyMap<string, ChatRunPlace> | undefined,
): readonly TranscriptItem[] {
  let lastSent: number | undefined;

  // The chat's messages whose head stands over the turn's work folded over them, which draw no head of their own.
  const headed = new Set(
    items.flatMap((item) =>
      item.kind === TRANSCRIPT_ITEM.FOLD && item.channel !== undefined ? [item.place.message] : [],
    ),
  );

  const timed = items.map((item, index): TranscriptItem => {
    if (item.kind !== TRANSCRIPT_ITEM.SAID) return item;

    const before = items[index - 1];

    // Note that a Manager's chat stands in the runs the panel groups it in, so a run reads the same on either, whatever its work or what it showed stands between two of its messages.
    const joinsAbove =
      chatRuns === undefined
        ? before?.kind === TRANSCRIPT_ITEM.SAID && joinsRun(before, item)
        : chatRuns.get(item.place.message)?.opens === false || headed.has(item.place.message);

    const paused =
      item.at !== undefined && (lastSent === undefined || item.at - lastSent >= STAMP_PAUSE_MS);

    // Note that a Manager's chat says when each run opened in its head, beside its sender's name, as a channel's row does, rather than over a pause.
    const stamped = chatRuns === undefined ? paused : !joinsAbove;
    const stamp = stamped && item.at !== undefined ? callHeading(item.at, now) : undefined;

    if (item.at !== undefined) lastSent = item.at;

    return { ...item, joinsAbove, stamp, chat: chatRuns !== undefined };
  });

  return timed.map((item, index): TranscriptItem => {
    const after = timed[index + 1];

    if (item.kind !== TRANSCRIPT_ITEM.SAID || after?.kind !== TRANSCRIPT_ITEM.SAID) return item;

    return { ...item, joinsBelow: after.joinsAbove };
  });
}

/**
 * The transcript with the member's messages on their way at its end, each
 * as their own line under the id its row lands under, so the row takes its
 * place, as the host draws them (`AppTranscript.sending`); a message the
 * service refused stands there too, where it went, which the page marks Not
 * delivered (`AgentTranscript`'s `undelivered`), as the panel keeps it.
 */
export function withSending(
  messages: readonly AgentTranscriptMessage[],
  sending: readonly SendingMessage[],
): readonly AgentTranscriptMessage[] {
  if (sending.length === 0) return messages;

  return [
    ...messages,
    ...sending.map(
      (message): AgentTranscriptMessage => ({
        id: message.id,
        role: MESSAGE_ROLE.USER,
        parts: [{ type: AGENT_PART.TEXT, text: message.text }],
        sentAt: message.sentAt,
      }),
    ),
  ];
}

/** The place a Manager's greeting stands under, which no message of its chat holds. */
const GREETING_PLACE = linePlace("greeting", "greeting");

/** A stretch of a Manager's work as the rows a turn draws (`workRows`), set a step in, each in the work's place, so it keys and folds apart from the chat's own rows. */
function workItems(
  parts: readonly AgentPart[],
  message: string,
  work: ChatWorkPlace,
  moving: boolean,
  reading: ItemsReading,
): readonly TranscriptItem[] {
  return rowItems(workRows(parts, moving), message, 1, reading).map((item) => ({
    ...item,
    place: { ...item.place, work },
  }));
}

/** A Manager's greeting as its chat's first message, under its name, though no one sent it and nothing stores it; none where there is none. */
function greetingItems(
  greeting: string | undefined,
  managerName: string | undefined,
): readonly TranscriptItem[] {
  if (greeting === undefined) return [];

  return [
    {
      place: GREETING_PLACE,
      depth: 0,
      kind: TRANSCRIPT_ITEM.SAID,
      words: greeting,
      sender: undefined,
      received: true,
      manager: true,
      channel: { name: managerName ?? "", manager: true, userId: undefined },
      by: undefined,
      at: undefined,
      stamp: undefined,
      joinsAbove: false,
      joinsBelow: false,
    },
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
  // A turn a call's delegation opened folds its written words with its work, as the panel's does.
  const delegated = delegatedTurnsOf(placed);
  const { origin } = reading;
  const read: ItemsReading = { ...reading, computerApps: computerAppsOf(messages) };

  // Note that an automation's prompt is the first line anyone sent, which the run's card stands in place of.
  const head =
    origin === undefined
      ? undefined
      : placed.find(({ message }) => message.role === MESSAGE_ROLE.USER)?.message.id;

  // Note that the turn the agent still writes is its newest one while unfinished, wherever it stands, as the panel reads it, because a call's lines said while it runs stand after it.
  const newest = reading.writing
    ? placed.findLast(({ message }) => isAgentTurn(message))?.message
    : undefined;

  const writing = newest?.finishedAt === undefined ? newest?.id : undefined;

  const items = placed.flatMap(({ message, arrived }): readonly TranscriptItem[] => {
    if (message.role === MESSAGE_ROLE.USER) {
      const base = { place: linePlace(message.id, message.id), depth: 0 };

      return [
        origin !== undefined && message.id === head
          ? originItem(message, base, origin)
          : saidItem(message, base, reading),
      ];
    }

    const moving = message.id === writing;
    const rows = agentRows(message, moving, { arrived, delegated: delegated.has(message.id) });

    const turn = turnStretches(rows).flatMap((stretch) =>
      stretch.line === undefined
        ? rowItems(stretch.rows, message.id, 0, read)
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
              // Note that the copy is the turn's words whole, as the panel's foot copies them (`messageWords`), so words a closed fold holds are copied too.
              copy: messageWords(message),
            },
          ];

    return [...turn, ...foot];
  });

  const last = placed.at(-1)?.message.id;
  const runs = inRuns(items, reading.now, undefined);

  if (!reading.writing || last === undefined) return runs;

  return [
    ...runs,
    {
      place: { ...linePlace(last, last), piece: TRANSCRIPT_PIECE.WORKING },
      depth: 0,
      kind: TRANSCRIPT_ITEM.WORKING,
      words: WORKING_LINE,
    },
  ];
}

/** What a picture, a recording, or a sound clip a chat message carried is heard as where it has no caption or name. */
const CHAT_MEDIA_WORDS = {
  [SHOWN_MEDIA.PICTURE]: "Picture",
  [SHOWN_MEDIA.VIDEO]: "Recording",
  [SHOWN_MEDIA.AUDIO]: "Sound clip",
} as const satisfies Record<ShownMediaKind, string>;

/** A file a chat message carried kept apart under an id, such as a picture its row names by it, rather than carried as its bytes. */
type KeptChatFile = Extract<ManagerChatAttachment, { readonly id: string }>;

/** Whether a chat message's file was kept apart, under an id, rather than carried as its `data:` URL. */
function keptChatFile(file: ManagerChatAttachment): file is KeptChatFile {
  return "id" in file;
}

/** A file a chat message carried as a sent line's chip: one kept apart named by its name or its caption and read by its id, any other carrying its bytes. */
function chatFileChip(file: ManagerChatAttachment): MessageFileChip {
  if (!keptChatFile(file)) return file;

  return {
    name: file.name ?? file.caption ?? "",
    mediaType: file.mediaType,
    url: "",
    pictureId: file.id,
  };
}

/** The files a Manager's message showed and kept apart, by their ids, as a set it showed stands. */
function chatShownMedia(files: readonly KeptChatFile[]): readonly ShownMedia[] {
  return files.map((file) => {
    const kind = shownKindOf(file.mediaType);
    const caption = file.caption ?? "";

    return {
      id: file.id,
      caption,
      label: caption === "" ? (file.name ?? CHAT_MEDIA_WORDS[kind]) : caption,
      kind,
    };
  });
}

/** A chat message's files as its line draws them: its pictures placed by its words, and its other files as their chips. */
function chatSaidFiles(
  words: string,
  files: readonly ManagerChatAttachment[],
): PlacedPictures & { readonly files: readonly SaidFile[] } {
  const chips = files.map(chatFileChip);

  return { ...placedPictures(words, saidPictures(chips)), files: saidFiles(chips) };
}

/**
 * A finished turn's work folded over the Manager's first message of it, as
 * the panel folds it: its line says how long the turn worked, or Show work
 * where its journal kept no times, and the reader opens it on the turn's work
 * set a step in under it; none for a message that opens no turn's work.
 */
function chatWorkFold(
  line: ManagerChatLine,
  view: ManagerChatView,
  turns: ReadonlyMap<string, AgentTranscriptMessage>,
  reading: ItemsReading,
): readonly TranscriptItem[] {
  const { message } = line;

  // Note that the fold over a message that opens its sender's run stands under that sender's head, as the panel's fold stands under the name, so it never reads as the line above's.
  const head = line.place.opens
    ? { channel: chatSenderOf(message), stamp: callHeading(message.createdAt, reading.now) }
    : undefined;

  const work = line.work === undefined ? [] : (view.work.get(line.work) ?? []);

  if (line.work === undefined || work.length === 0) return [];
  const place = { ...linePlace(message.id, message.id), work: CHAT_WORK_PLACE.MESSAGE };
  const open = foldTurned(reading.toggles, place);
  const turn = turns.get(line.work);

  const summary =
    turn?.startedAt === undefined || turn.finishedAt === undefined
      ? chatWorkWords(false)
      : `${WORKED_WORDS}${workingTime(turn.finishedAt - turn.startedAt)}`;

  return [
    { place, depth: 0, kind: TRANSCRIPT_ITEM.FOLD, summary, open, running: false, ...head },
    ...(open ? workItems(work, message.id, CHAT_WORK_PLACE.MESSAGE, false, reading) : []),
  ];
}

/** Who sent a message of the chat, as its row heads it. */
function chatSenderOf(message: ManagerChatLine["message"]): ChatSender {
  const manager = message.authorKind === MANAGER_CHAT_AUTHOR.AGENT;

  return {
    name: message.authorName,
    manager,
    userId: manager ? undefined : (message.authorUserId ?? undefined),
  };
}

/** One sender to each replier of a thread, in the order they first answered, as the panel's summary stands their faces. */
function repliersOf(replies: readonly ManagerChatLine[]): readonly ChatSender[] {
  const seen = new Set<string>();
  const repliers: ChatSender[] = [];

  for (const { message } of replies) {
    const sender = chatSenderOf(message);
    const who = sender.manager ? MANAGER_CHAT_AUTHOR.AGENT : (sender.userId ?? sender.name);

    if (seen.has(who)) continue;
    seen.add(who);
    repliers.push(sender);
  }

  return repliers;
}

/** The thread a message of the channel stands in, as its row offers it: its own, or its root's for a reply also posted to the chat, with the replies the view holds of it. */
function threadMarkOf(line: ManagerChatLine, view: ManagerChatView): ChatThreadMark {
  const root = line.message.threadRoot ?? line.message.id;
  const replies = view.threads.get(root) ?? [];

  return {
    root,
    replies: replies.length,
    repliers: repliersOf(replies),
    words: replies.length === 0 ? "" : repliesWords(replies.length),
  };
}

/**
 * One message of a Manager's chat as its items, each headed by who sent it
 * as a channel's row is: a person's as their line; the Manager's words as
 * its line and what it showed as the set's pictures under them; and, over
 * the Manager's first message of a finished turn, the turn's work folded,
 * as the panel folds it. In the channel (`threads`), its line offers the
 * thread it stands in.
 */
function chatLineItems(
  line: ManagerChatLine,
  view: ManagerChatView,
  turns: ReadonlyMap<string, AgentTranscriptMessage>,
  reading: ItemsReading,
  threads: boolean,
): readonly TranscriptItem[] {
  const { message } = line;
  const base = { place: linePlace(message.id, message.id), depth: 0 };

  const said = {
    ...base,
    kind: TRANSCRIPT_ITEM.SAID,
    words: message.text,
    at: message.createdAt,
    stamp: undefined,
    joinsAbove: false,
    joinsBelow: false,
    channel: chatSenderOf(message),
    thread: threads ? threadMarkOf(line, view) : undefined,
  } as const;

  if (message.authorKind === MANAGER_CHAT_AUTHOR.PERSON) {
    const own = message.authorUserId !== null && message.authorUserId === reading.readerId;

    return [
      {
        ...said,
        ...chatSaidFiles(message.text, message.attachments),
        sender: own ? undefined : message.authorName,
        received: !own,
        by: own ? undefined : (message.authorUserId ?? undefined),
      },
    ];
  }

  const fold = chatWorkFold(line, view, turns, reading);
  // Note that what the Manager showed and kept stands as the set's pictures under its words, and any file it carried as its bytes stands on its bubble, as a person's would.
  const media = chatShownMedia(message.attachments.filter(keptChatFile));
  const carried = message.attachments.filter((file) => !keptChatFile(file));

  // Note that a message of what it showed alone still stands as a line of no words, since its line carries who sent it and the thread it stands in, so its thread opens as any message's does.
  return [
    ...fold,
    {
      ...said,
      ...chatSaidFiles(message.text, carried),
      sender: undefined,
      received: true,
      manager: true,
      by: undefined,
    },
    ...(media.length === 0
      ? []
      : [
          {
            ...base,
            place: pieceOf(base.place, TRANSCRIPT_PIECE.MEDIA),
            kind: TRANSCRIPT_ITEM.MEDIA,
            media,
          },
        ]),
  ];
}

/**
 * The reader's messages on their way to a Manager's chat as their own lines
 * after its messages, each under the key it went under, so the page marks
 * one refused Not delivered by it (`AgentTranscript`'s `undelivered`), each
 * in the run the chat's view placed it in (`places`), the one its row will
 * stand in, as the panel draws them.
 */
function chatSendingItems(
  sending: readonly ManagerChatSending[],
  places: ReadonlyMap<string, ChatRunPlace>,
  reading: ChatReading,
): readonly { readonly item: TranscriptItem; readonly place: ChatRunPlace }[] {
  return sending.map((line) => ({
    item: {
      place: linePlace(line.clientKey, line.clientKey),
      depth: 0,
      kind: TRANSCRIPT_ITEM.SAID,
      words: line.text,
      sender: undefined,
      channel: { name: reading.readerName ?? "", manager: false, userId: reading.readerId },
      received: false,
      by: undefined,
      at: line.sentAt,
      stamp: undefined,
      joinsAbove: false,
      joinsBelow: false,
    },
    place: places.get(line.clientKey) ?? CHAT_RUN_ALONE,
  }));
}

/** The reader's messages on their way to one scope of the chat, its top (`root` none) or one thread, oldest sent first. */
function sendingTo(
  sending: readonly ManagerChatSending[] | undefined,
  root: string | undefined,
): readonly ManagerChatSending[] {
  return (sending ?? []).filter((line) => line.threadRoot === root);
}

/**
 * A Manager's chat as the list's items, oldest first, as the panel's chat
 * draws it from its rows (`managerChatView`), a team channel: the greeting
 * it opens on, then the messages at its top, each a row headed by who sent
 * it where it opens their run, in the runs the panel groups them in, each
 * offering its thread with its replies summed under it, with no turn's
 * foot; the reader's messages on their way to it after them; and while the
 * Manager may still write, its working line, the turn under way's work under
 * it once the reader opens it. The transcript is read only for the work its
 * turns did. A thread's replies stand on its own page
 * (`managerThreadItems`).
 */
export function managerChatItems(
  view: ManagerChatView,
  transcript: readonly AgentTranscriptMessage[],
  reading: ChatReading,
): readonly TranscriptItem[] {
  const read: ItemsReading = { ...reading, computerApps: computerAppsOf(transcript) };
  // Note that a turn's journal message stands under the turn's id, which a message's work names.
  const turns = new Map(transcript.map((message) => [message.id, message]));
  const items = view.top.flatMap((line) => chatLineItems(line, view, turns, read, true));
  const newest = view.top.at(-1)?.message;
  const going = sendingTo(reading.sending, undefined);
  const sending = chatSendingItems(going, view.sending.channel, reading);

  const runs = new Map<string, ChatRunPlace>([
    ...view.top.map((line) => [line.message.id, line.place] as const),
    ...sending.map(({ item, place }) => [item.place.message, place] as const),
  ]);

  const drawn = inRuns(
    [
      ...greetingItems(reading.greeting, reading.managerName),
      ...items,
      ...sending.map(({ item }) => item),
    ],
    reading.now,
    runs,
  );

  if (!reading.writing) return drawn;
  const last = going.at(-1)?.clientKey ?? newest?.id ?? GREETING_PLACE.message;
  const liveShown = view.live.length > 0 && reading.toggles.liveWork;

  return [
    ...drawn,
    {
      place: { ...linePlace(last, last), piece: TRANSCRIPT_PIECE.WORKING },
      depth: 0,
      kind: TRANSCRIPT_ITEM.WORKING,
      words: WORKING_LINE,
      chat: true,
      sender: { name: reading.managerName ?? "", manager: true, userId: undefined },
      workShown: view.live.length === 0 ? undefined : liveShown,
    },
    // Note that the turn under way's work stands under its working line, still moving, as the panel opens it there.
    ...(liveShown ? workItems(view.live, last, CHAT_WORK_PLACE.LIVE, true, read) : []),
  ];
}

/**
 * One thread of a Manager's chat as its page's items, as the panel's
 * thread tab draws it: the message it hangs on (`root`, by its id), alone in
 * its run, then the rule counting its replies where anyone answered, its
 * replies oldest first in their runs, and the reader's replies on their way
 * after them; none of them offering a thread. None where the root is not
 * among the chat's messages read, as a rewind drops it or an older page holds
 * it.
 */
export function managerThreadItems(
  view: ManagerChatView,
  root: string,
  transcript: readonly AgentTranscriptMessage[],
  reading: ChatReading,
): readonly TranscriptItem[] | undefined {
  const rootLine = view.top.find(
    (line) => line.message.id === root && line.message.threadRoot === null,
  );

  if (rootLine === undefined) return undefined;
  const read: ItemsReading = { ...reading, computerApps: computerAppsOf(transcript) };
  const turns = new Map(transcript.map((message) => [message.id, message]));
  const replies = view.threads.get(root) ?? [];
  const sending = chatSendingItems(sendingTo(reading.sending, root), view.sending.channel, reading);
  const head = chatLineItems({ ...rootLine, place: CHAT_RUN_ALONE }, view, turns, read, false);
  const lines = replies.flatMap((line) => chatLineItems(line, view, turns, read, false));

  const runs = new Map<string, ChatRunPlace>([
    [root, CHAT_RUN_ALONE],
    ...replies.map((line) => [line.message.id, line.place] as const),
    ...sending.map(({ item, place }) => [item.place.message, place] as const),
  ]);

  const rule: readonly TranscriptItem[] =
    replies.length === 0
      ? []
      : [
          {
            place: { ...linePlace(root, root), piece: TRANSCRIPT_PIECE.RULE },
            depth: 0,
            kind: TRANSCRIPT_ITEM.RULE,
            words: repliesWords(replies.length),
          },
        ];

  return inRuns(
    [...head, ...rule, ...lines, ...sending.map(({ item }) => item)],
    reading.now,
    runs,
  );
}

/**
 * The items with their working line saying that the agent waits on the
 * reader (`waitingOnYouWords`), as the panel's does, and its folds not
 * turning, so an agent held for an answer never reads as working on; the
 * items as they stand where none waits.
 */
export function withWaitingLine(
  items: readonly TranscriptItem[],
  waiting: string | undefined,
): readonly TranscriptItem[] {
  if (waiting === undefined) return items;

  return items.map((item) =>
    item.kind === TRANSCRIPT_ITEM.WORKING
      ? { ...item, words: waiting, waiting: true }
      : item.kind === TRANSCRIPT_ITEM.FOLD
        ? { ...item, running: false }
        : item,
  );
}

/** The calls the items draw a row for, by id, so a call the agent holds that none draws, such as a subagent's, is answered elsewhere. */
export function drawnCallIds(items: readonly TranscriptItem[]): ReadonlySet<string> {
  return new Set(
    items.flatMap((item) => (item.kind === TRANSCRIPT_ITEM.CALL ? [item.callId] : [])),
  );
}

/** The toggles with a fold's, by its place, a call's, by its id, or the turn under way's work under a Manager's working line, turned the other way. */
export function toggledAt(toggles: TranscriptToggles, item: TranscriptItem): TranscriptToggles {
  // Note that a Manager's working line turns the turn under way's work (Show work).
  if (item.kind === TRANSCRIPT_ITEM.WORKING) return { ...toggles, liveWork: !toggles.liveWork };

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

/** A file a sent line carried, as the app writes its bytes for the chip that opens it: the line it rode in on, by the line's own id, and the file, which holds its place on that line. */
export interface ShownFile {
  readonly message: string;
  readonly file: SaidFile;
}

/** Every file the items' sent lines carried bytes of, which the app writes where the chip opens it from. */
export function shownFiles(items: readonly TranscriptItem[]): readonly ShownFile[] {
  return items.flatMap((item) =>
    item.kind === TRANSCRIPT_ITEM.SAID
      ? (item.files ?? []).flatMap((file) =>
          // Note that a line keeps its own id as its row, while a line that reached a turn under way shares the turn's message with every other such line, so the row keys its files apart.
          file.base64 === undefined ? [] : [{ message: item.place.row, file }],
        )
      : [],
  );
}

/**
 * The rows on screen and the `reach` rows on each side of them, in the
 * transcript's order, whose pictures a page reads before they scroll in;
 * the rows on screen alone where none of them stands among `items`. Note
 * that a row is found by its identity, as the list hands back the rows it
 * was given.
 */
export function rowsNear(
  items: readonly TranscriptItem[],
  shown: readonly TranscriptItem[],
  reach: number,
): readonly TranscriptItem[] {
  const places = shown.flatMap((item) => {
    const at = items.indexOf(item);

    return at < 0 ? [] : [at];
  });

  if (places.length === 0) return shown;

  return items.slice(Math.max(0, Math.min(...places) - reach), Math.max(...places) + reach + 1);
}

/** The ids of the pictures alone among those the items show (`shownMediaIds`): a call's app icon, a sent line's pictures, and each shown piece that is a picture, never a recording or a sound clip. */
export function shownPictureIds(items: readonly TranscriptItem[]): readonly string[] {
  const pictures = (media: readonly ShownMedia[]) =>
    media.flatMap(({ id, kind }) => (kind === SHOWN_MEDIA.PICTURE ? [id] : []));

  return items.flatMap((item) => {
    if (item.kind === TRANSCRIPT_ITEM.MEDIA) return pictures(item.media);

    if (item.kind === TRANSCRIPT_ITEM.CALL) {
      return [...(item.appIcon === undefined ? [] : [item.appIcon]), ...pictures(item.answered)];
    }

    if (item.kind === TRANSCRIPT_ITEM.SAID) {
      return [...(item.pictures ?? []), ...(item.wordPictures?.values() ?? [])].flatMap(
        ({ pictureId }) => (pictureId === undefined ? [] : [pictureId]),
      );
    }

    return [];
  });
}

/** The ids of every picture and recording the items show, an open call's body's among them, which the list reads the bytes of. */
export function shownMediaIds(items: readonly TranscriptItem[]): readonly string[] {
  return items.flatMap((item) => {
    if (item.kind === TRANSCRIPT_ITEM.MEDIA) return item.media.map(({ id }) => id);

    // Note that an app's icon is read wherever its call's row stands, and what an open call's body holds as it opens, so a turn of many windows reads only the ones opened.
    if (item.kind === TRANSCRIPT_ITEM.CALL) {
      return [
        ...(item.appIcon === undefined ? [] : [item.appIcon]),
        ...item.answered.map(({ id }) => id),
      ];
    }

    // Note that a picture a sent line kept by its id is read as the agent's shown ones are, through the same door.
    if (item.kind === TRANSCRIPT_ITEM.SAID) {
      return [...(item.pictures ?? []), ...(item.wordPictures?.values() ?? [])].flatMap(
        ({ pictureId }) => (pictureId === undefined ? [] : [pictureId]),
      );
    }

    return [];
  });
}
