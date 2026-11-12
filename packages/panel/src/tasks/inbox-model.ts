import { AGENT_CALL_FAILURE, type AgentCallFailure } from "@repo/features/agent-view";
import type { AgentSummary } from "@repo/features/agent-wire";
import type { FileChip } from "@repo/features/attachment-model";
import { waitsOnReaderNow } from "@repo/features/inbox-list-model";
import {
  codeLinesReadable,
  INBOX_STATUS,
  type InboxCodeBlock,
  type InboxItem,
  type InboxMessage,
} from "@repo/features/inbox-wire";
import type { TaskFileRequest } from "@repo/features/task-wire";
import type { TasksFileAnswer } from "@repo/features/tasks-view";
import type { AppInboxWaitingItem } from "@repo/host/app-state";
import { UNHEARD_OFFLINE } from "./agent-model.js";
import type { SnippetLines } from "./code-snippet-model.js";
import { refusalLine, refusalPasses } from "./file-tab-model.js";

/**
 * inbox-model.ts -- the panel's Inbox as pure decisions beside the list's own (`@repo/features/inbox-list-model`) and the box's (`@repo/features/inbox-draft`): how a settled item reads, what a refused send says, and how its files and code are drawn.
 *
 * Which items the list holds, in what order, and what each row's line says
 * are the list model's, and what a box's draft sends is the draft's, both of
 * which the iOS app reads too; what is here is the panel's alone. A task's
 * board, which counts what waits, holds what waits the oldest posted first,
 * since it has held its agent longest, and what is settled, answered or
 * taken back by its agent, the latest changed first. Every item the task's
 * inbox holds is drawn, whether or not the window's list of agents has
 * caught up with the agent that posted it, since the service reads the
 * inbox by task and an agent's items go with it. A code block's lines are
 * read as the File tab reads a file, at the block's commit, with a few of
 * the file around them, the lines it points at lit. Nothing here draws.
 */

/** Why a card's last send did not go, or was not taken: its words, and the refusal they say where the service refused it. */
export interface InboxNote {
  readonly words: string;
  readonly failure?: AgentCallFailure | undefined;
}

/** What a card says under its box: the note's words, and whether Unarchive follows them. */
export interface InboxNoteReading {
  readonly words: string;
  readonly unarchive: boolean;
}

/** What a card says of a send refused because its agent is archived on its own. */
const AGENT_ARCHIVED_NOTE = "This agent is archived.";

/**
 * What a card says of its last send, by its agent as the window lists it.
 * Note that the service refuses a send to an agent archived on its own as
 * one that names nothing, so a refusal naming no agent says the agent is
 * archived, with Unarchive after it, where the list reads it archived, and
 * that the agent no longer exists only where it does not. A send no answer
 * came back for says the developer is offline while the app does not reach
 * the service, since the Offline mark says why.
 */
export function inboxNoteReading(
  note: InboxNote,
  agent: AgentSummary | undefined,
  connected: boolean,
): InboxNoteReading {
  const archived = note.failure === AGENT_CALL_FAILURE.NOT_FOUND && agent?.archivedAt !== undefined;

  if (archived) return { words: AGENT_ARCHIVED_NOTE, unarchive: true };
  const offline = !connected && note.failure === AGENT_CALL_FAILURE.UNANSWERED;

  return { words: offline ? UNHEARD_OFFLINE.ALONE : note.words, unarchive: false };
}

/** One file a message on the thread carried, as an item read names it. */
type InboxFile = NonNullable<InboxMessage["files"]>[number];

/**
 * The files a message on the thread carried as chips, in the
 * order they were attached: each by its name and type, its bytes as the
 * `data:` URL its read came back as where it did, and none while it is
 * read or where the read did not answer, which draws the chip by its name
 * alone.
 */
export function inboxFileChips(
  files: readonly InboxFile[],
  urls: ReadonlyMap<string, string>,
): FileChip[] {
  return files.map((file) => ({
    name: file.name,
    mediaType: file.mediaType,
    url: urls.get(file.attachmentId) ?? "",
  }));
}

/** The board as the tab draws it. */
export interface InboxBoardView {
  readonly open: readonly InboxItem[];
  /** The open items that wait on the reader at `now` (`waitsOnReaderNow`), in the order of `open`: what the task's Inbox counts, since a teammate's open item waits on the teammate and one the reader set a reminder on waits on nobody until it comes due. */
  readonly waiting: readonly InboxItem[];
  readonly settled: readonly InboxItem[];
}

/** The task's board from its inbox: what waits the oldest posted first, and what is settled the latest changed first; `readerId` and `now` say which of what waits waits on the reader. */
export function inboxBoard(
  items: readonly InboxItem[],
  readerId: string | undefined,
  now: number,
): InboxBoardView {
  const open = items
    .filter((item) => item.status === INBOX_STATUS.OPEN)
    .toSorted((a, b) => a.postedAt - b.postedAt);

  return {
    open,
    waiting: open.filter((item) => waitsOnReaderNow(item, readerId, now)),
    settled: items
      .filter((item) => item.status !== INBOX_STATUS.OPEN)
      .toSorted((a, b) => b.updatedAt - a.updatedAt),
  };
}

/**
 * The thread a call's row names by its key among a board's items: the
 * latest posted under it, of the agent whose row it was where the row names
 * one, since more than one agent may post under the same key.
 */
export function keyedItem(
  board: InboxBoardView,
  key: string,
  agentId: string | undefined,
): InboxItem | undefined {
  return [...board.open, ...board.settled]
    .filter((item) => item.key === key && (agentId === undefined || item.agentId === agentId))
    .reduce<InboxItem | undefined>(
      (latest, item) => (latest === undefined || item.postedAt > latest.postedAt ? item : latest),
      undefined,
    );
}

/** What a line of threads none of which waits on the developer says: "1 thread", "4 threads". */
export function threadsWords(count: number): string {
  return count === 1 ? "1 thread" : `${count} threads`;
}

/**
 * Whether an open item main lists holds an ask open rather than being a
 * notice. One from a service before it, which says nothing, counts as
 * asking, as every item did.
 */
export function holdsAsk(item: Pick<AppInboxWaitingItem, "asking">): boolean {
  return item.asking !== false;
}

/** How many lines of the file a code block's card draws above and below the lines it points at. */
const CODE_CONTEXT_LINES = 3;

/** Where a code block's card stands with its lines. */
export const CODE_READ = {
  READING: "reading",
  READY: "ready",
  /** The lines are not drawn, for the reason the card says. */
  NOTICE: "notice",
} as const;

export type CodeRead =
  | { readonly kind: typeof CODE_READ.READING }
  | { readonly kind: typeof CODE_READ.READY; readonly code: SnippetLines }
  | {
      readonly kind: typeof CODE_READ.NOTICE;
      readonly line: string;
      /** Whether reading again may draw the lines, which the card offers. */
      readonly again: boolean;
    };

/** What a code block's card says where its lines did not come back. */
const CODE_UNREAD = "These lines could not be read.";

/**
 * The window a code block's card reads: the lines it points at with a few
 * of the file around them, at the block's commit. Note that the window may
 * run past the file's end, which the service answers with the lines it has.
 */
export function codeWindow(block: InboxCodeBlock): TaskFileRequest {
  return {
    path: block.path,
    firstLine: Math.max(1, block.startLine - CODE_CONTEXT_LINES),
    lastLine: block.endLine + CODE_CONTEXT_LINES,
    ref: block.sha,
  };
}

/**
 * Why a code block's lines are not read at all, or nothing where they are
 * read: the task reads its own repository alone, which the agent's
 * repository was when it started but may not be once the task names
 * another, and lines that run backwards or past the bound are no window
 * the File tab's read takes. Note that GitHub spells a repository's name in
 * any case.
 */
export function codeNotice(block: InboxCodeBlock, repository: string | null): string | undefined {
  if (repository === null || repository.toLowerCase() !== block.repo.toLowerCase()) {
    return `These lines are in ${block.repo}, which this task no longer reads.`;
  }

  if (!codeLinesReadable(block)) return "These lines cannot be read.";

  return undefined;
}

/**
 * A code block's lines as its card holds them once the read answered: the
 * window the service read at the block's commit, the block's lines lit in
 * it; or why they are not drawn, a file that ends before they do included, and
 * whether reading again may draw them.
 */
export function codeReadOf(block: InboxCodeBlock, answer: TasksFileAnswer): CodeRead {
  if ("refusal" in answer) {
    return {
      kind: CODE_READ.NOTICE,
      line: refusalLine(answer.refusal, answer.branch, block.sha),
      again: refusalPasses(answer.refusal),
    };
  }

  if (!("file" in answer)) return { kind: CODE_READ.NOTICE, line: CODE_UNREAD, again: true };
  const { file } = answer;

  // Note that a file ending inside the lines is said too, because a card
  // drawing some of them would read, and copy, as all the agent meant.
  if (file.firstLine + file.lines.length <= block.endLine) {
    return {
      kind: CODE_READ.NOTICE,
      line: "The file ends before these lines do at this commit.",
      again: false,
    };
  }

  return {
    kind: CODE_READ.READY,
    code: {
      ref: { path: block.path, startLine: block.startLine, endLine: block.endLine },
      firstLine: file.firstLine,
      lines: file.lines,
    },
  };
}

/** A code block's card where the read did not land at all, as main refusing the act leaves it. */
export const CODE_READ_FAILED: CodeRead = {
  kind: CODE_READ.NOTICE,
  line: CODE_UNREAD,
  again: true,
};
