import { messageFailureWords } from "@repo/features/agent-refusal-words";
import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentInboxAnsweredView,
  type AgentInboxAnswerParams,
  type AgentInboxAttachmentParams,
  type AgentInboxAttachmentView,
  type AgentInboxMessagedView,
  type AgentInboxMessageParams,
  type AgentInboxStartParams,
  INBOX_SCOPE_KIND,
} from "@repo/features/agent-view";
import type { AgentAttachment } from "@repo/features/agent-wire";
import {
  answeredDraft,
  EMPTY_INBOX_DRAFT,
  type InboxDraft,
  inboxThreadSend,
} from "@repo/features/inbox-draft";
import { awaitsNod, knownAsk } from "@repo/features/inbox-list-model";
import {
  INBOX_ASK,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
} from "@repo/features/inbox-wire";
import type { AppInboxItems } from "@repo/host/app-state";
import { useMinute } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Equal } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DRAFT_PLACE,
  type Draft,
  draftOfItem,
  EMPTY_DRAFT,
  holdsPicks,
  type InboxPlace,
  picksStandOn,
  useDraftWriter,
  useInboxDraftStandings,
  useInboxDrafts,
  withoutPicks,
} from "../composer-drafts.js";
import { holderInboxQuery, holderInboxRetryMutation, inboxItemsQuery } from "../live-reads.js";
import type { PictureReader } from "../picture-query.js";
import { useSendQueue } from "../send-queue.js";

import type { InboxAcknowledger } from "./inbox-acknowledge.js";
import { useInboxArrivals } from "./inbox-arrivals.js";
import { type InboxBoardView, type InboxNote, inboxBoard } from "./inbox-model.js";
import {
  filesLost,
  type UndeliveredReply,
  undeliveredOn,
  undeliveredReplies,
} from "./inbox-undelivered.js";
import { type HeldUpdate, joinedAhead } from "./refused-send.js";

/**
 * use-task-inbox.ts -- the open task's inbox as one control: its items, drawn from the account's feed at once and from the holder's own read as the host holds it, and the answers on their way back.
 *
 * The holder's own read, a task's by its plan or an agent's by its own id,
 * is held (`live-reads.ts`) while the window shows the tasks and a task
 * with an agent, or one main says an item waits on, is open, so the tab's
 * count stands whichever tab is chosen; the host keeps it followed a while
 * after, so a task taken up again draws from where its read stands. The
 * account's feed of every item draws first, in the first frame, since it
 * holds the holder's items already, and the holder's read fills in what
 * the feed leaves out, such as settled items past its bound. Each read is
 * the inbox whole, which replaces what was held; nothing here asks again
 * or holds a cursor. An item marked read or unread reaches both reads as
 * any change does, so nothing reads it again. A holder's read that could
 * not be read says so, with Try again.
 *
 * A message on an item's thread goes under a key minted here and kept with
 * its words, open or settled, so the same message sent again after a lost
 * reply is taken once, and comes back as the item with its thread, which
 * replaces the one held; once taken it stands over the window's other
 * reads of the item until they hold it. It reaches the agent as one of the
 * developer's messages, which may wake it, so the agents are read again.
 * As the agent's own box does (`use-agent-composer.ts`), a send takes what
 * the box holds out of it at once, so the box stands empty and open while
 * the message is out and takes the next message straight away: nothing
 * holds it while the service answers. An item's messages go one at a time,
 * in the order sent, each under a key of its own, the next going once the
 * one before it answered (`../send-queue.ts`), since the service writes
 * each under the conversation's lock. A plain reply, one carrying no
 * answer, stands at the thread's end as the reader's own message the moment
 * it is sent, marked as sending, under the key it goes under, every reply
 * on its way in order, until its answer lands, when the item the service
 * answers holding it takes its place, or a read holding it first does. A
 * message that did not go, refused or answered by nothing, which may have
 * reached the agent all the same, never comes back into the box: it stays
 * at the thread's end marked Not delivered (`inbox-undelivered.ts`), as a
 * chat app keeps a message that did not go, and every reply queued behind
 * it stays after it unsent, since it would reach the agent ahead of the
 * one that did not go. Each offers Retry, which sends it again under the
 * key it went under, so one whose answer was lost reaches the agent once,
 * Edit, which takes its words, files, and picks back into the box, ahead of
 * what was written there since, and Delete. They are kept across a reload
 * and a relaunch, and a read holding a message under one's key settles it,
 * in whichever window, since that one went. A refusal also says why in the
 * box, which offers what mends it, as Unarchive. A message may carry the answer to
 * its thread's open ask, which the reader pressed and attached: such a
 * reply goes through the same queue, so a plain reply sent after it
 * follows it, and settles the ask, which the host draws into every read
 * the window draws the item from the moment it is sent (`@repo/host`'s
 * `inbox-collections.ts`), so the item leaves what needs the developer at
 * once and no read behind it brings it back, and one that did not go
 * brings the item back as it stood, the answer standing Not delivered.
 *
 * A notice's nod, Got it, goes the same way under a key minted for the
 * revision it nods to, so a nod sent again after a lost reply is taken
 * once, and the host draws it into every read as it draws an answer. It
 * goes after the item's replies on their way, through the same queue, and
 * holds the box until it answers, since it settles the notice. A nod to a notice its
 * agent posted over first is not taken, and the card says so above the
 * item as it now stands. A nod the agent waits on (`needsReply`) reaches
 * it, which may start its turn again, so the task's agents are read again
 * for where they stand.
 *
 * Each file a message carried and each picture of the item's own its
 * Markdown draws names an attachment the service keeps, and their bytes are
 * read apart from the inbox, once per attachment while the task is open,
 * as a card first draws it: the host fetches them under the account
 * and the window keeps each under its item and attachment as it keeps every
 * picture (`../picture-query.ts`), as a `data:` URL the card draws, so a
 * read of the inbox that replaces every item draws the same picture again
 * without asking for it again, a picture inside a settled card no one
 * opened is never asked for, and one no card draws any longer is let go a
 * while after. A read that did not answer draws as failed, and the card
 * offers to try again.
 *
 * What the developer has put on a card and not sent is its draft, kept by
 * item (`../composer-drafts.ts`), so it waits through a look at another tab,
 * task, or page, the Inbox's and the plan's tab reading the same one, and
 * its words outlast a relaunch; the files attached to it are held in this
 * window's memory alone, as a message's are. A settled item's box keeps the
 * message being written the same way, in the same place, so a message
 * landing on the item, the agent posting on it again or a teammate's answer
 * settling it, never takes what is being written. Its picks are kept with
 * the revision they were made on and stand only while the item is open at
 * it. A read of the inbox lets go of the drafts of items it no longer holds
 * and of the picks it holds made on an item since changed, and a message
 * written lets go of its own.
 */

/** How one nod is sent: the item, the revision it nods to, and the key the send is known by. */
export type InboxAnswerer = (params: AgentInboxAnswerParams) => Promise<AgentInboxAnsweredView>;

/** How one message on an item's thread is sent: the item, the words and files, and the key the send is known by. */
export type InboxMessenger = (params: AgentInboxMessageParams) => Promise<AgentInboxMessagedView>;

/** How one thread is started with an agent: the agent, its subject, the words and files, and the key the send is known by. */
export type InboxThreadStarter = (params: AgentInboxStartParams) => Promise<AgentInboxMessagedView>;

/** How one image is read: the item and the attachment it names, answered as the view hears it. */
export type InboxImageReader = (
  params: AgentInboxAttachmentParams,
) => Promise<AgentInboxAttachmentView>;

/** A plain reply on its way, drawn at its thread's end until the item holds it: the key it goes under, its words and files, and when it was sent. */
export interface PendingInboxReply {
  readonly key: string;
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly at: number;
}

/** No replies on their way, one array so an item with none hands down the same one. */
const NO_REPLIES: readonly PendingInboxReply[] = [];

/**
 * Whether the item's thread holds the message sent under `key`, which the
 * service names on the reader's own messages alone. Note that the one the
 * host draws for an answer while it goes stands under the key as its id,
 * and carries none.
 */
function holdsSent(item: InboxItem, key: string): boolean {
  return (item.thread ?? []).some((message) => message.clientKey === key);
}

/** The replies on their way on `item`, in the order sent, but for those the thread drawn holds under their keys already, as a read may before a reply's own answer lands. */
export function pendingRepliesOn(
  pending: TaskInboxControl["pendingReplies"],
  item: InboxItem,
): readonly PendingInboxReply[] {
  const replies = pending.get(item.id);

  if (replies === undefined) return NO_REPLIES;

  return replies.filter((reply) => !holdsSent(item, reply.key));
}

/** The replies on `item` that did not go, in the order they failed, but for those the thread drawn holds under their keys already, as a read may before they are let go of. */
export function undeliveredRepliesOn(
  control: Pick<TaskInboxControl, "undelivered" | "pendingReplies">,
  item: InboxItem,
): readonly UndeliveredReply[] {
  const pending = control.pendingReplies.get(item.id) ?? NO_REPLIES;

  // Note that an answer on its way again stands drawn by the host under its key as the message's id.
  const out = (key: string) =>
    pending.some((reply) => reply.key === key) ||
    (item.thread ?? []).some((message) => message.id === key);

  return undeliveredOn(control.undelivered, item.id, (key) => holdsSent(item, key) || out(key));
}

/** What the tab draws and presses. */
export interface TaskInboxControl {
  readonly board: InboxBoardView;
  /** Whether a read is out, with nothing held yet to draw: neither the account's feed nor the holder's own read holds the holder. */
  readonly reading: boolean;
  /** Whether the holder's own read has answered, so the board holds what the feed leaves out, such as a settled item past its bound. */
  readonly read: boolean;
  /** Whether the board draws the holder's items, from the account's feed or the holder's own read, so an item opened is as the service holds it. */
  readonly drawn: boolean;
  /** Whether the last read did not answer, so the tab offers to try again. */
  readonly failed: boolean;
  readonly onRetry: () => void;
  /** The items whose nod is on its way, by id, which holds the box until it answers. */
  readonly sending: ReadonlySet<string>;
  /** The plain replies on their way, by item, in the order sent, each drawn at its thread's end while it goes (`pendingRepliesOn`). */
  readonly pendingReplies: ReadonlyMap<string, readonly PendingInboxReply[]>;
  /** The replies that did not go on the task's items, in the order they failed, each drawn at its thread's end marked Not delivered (`undeliveredRepliesOn`). */
  readonly undelivered: readonly UndeliveredReply[];
  /** Sends a reply that did not go again under the key it went under, after every message of the item's on its way; nothing where a nod is out. */
  readonly onRetryUndelivered: (item: InboxItem, key: string) => void;
  /** Takes a reply that did not go back into the item's box, ahead of what the box holds, its answer's picks with it, so the same words sent again go under its key. */
  readonly onEditUndelivered: (item: InboxItem, key: string) => void;
  /** Lets go of a reply that did not go. */
  readonly onDropUndelivered: (key: string) => void;
  /** Why a send did not go, or was not taken, by item, said on its card until the next send. */
  readonly notes: ReadonlyMap<string, InboxNote>;
  /** Lets go of an item's note once what it said no longer stands, as an agent unarchived from it; nothing where a later send has said something else since. */
  readonly onDropNote: (itemId: string, note: InboxNote) => void;
  /** What the developer has put on the item's card so far, at the revision it stands at; an empty card where nothing, or where the agent has changed the item since. */
  readonly draftOf: (item: InboxItem) => InboxDraft;
  /** Whether a card holds a draft for its item as it now stands, which the Inbox tab marks with the pencil (`draft-mark.tsx`). */
  readonly drafted: boolean;
  /** Keeps what the developer has put on the item's card, at its revision. */
  readonly onDraft: (item: InboxItem, draft: InboxDraft) => void;
  /** Moves the files on the item's card on from what they are as the write lands, so two reads landing in one render both stand. */
  readonly onAttachments: (
    item: InboxItem,
    next: (was: readonly AgentAttachment[]) => readonly AgentAttachment[],
  ) => void;
  /** Moves the words and files on the item's card on together from what they are as the write lands, as a refused send put back does (`refused-send.ts`). */
  readonly onHeld: (item: InboxItem, next: Parameters<HeldUpdate>[0]) => void;
  /** Nods to a notice, settling it at the revision drawn, after every message of the item's on its way; nothing where a nod is out. Got it pressed hands its nod to `held` once its turn comes, which holds it behind an Undo (`inbox-acknowledge.tsx`); an opening sends it as it is (`useNodOnOpen`). */
  readonly onAcknowledge: (item: InboxItem, held?: InboxAcknowledger) => void;
  /** Sends the box's words and files as a message on the item's thread, open or settled, with the answer attached to the thread's open ask where one is, after every message of the item's on its way; nothing where it holds nothing the service takes or a nod is out. `taken` is called once the service took it, never where it refused it. */
  readonly onMessage: (item: InboxItem, draft: InboxDraft, taken?: () => void) => void;
  /** How a card's image is read, by its item and attachment, and kept as the window's pictures are (`../picture-query.ts`). */
  readonly images: InboxImageReads;
}

/** What a card says when its nod was not taken, by what had become of the item. */
const INBOX_NOT_TAKEN_NOTE = {
  /** The agent changed the item before the nod landed. */
  CHANGED: "The agent changed this item before your answer landed. Answer it as it stands now.",
  /** The item was answered first, from another window or Mac. */
  ANSWERED: "This item was already answered.",
  /** The agent took the item back first. */
  CLOSED: "The agent took this item back.",
  /** A member resolved the item first, from another window or Mac. */
  CLOSED_BY_MEMBER: "This item was already resolved.",
} as const;

/** Why a nod was not taken, from the item as the service answered it. */
function notTakenNote(item: InboxItem): string {
  switch (item.status) {
    case INBOX_STATUS.ANSWERED:
      return INBOX_NOT_TAKEN_NOTE.ANSWERED;
    case INBOX_STATUS.CLOSED:
      return item.closedBy === undefined
        ? INBOX_NOT_TAKEN_NOTE.CLOSED
        : INBOX_NOT_TAKEN_NOTE.CLOSED_BY_MEMBER;
    case INBOX_STATUS.OPEN:
      return INBOX_NOT_TAKEN_NOTE.CHANGED;
  }
}

/** A send's key and words, kept so the same send sent again goes under the same key. */
interface Attempt {
  readonly key: string;
  readonly words: string;
}

/**
 * The key a send of `words` on the item goes under: the one the same words
 * went under before, where a refusal brought them back, so the send is
 * taken once; else a fresh one. Note that the words let go of their key as
 * they go, because the same words sent again while the first is out, or
 * once it is taken, are a new message, which the service refuses under a
 * key already spent.
 */
function keyFor(attempts: Map<string, Attempt>, itemId: string, words: string): string {
  const was = attempts.get(itemId);
  attempts.delete(itemId);

  return was?.words === words ? was.key : crypto.randomUUID();
}

/** A reply queued on its item: what the service is asked, when it was sent, and how it stands on the thread, a plain one alone. */
interface QueuedReply {
  readonly params: AgentInboxMessageParams;
  readonly at: number;
  readonly shown: PendingInboxReply | undefined;
}

/** What a reply sends: its words and files, the answer it carries, and the notice's revision it settles. */
interface ReplySent {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly answers?: InboxAnswers | undefined;
  readonly revision?: number | undefined;
}

/** The words a reply is known by, which the same reply sent again is known by too, so it goes under the same key (`keyFor`). */
function sentWords({ text, attachments, answers, revision }: ReplySent): string {
  return JSON.stringify([text, attachments, answers, revision]);
}

/** A reply as it is queued on `itemId` under `key`, sent now: a plain one standing on the thread at once as the reader's own message, one carrying an answer drawn settled by the host. */
function queuedReply(itemId: string, sent: ReplySent, key: string): QueuedReply {
  const { text, attachments, answers, revision } = sent;
  const at = Date.now();

  return {
    params: {
      itemId,
      text,
      ...(attachments.length === 0 ? undefined : { attachments }),
      ...(answers === undefined ? undefined : { answers }),
      ...(revision === undefined ? undefined : { revision }),
      clientKey: key,
    },
    at,
    shown: answers === undefined ? { key, text, attachments, at } : undefined,
  };
}

/** Why a reply queued behind one that did not go did not go itself. */
const BEHIND_UNDELIVERED = "Not sent, because the reply before it did not go.";

/** Why a reply no answer came back for is marked, which may have reached the agent all the same. */
const UNHEARD_UNDELIVERED =
  "No answer came back, so this may not have reached the agent. Retry sends it only once.";

/** A queued reply that did not go, on the task `taskId`, as its thread keeps it. */
function undeliveredOf(reply: QueuedReply, taskId: string | null, why: string): UndeliveredReply {
  const { itemId, clientKey: key, text, attachments, answers, revision } = reply.params;

  return {
    key,
    taskId,
    itemId,
    text,
    attachments: attachments ?? [],
    files: attachments?.length ?? 0,
    ...(answers === undefined ? undefined : { answers }),
    ...(revision === undefined ? undefined : { revision }),
    at: reply.at,
    why,
  };
}

interface Held {
  readonly taskId: string | undefined;
  readonly items: readonly InboxItem[];
  /** Whether the items are a read's, the feed's or the holder's own, rather than nothing yet. */
  readonly drawn: boolean;
}

/** The holder's items as its reads first stand: those read already, so a holder drawn again draws them in its first frame. */
function fresh(taskId: string | undefined, read: readonly InboxItem[] | undefined): Held {
  return { taskId, items: read ?? [], drawn: read !== undefined };
}

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/**
 * The plan's items as the account's feed holds them, whole; none where the
 * feed has not answered, or holds nothing of the plan, whose own read may
 * still hold a settled item past the feed's bound.
 */
function fedItemsOf(
  fed: AppInboxItems | undefined,
  taskId: string | undefined,
): readonly InboxItem[] | undefined {
  return fed === undefined || taskId === undefined ? undefined : fed[INBOX_SCOPE_KIND.PLAN][taskId];
}

/** An Inbox's pictures as its cards read them: by the item, as the scope the window keeps them under, and the attachment. */
export interface InboxImageReads {
  readonly read: PictureReader;
}

/** Where an item's card keeps its draft: the item, whatever its revision or status, so a message landing on it never moves the words being written. */
function draftPlace(item: InboxItem, taskId: string | null): InboxPlace {
  return { kind: DRAFT_PLACE.INBOX, planId: taskId, agentId: item.agentId, itemId: item.id };
}

/** The items with one replaced by the service's newer word on it. */
function withItem(items: readonly InboxItem[], item: InboxItem): readonly InboxItem[] {
  return items.some((each) => each.id === item.id)
    ? items.map((each) => (each.id === item.id ? item : each))
    : [item, ...items];
}

/**
 * Whether a draft's picks were made on its item as the read holds it or
 * earlier, so they can be let go where they stand no longer. Note that a
 * reader holding an older revision than the picks were made on, as one
 * reader of a plan does while another has heard the agent's newer post
 * first, leaves them be, since its read is what is out of date.
 */
function caughtUp(item: InboxItem, draft: Pick<Draft, "revision">): boolean {
  return draft.revision === undefined || item.revision >= draft.revision;
}

/** A card's draft as the drafts keep it, its picks made on the item at `revision`. */
function keptDraft(draft: InboxDraft, revision: number): Draft {
  return {
    revision,
    text: draft.note,
    attachments: draft.attachments,
    choices: draft.choices,
    values: draft.values,
    steps: draft.steps,
    press: draft.press,
  };
}

/**
 * What a box holds once a reply that did not go is taken back into it: its
 * words and files, then those written there since, and its picks unless
 * others were made meanwhile.
 */
function withTakenBack(now: Draft, went: Draft): Draft {
  if (holdsNothing(now)) return went;

  return { ...(holdsPicks(now) ? now : went), ...joinedAhead(went, now) };
}

/**
 * A reply that did not go as its box held it, at the item's revision: its
 * words and files, and the picks its answer made on the ask, where the
 * thread still carries the ask, so taking it back fills the ask's controls
 * as they stood. Note that a press is kept for a `do` alone, whose Mark done
 * or Couldn't do it it is.
 */
function draftOfUndelivered(item: InboxItem, reply: UndeliveredReply): Draft {
  const { answers } = reply;
  const ask = answers === undefined ? undefined : askAnswered(item, answers);

  const picks =
    ask === undefined || answers === undefined ? EMPTY_INBOX_DRAFT : answeredDraft(ask, answers);

  const press = ask?.type === INBOX_ASK.DO ? picks.press : undefined;

  return keptDraft(
    { ...picks, press, note: reply.text, attachments: reply.attachments },
    item.revision,
  );
}

/** The ask an answer answers, where the item's thread still carries it and this build knows it. */
function askAnswered(item: InboxItem, answers: InboxAnswers) {
  const ask = (item.thread ?? []).find((message) => message.id === answers.ask)?.ask;

  return ask !== undefined && knownAsk(ask) ? ask : undefined;
}

/** Whether a card holds nothing at all: no words, files, picks, fields, steps, or press. */
function holdsNothing(draft: Draft): boolean {
  return (
    draft.text === "" &&
    draft.attachments.length === 0 &&
    draft.choices.length === 0 &&
    draft.values.length === 0 &&
    (draft.steps ?? []).length === 0 &&
    draft.press === undefined
  );
}

/** The doors of a held read's cards' drafts (`useInboxCardDrafts`). */
type InboxCardDrafts = Pick<
  TaskInboxControl,
  "draftOf" | "drafted" | "onDraft" | "onAttachments" | "onHeld"
>;

/**
 * A held read without its cards' drafts, which the window's Inbox reads in
 * its pane alone (`useHeldTaskInbox`); and its holder's own read whole, none
 * until it answers, which alone says an item is gone (`useInboxDraftsLetGo`).
 */
export type HeldTaskInboxControl = Omit<TaskInboxControl, keyof InboxCardDrafts> & {
  readonly whole: readonly InboxItem[] | undefined;
};

/** The open task's inbox as one control, its cards' drafts among it: its held read (`useHeldTaskInbox`), the drafts it lets go (`useInboxDraftsLetGo`), and those drafts (`useInboxCardDrafts`). */
export function useTaskInbox(input: Parameters<typeof useHeldTaskInbox>[0]): TaskInboxControl {
  const held = useHeldTaskInbox(input);
  useInboxDraftsLetGo(held, input);

  return { ...held, ...useInboxCardDrafts(held, input) };
}

/**
 * The open task's inbox as one control, but for its cards' drafts, which
 * it reads none of, so a word typed in a box draws nothing that holds it:
 * the window's Inbox holds it at its page, beside the drafts it lets go
 * (`useInboxDraftsLetGo`), and reads the drafts in its pane, which draws the
 * box (`useInboxCardDrafts`).
 */
export function useHeldTaskInbox(input: {
  /** The task whose inbox is held, under which its cards keep their drafts. */
  taskId: string | undefined;
  /** Whether the window shows the tasks. */
  shown: boolean;
  /** Whether this Inbox is the one on screen, which says what lands in it (`inbox-arrivals.ts`); none where it is not. */
  onScreen?: boolean | undefined;
  /** Whether main's read of what waits across the account says an item waits on the task. */
  waiting: boolean;
  /** The reader's account id, which says whose of the open items wait on them; none before it is known. */
  readerId: string | undefined;
  agents: {
    /** Every agent of the task by id, an archived one among them, whose items still stand. */
    readonly heldIds: readonly string[] | undefined;
    readonly answerInbox: InboxAnswerer;
    readonly messageInbox: InboxMessenger;
    readonly readInboxImage: InboxImageReader;
    /** Reads the task's agents again, for where an agent an answer reached stands now. */
    readonly onRetryList: () => void;
  };
}): HeldTaskInboxControl {
  const { taskId, shown, waiting, readerId, agents } = input;

  // A task with no agent, standing or archived, has no Inbox tab and nothing
  // to read, unless an item waits on it, which an agent this window has not
  // listed, one started on another Mac, posted.
  const readable = (agents.heldIds?.length ?? 0) > 0 || waiting;
  const active = shown && taskId !== undefined && readable;
  const holderKey = active ? { kind: INBOX_SCOPE_KIND.PLAN, id: taskId } : undefined;
  const holder = useQuery(holderInboxQuery(holderKey));
  const { mutate: retryHolder } = useMutation(holderInboxRetryMutation());
  // Note that Try again moves with the holder alone, as the read's own did, since a render builds its key anew.
  const holderId = holderKey?.id;

  const onRetry = useCallback(() => {
    if (holderId !== undefined) retryHolder({ kind: INBOX_SCOPE_KIND.PLAN, id: holderId });
  }, [retryHolder, holderId]);

  const feed = useQuery(inboxItemsQuery());
  const fed = fedItemsOf(feed.data, taskId);
  // The holder's own read stands in for the feed's once it answered, since it holds what the feed leaves out.
  const pushed = holder.data ?? fed;
  const read = holder.isSuccess;
  const failed = holder.isError;
  const [held, setHeld] = useState<Held>(() => fresh(taskId, pushed));

  if (held.taskId !== taskId) setHeld(fresh(taskId, pushed));
  useInboxArrivals(
    { taskId: held.taskId, items: held.items, read: held.drawn },
    input.onScreen === true,
  );
  const readInboxImage = input.agents.readInboxImage;

  const images = useMemo<InboxImageReads>(
    () => ({
      read: (itemId, attachmentId) => readInboxImage({ itemId, attachmentId }),
    }),
    [readInboxImage],
  );

  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());

  const [pendingReplies, setPendingReplies] = useState<
    ReadonlyMap<string, readonly PendingInboxReply[]>
  >(new Map());

  const [notes, setNotes] = useState<ReadonlyMap<string, InboxNote>>(new Map());
  const undeliveredAll = useSelector(undeliveredReplies.store);
  // Note that the cards keep their drafts under the task, so another tab's or page's reading of its inbox shares them.
  const draftsOn = taskId ?? null;
  const writer = useDraftWriter();
  const attempts = useRef(new Map<string, Attempt>());
  // The items whose nod is out, as `sending` holds them but at once, so a second press before
  // the render that draws the first sends nothing again.
  const out = useRef(new Set<string>());
  // Each item's sends as one queue, the next going once the one before it answered.
  const queue = useSendQueue();
  // Each item's replies on their way, in the order sent, read as a send's turn comes, since one
  // let go before then, queued behind a refusal, sends nothing.
  const queued = useRef(new Map<string, readonly QueuedReply[]>());
  // Each item as the service last answered a reply on it, which a nod queued behind that reply reads.
  const answered = useRef(new Map<string, InboxItem>());
  const latest = useRef({ ...agents, taskId });
  latest.current = { ...agents, taskId };

  // Each read is the inbox whole, which replaces what was held, an answer's own patch among it.
  // Note that a holder neither read holds any more, as after a sign-out, is let go with its items, so nothing of the last account stands drawn.
  useEffect(() => {
    if (pushed === undefined) {
      setHeld((was) => (was.drawn ? fresh(was.taskId, undefined) : was));

      return;
    }

    setHeld((was) =>
      was.drawn && was.items === pushed ? was : { ...was, items: pushed, drawn: true },
    );
  }, [pushed]);

  const note = useCallback((itemId: string, said: InboxNote | undefined) => {
    setNotes((was) => {
      const next = new Map(was);

      if (said === undefined) next.delete(itemId);
      else next.set(itemId, said);

      return next;
    });
  }, []);

  const onDropNote = useCallback((itemId: string, said: InboxNote) => {
    setNotes((was) => {
      if (was.get(itemId) !== said) return was;
      const next = new Map(was);
      next.delete(itemId);

      return next;
    });
  }, []);

  // Note that a refusal naming no agent may be an archive the list has not read yet, so the agents are read again for the card to say which.
  const refused = useCallback(
    (itemId: string, failure: AgentCallFailure): InboxNote => {
      const said = { words: messageFailureWords(failure), failure };
      note(itemId, said);

      if (failure === AGENT_CALL_FAILURE.NOT_FOUND) latest.current.onRetryList();

      return said;
    },
    [note],
  );

  /** Changes an item's replies on their way, and draws the plain ones among them at its thread's end, in order. */
  const requeue = useCallback(
    (itemId: string, change: (was: readonly QueuedReply[]) => readonly QueuedReply[]) => {
      const next = change(queued.current.get(itemId) ?? []);

      if (next.length === 0) queued.current.delete(itemId);
      else queued.current.set(itemId, next);
      const shown = next.flatMap((reply) => (reply.shown === undefined ? [] : [reply.shown]));
      setPendingReplies((standing) => {
        if (shown.length === 0 && !standing.has(itemId)) return standing;
        const drawn = new Map(standing);

        if (shown.length === 0) drawn.delete(itemId);
        else drawn.set(itemId, shown);

        return drawn;
      });
    },
    [],
  );

  // The task's replies that did not go, in the order they failed.
  const undelivered = useMemo(
    () => undeliveredAll.filter((reply) => reply.taskId === draftsOn),
    [undeliveredAll, draftsOn],
  );

  // Note that a reply that did not go is taken as sent once a read holds a message under its key, since
  // one no answer came back for may have landed, and lets go of its line, whichever window sent it.
  const whole = holder.data;
  useEffect(() => {
    if (!held.drawn || (held.taskId ?? null) !== draftsOn) return;

    const settled = undelivered.filter((reply) => {
      const item = held.items.find((each) => each.id === reply.itemId);

      // Note that only the holder's own read says an item is gone, since the feed leaves out a settled item past its bound.
      if (item === undefined)
        return whole !== undefined && !whole.some((each) => each.id === reply.itemId);

      return holdsSent(item, reply.key);
    });

    if (settled.length === 0) return;
    const keys = new Set(settled.map((reply) => reply.key));
    undeliveredReplies.set((now) => now.filter((reply) => !keys.has(reply.key)));
  }, [held, whole, undelivered, draftsOn]);

  // Note that a nod is keyed by the revision it nods to, so a press again after a lost reply is
  // taken once, and a nod to the notice posted over since goes under a key of its own.
  const onAcknowledge = useCallback(
    (item: InboxItem, held?: InboxAcknowledger) => {
      if (out.current.has(item.id)) return;
      out.current.add(item.id);
      const words = JSON.stringify([item.revision, INBOX_REPLY.ACKNOWLEDGED]);
      const key = keyFor(attempts.current, item.id, words);
      setSending((standing) => new Set(standing).add(item.id));
      note(item.id, undefined);

      const release = () => {
        out.current.delete(item.id);
        setSending((standing) => {
          const next = new Set(standing);
          next.delete(item.id);

          return next;
        });
      };

      // Note that the nod goes after the item's replies on their way, and holds the box meanwhile, since it settles the notice.
      queue.after(item.id, async () => {
        // A nod behind a reply that settled the notice at this revision has nothing left to nod to, and says nothing.
        const settled = answered.current.get(item.id);

        if (settled !== undefined && settled.revision === item.revision && !awaitsNod(settled)) {
          release();

          return;
        }

        // Note that a Got it pressed goes held, its toast saying what became of it, and draws the notice settled at once, so the box is let go.
        if (held !== undefined) {
          held([item]);
          release();

          return;
        }

        const answer = await latest.current
          .answerInbox({
            itemId: item.id,
            revision: item.revision,
            reply: INBOX_REPLY.ACKNOWLEDGED,
            clientKey: key,
          })
          .catch((): AgentInboxAnsweredView => UNANSWERED);

        release();

        if ("failure" in answer) {
          attempts.current.set(item.id, { key, words });
          refused(item.id, answer.failure);

          return;
        }

        if (!answer.taken) {
          note(item.id, { words: notTakenNote(answer.item) });

          return;
        }

        // Note that a nod the agent waits on reaches it and may open its turn, so the agents are read again.
        if (item.needsReply) latest.current.onRetryList();
      });
    },
    [note, refused, queue],
  );

  // Note that a reply goes through its item's queue under its key, standing on the thread while it goes.
  const sendReply = useCallback(
    (item: InboxItem, reply: QueuedReply, taken?: () => void) => {
      requeue(item.id, (was) => [...was, reply]);
      const askedOn = taskId;
      const keptOn = draftsOn;
      // Note that the reply is known by its key, since those behind one that lands are drawn afresh.
      const ours = (each: QueuedReply) => each.params.clientKey === reply.params.clientKey;
      queue.after(item.id, async () => {
        // A reply let go before its turn, queued behind one that did not go, sends nothing.
        if (!(queued.current.get(item.id) ?? []).some(ours)) return;

        const answer = await latest.current
          .messageInbox(reply.params)
          .catch((): AgentInboxMessagedView => UNANSWERED);

        if ("failure" in answer) {
          // Note that the reply and every one queued behind it stay on the thread marked Not delivered, in
          // the order sent, rather than going back into the box, since one no answer came back for may have
          // reached the agent; none behind it goes ahead of it, and Retry sends each under its own key.
          const standing = queued.current.get(item.id) ?? [];
          const behind = standing.slice(standing.findIndex(ours) + 1);
          requeue(item.id, (was) => was.filter((each) => !ours(each) && !behind.includes(each)));
          const unheard = answer.failure === AGENT_CALL_FAILURE.UNANSWERED;
          const why = unheard ? UNHEARD_UNDELIVERED : messageFailureWords(answer.failure);

          const lines = [
            undeliveredOf(reply, keptOn, why),
            ...behind.map((each) => undeliveredOf(each, keptOn, BEHIND_UNDELIVERED)),
          ];

          // Note that a reply Retry sent again stands where it stood, so its line is written over rather than kept twice.
          undeliveredReplies.set((now) => [
            ...now.filter((line) => !lines.some((each) => each.key === line.key)),
            ...lines,
          ]);

          // Note that a refusal is said in the box too, which offers what mends it, as Unarchive.
          if (!unheard) refused(item.id, answer.failure);

          return;
        }

        // Note that the reply is let go under its own key, in the render its answer's item lands in, so it never stands beside the message it became.
        requeue(item.id, (was) => was.filter((each) => !ours(each)));
        undeliveredReplies.set((now) => now.filter((line) => line.key !== reply.params.clientKey));
        answered.current.set(item.id, answer.item);
        // Note that the item as the service answered it lands in the render the reply on its way leaves, whichever of the answer and the host's push comes first.
        setHeld((standing) =>
          standing.taskId === askedOn
            ? { ...standing, items: withItem(standing.items, answer.item) }
            : standing,
        );
        // Note that a message reaches the agent as one of the developer's, which may wake it, so the agents are read again.
        latest.current.onRetryList();
        taken?.();
      });
    },
    [refused, taskId, draftsOn, queue, requeue],
  );

  const onMessage = useCallback(
    (item: InboxItem, draft: InboxDraft, taken?: () => void) => {
      const message = inboxThreadSend(item.thread ?? [], draft);

      // Note that a nod on its way holds the box, so nothing goes behind it.
      if (message === undefined || out.current.has(item.id)) return;
      // Note that a reply on a notice names the revision shown, so it settles that notice and never one posted since.
      const sent = { ...message, revision: awaitsNod(item) ? item.revision : undefined };
      const key = keyFor(attempts.current, item.id, sentWords(sent));
      note(item.id, undefined);
      // Note that the box lets go of what it sent at once, as the agent's box does, and never takes it back.
      writer.update(draftPlace(item, draftsOn), () => EMPTY_DRAFT);
      sendReply(item, queuedReply(item.id, sent, key), taken);
    },
    [note, writer, draftsOn, sendReply],
  );

  const onRetryUndelivered = useCallback(
    (item: InboxItem, key: string) => {
      const reply = undeliveredReplies.store.state.find((each) => each.key === key);

      // Note that a reply a relaunch took the files from never goes without them; Edit attaches them again.
      if (reply === undefined || filesLost(reply) || out.current.has(item.id)) return;
      note(item.id, undefined);
      // Note that its line stays kept while it goes again, so a reload meanwhile loses nothing; its answer lets it go.
      sendReply(item, queuedReply(item.id, reply, key));
    },
    [note, sendReply],
  );

  // Note that the words taken back and sent again as they were go under the key they went under, so a reply that landed unheard is taken once.
  const onEditUndelivered = useCallback(
    (item: InboxItem, key: string) => {
      const reply = undeliveredReplies.store.state.find((each) => each.key === key);

      if (reply === undefined) return;
      undeliveredReplies.set((now) => now.filter((each) => each.key !== key));
      note(item.id, undefined);
      attempts.current.set(item.id, { key, words: sentWords(reply) });
      const went = draftOfUndelivered(item, reply);
      writer.update(draftPlace(item, draftsOn), (now) => withTakenBack(now, went));
    },
    [note, writer, draftsOn],
  );

  const onDropUndelivered = useCallback((key: string) => {
    undeliveredReplies.set((now) => now.filter((each) => each.key !== key));
  }, []);

  // An item of an agent the list has not read yet, one started from another
  // window, has the list read again, once for each such agent.
  const asked = useRef(new Set<string>());
  const ids = agents.heldIds;
  useEffect(() => {
    if (ids === undefined) return;

    const unknown = held.items
      .map((item) => item.agentId)
      .filter((agentId) => !ids.includes(agentId) && !asked.current.has(agentId));

    if (unknown.length === 0) return;

    for (const agentId of unknown) asked.current.add(agentId);
    latest.current.onRetryList();
  }, [held.items, ids]);

  // Note that the clock moves with the minute, so a thread whose reminder comes due counts again without a read.
  const now = useMinute();
  const board = useMemo(() => inboxBoard(held.items, readerId, now), [held.items, readerId, now]);

  return {
    board,
    reading: active && !held.drawn && !failed,
    read,
    drawn: held.drawn,
    failed,
    onRetry,
    whole: holder.data,
    sending,
    pendingReplies,
    undelivered,
    onRetryUndelivered,
    onEditUndelivered,
    onDropUndelivered,
    notes,
    onDropNote,
    onAcknowledge,
    onMessage,
    images,
  };
}

/** Whose read a held read's cards' drafts are kept under: the task's. */
interface DraftScopeOf {
  readonly taskId: string | undefined;
}

/**
 * Lets go of the cards' drafts a held read covers (`useHeldTaskInbox`) once
 * it draws its holder's items: those of the items it no longer holds, and
 * the picks of those whose items changed since they were made. Note that
 * only the holder's own read says an item is gone (`whole`), since the feed
 * leaves out a settled item past its bound whose draft still stands. Note
 * too that it reads where each draft stands and never its words
 * (`useInboxDraftStandings`), so what holds the read draws nothing for a
 * word typed; and that it stands for as long as the read does, rather than
 * with the box, so an item gone from under its open box takes its draft
 * with it.
 */
export function useInboxDraftsLetGo(
  control: Pick<HeldTaskInboxControl, "board" | "drawn" | "whole">,
  scope: DraftScopeOf,
): void {
  const { taskId } = scope;
  const standings = useInboxDraftStandings();
  const { drop, update } = useDraftWriter();
  const { board, drawn, whole } = control;
  const items = useMemo(() => [...board.open, ...board.settled], [board]);
  // Note that the agent posting on the item again, or a teammate settling it, lets only the picks go,
  // which stand on the ask as it was, while the words and files being written stay as they are.
  useEffect(() => {
    if (!drawn || taskId === undefined) return;
    const covered = standings.filter(({ place }) => place.planId === taskId);

    const gone =
      whole === undefined
        ? []
        : covered.filter((kept) => !whole.some((item) => item.id === kept.place.itemId));

    const lapsed = covered.filter((kept) => {
      const item = items.find((each) => each.id === kept.place.itemId);

      return (
        item !== undefined && caughtUp(item, kept) && !picksStandOn(kept.revision, kept.picks, item)
      );
    });

    for (const kept of lapsed) update(kept.place, withoutPicks);

    if (gone.length > 0) drop((place) => gone.some((kept) => Equal.equals(kept.place, place)));
  }, [drawn, items, whole, taskId, standings, drop, update]);
}

/**
 * The cards' drafts of a held read (`useHeldTaskInbox`), as the box that
 * writes them reads them (`../composer-drafts.ts`), read here alone, so a
 * word typed in a box draws only what reads this.
 */
export function useInboxCardDrafts(
  control: Pick<HeldTaskInboxControl, "board">,
  scope: DraftScopeOf,
): InboxCardDrafts {
  const draftsOn = scope.taskId ?? null;
  const drafts = useInboxDrafts(draftsOn);
  const writer = useDraftWriter();
  const { board } = control;
  const items = useMemo(() => [...board.open, ...board.settled], [board]);

  const draftOf = useCallback(
    (item: InboxItem): InboxDraft => {
      const found = drafts.find((each) => each.place.itemId === item.id);
      const kept = found === undefined ? undefined : draftOfItem(found, item);

      return kept === undefined
        ? EMPTY_INBOX_DRAFT
        : {
            choices: kept.choices,
            values: kept.values,
            note: kept.text,
            attachments: kept.attachments,
            steps: kept.steps,
            press: kept.press,
          };
    },
    [drafts],
  );

  const drafted = drafts.some((kept) =>
    items.some((item) => item.id === kept.place.itemId && !holdsNothing(draftOfItem(kept, item))),
  );

  const onDraft = useCallback(
    (item: InboxItem, draft: InboxDraft) =>
      writer.update(draftPlace(item, draftsOn), (was) => ({
        ...was,
        revision: item.revision,
        text: draft.note,
        choices: draft.choices,
        values: draft.values,
        attachments: draft.attachments,
        steps: draft.steps,
        press: draft.press,
      })),
    [writer, draftsOn],
  );

  const onAttachments = useCallback(
    (item: InboxItem, next: (was: readonly AgentAttachment[]) => readonly AgentAttachment[]) =>
      writer.update(draftPlace(item, draftsOn), (was) => ({
        ...was,
        attachments: next(was.attachments),
      })),
    [writer, draftsOn],
  );

  const onHeld = useCallback(
    (item: InboxItem, next: Parameters<HeldUpdate>[0]) =>
      writer.update(draftPlace(item, draftsOn), (was) => {
        const moved = next(was);

        return moved === undefined ? was : { ...was, ...moved };
      }),
    [writer, draftsOn],
  );

  return { draftOf, drafted, onDraft, onAttachments, onHeld };
}
