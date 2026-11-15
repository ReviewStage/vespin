/**
 * use-comments.ts -- a task's description comments as the app's screens read and answer them: its threads, followed while a screen shows them, each drawn as a thread's messages, and a reply sent on one.
 *
 * The threads are the panel's own read (`TASKS_COMMENTS_FOLLOW`), which the
 * host holds on the document while a screen holds it
 * (`LIVE_READ.DESCRIPTION_COMMENTS`), so a teammate's comment or an agent's
 * reply lands while the page is open. A reply is the panel's act
 * (`TASKS_COMMENT_ACT` with `reply`), under a key minted for its words, so
 * one sent again after a lost answer is taken once; the host draws it over
 * the thread at once and takes it back where the service refused it.
 * A thread is started on one whole block of the description
 * (`DESCRIPTION_COMMENT_SCOPE.BLOCK`), as a long press on it offers, since
 * the app's read-only description has no selection of words; its span is
 * read from the shared parse (`@repo/features/description-blocks`).
 * A comment's files are read through the host as the panel reads them
 * (`TASKS_PICTURE_READ`), so no credential leaves it: a picture drawn from
 * its bytes, and any other file, such as a PDF, written under the app's
 * caches for its chip to open.
 */

import type { AgentAttachment } from "@repo/features/agent-wire";
import { ATTACHMENT_VIEW, attachmentView, chipSize } from "@repo/features/attachment-model";
import type { DescriptionBlock } from "@repo/features/description-blocks";
import { COMMENT_NOTE, commentRefusalNote } from "@repo/features/description-comment-notes";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentEntry,
  type DescriptionCommentFile,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import { markersAsNames } from "@repo/features/file-marker";
import { LIVE_READ } from "@repo/features/live-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { COMMENT_SUBJECT, TASK_CALL_FAILURE } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { BUZZ, buzz, THREAD_MEDIA, type ThreadMedia, type ThreadMessage } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { cachedFile } from "../cached-media.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import type { PictureOf } from "../member-pictures.js";
import {
  type AttachedPictures,
  type HeldPicture,
  useAttachedPictures,
} from "../use-attached-pictures.js";
import { useWrite } from "../use-write.js";

/** No threads read yet. */
const NO_THREADS: readonly DescriptionCommentThread[] = [];

/** What an entry says of who wrote it where its writer's account is gone. */
const SOMEONE = "Someone";

/** The prefix a comment's file is written under in the app's caches. */
const COMMENT_MEDIA_PREFIX = "comment";

/** One file of a comment as read: what it is drawn from, or `null` where it could not be read, its size in words once read, and whether it is gone for good, which no Try again brings back. */
interface CommentFileRead {
  readonly source: string | null;
  readonly size: string | undefined;
  readonly gone?: boolean | undefined;
}

/** A thread's files as read, by the attachment each is kept under. */
type CommentFilesRead = ReadonlyMap<string, CommentFileRead>;

/** Nothing read yet. */
const NOTHING_READ: CommentFilesRead = new Map();

/** What draws a thread's files: each one's read, by its attachment, none while on its way, and what reads one again that could not be. */
export interface CommentMedia {
  readonly readOf: (attachmentId: string) => CommentFileRead | undefined;
  readonly retry: (attachmentId: string) => void;
}

/** Whether a comment's file stands as a picture beside its words, rather than as its chip. */
function pictured(file: DescriptionCommentFile): boolean {
  return (
    attachmentView({ name: file.name, mediaType: file.mediaType, url: "" }) ===
    ATTACHMENT_VIEW.IMAGE
  );
}

/** What a comment's file is drawn from once its bytes land: a picture's `data:` address, or any other file's address under the app's caches. */
async function sourceOf(
  file: DescriptionCommentFile,
  read: { readonly contentType: string; readonly base64: string },
): Promise<string> {
  if (pictured(file)) return `data:${read.contentType};base64,${read.base64}`;

  return cachedFile(
    COMMENT_MEDIA_PREFIX,
    file.attachmentId,
    file.name,
    file.mediaType,
    read.base64,
  );
}

/**
 * A new thread's draft kept beside its block: the words typed, the start
 * sent under them and not yet answered as posted, so the same words sent
 * again after a lost answer go under the same key, and which edit of the
 * words it holds, so a send answered late lets the draft go only while it
 * still holds the words that send carried.
 */
type StartDraft = {
  /** The block's words as the draft was typed on it, since an edited description can stand another block at the same offsets. */
  readonly quote: string | undefined;
  readonly words: string;
  /** The pictures picked for it and not yet sent. */
  readonly pictures: readonly HeldPicture[];
  readonly sent: SentStart | undefined;
  readonly revision: number;
};

/**
 * Each new thread's draft, by the task, then the block's start and end, so
 * it outlives the screen that drew it, as a rotation hands a new comment
 * between a split view's detail and its tab's stack, each drawing its own
 * screen.
 */
const startDrafts = new Map<string, Map<number, Map<number, StartDraft>>>();

/** The last edit numbered, across every draft, so a draft let go and typed again never takes an edit's number a send still waits to compare. */
let lastEdit = 0;

/** The next edit's number, never one given before. */
function nextEdit(): number {
  lastEdit += 1;

  return lastEdit;
}

/** The draft kept at one block's offsets of a task, whatever block it was typed on; none kept, or no block yet read. */
function heldDraftAt(taskId: string, block: DescriptionBlock | undefined): StartDraft | undefined {
  if (block === undefined) return undefined;

  return startDrafts.get(taskId)?.get(block.from)?.get(block.to);
}

/** The draft kept toward a new thread on one block of a task, typed on these same words; none kept, or no block yet read. */
function startDraftOf(taskId: string, block: DescriptionBlock | undefined): StartDraft | undefined {
  const draft = heldDraftAt(taskId, block);

  return draft?.quote === block?.quote ? draft : undefined;
}

/** Keeps a new thread's draft on one block of a task, or lets it go at none. */
function keepStartDraft(
  taskId: string,
  block: DescriptionBlock,
  draft: StartDraft | undefined,
): void {
  const spans = startDrafts.get(taskId) ?? new Map<number, Map<number, StartDraft>>();
  const ends = spans.get(block.from) ?? new Map<number, StartDraft>();

  if (draft === undefined) ends.delete(block.to);
  else ends.set(block.to, draft);

  if (ends.size === 0) spans.delete(block.from);
  else spans.set(block.from, ends);

  if (spans.size === 0) startDrafts.delete(taskId);
  else startDrafts.set(taskId, spans);
}

/**
 * A task's description threads, followed while `taskId` is named, the
 * oldest started first, resolved ones among them; none before the read
 * answers.
 */
export function useTaskComments(taskId: string | undefined): readonly DescriptionCommentThread[] {
  const acts = useHostActs();
  useLiveFollow(taskId, (id) => acts[ACT_KIND.TASKS_COMMENTS_FOLLOW]({ taskId: id }));

  const { data: threads = NO_THREADS } = useQuery({
    ...appStateQuery,
    select: (state) =>
      taskId === undefined
        ? undefined
        : state[LIVE_READ.DESCRIPTION_COMMENTS][COMMENT_SUBJECT.DESCRIPTION][taskId]?.rows,
  });

  return threads;
}

/** Says on the console a comments read asked again that did not go; the page still says the read failed. */
function commentsRetryLost(cause: unknown): void {
  console.error("Reading the comments again did not go.", cause);
}

/**
 * Reads a task's description threads again, as the panel's Try again does
 * (`TASKS_COMMENTS_RETRY`), where their read failed and none are held; none
 * otherwise, or while `taskId` names no task.
 */
export function useTaskCommentsRetry(taskId: string | undefined): (() => void) | undefined {
  const acts = useHostActs();

  const { data: failed = false } = useQuery({
    ...appStateQuery,
    select: (state) => {
      const held =
        taskId === undefined
          ? undefined
          : state[LIVE_READ.DESCRIPTION_COMMENTS][COMMENT_SUBJECT.DESCRIPTION][taskId];

      return held?.failed === true && held.rows === undefined;
    },
  });

  return useMemo(
    () =>
      !failed || taskId === undefined
        ? undefined
        : () => {
            acts[ACT_KIND.TASKS_COMMENTS_RETRY]({ taskId }).catch(commentsRetryLost);
          },
    [failed, taskId, acts],
  );
}

/** A thread's comments, its words and the lines of what happened to it left out. */
export function threadComments(
  thread: DescriptionCommentThread,
): readonly DescriptionCommentEntry[] {
  return thread.entries.filter((entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT);
}

/** Whether a thread still stands open, rather than resolved into the description's history. */
export function threadOpen(thread: DescriptionCommentThread): boolean {
  return thread.status === DESCRIPTION_COMMENT_STATUS.OPEN;
}

/** Who wrote an entry, as the panel's thread names them: a member by their name and picture, the app by its own, and a coding agent by the name its task lists it under. */
function writerOf(
  entry: DescriptionCommentEntry,
  agentNames: ReadonlyMap<string, string>,
  pictureOf: PictureOf,
): ThreadMessage["writer"] {
  const { writer } = entry;

  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.APP) return { name: PRODUCT_NAME, agent: true };

  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.AGENT) {
    const named = writer.agentId === undefined ? undefined : agentNames.get(writer.agentId);

    return { name: named ?? PRODUCT_NAME, agent: true };
  }

  return { name: writer.by?.name ?? SOMEONE, agent: false, picture: pictureOf(writer.by?.userId) };
}

/** A comment's files as its message draws them after its words, in the order attached: a picture as a picture, any other file as its chip, one that could not be read offering Try again. */
function commentMedia(entry: DescriptionCommentEntry, media: CommentMedia): readonly ThreadMedia[] {
  return (entry.files ?? []).map((file): ThreadMedia => {
    const key = file.attachmentId;
    const read = media.readOf(key);

    const onRetry =
      read?.source === null && read.gone !== true ? () => media.retry(key) : undefined;

    return pictured(file)
      ? { kind: THREAD_MEDIA.PICTURE, key, source: read?.source, alt: file.name, onRetry }
      : {
          kind: THREAD_MEDIA.FILE,
          key,
          source: read?.source,
          name: file.name,
          mediaType: file.mediaType,
          size: read?.size,
          onRetry,
        };
  });
}

/** A thread's comments as its page draws them, each by its writer, its words typed line by line, and the files it carries after them. */
export function threadMessages(
  thread: DescriptionCommentThread,
  agentNames: ReadonlyMap<string, string>,
  pictureOf: PictureOf,
  media: CommentMedia,
): readonly ThreadMessage[] {
  return threadComments(thread).map((entry) => ({
    id: entry.id,
    writer: writerOf(entry, agentNames, pictureOf),
    at: entry.at,
    // Note that a marker naming one of its files is said as the file's name, since the file stands as its own picture or chip after the words.
    words: markersAsNames(entry.words ?? ""),
    typed: entry.writer.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER,
    media: commentMedia(entry, media),
  }));
}

/**
 * Each file a thread's comments carry, read once through the host while
 * the page stands, as the panel reads a comment's (`TASKS_PICTURE_READ`):
 * a picture drawn from its bytes, any other file written under the app's
 * caches, which its chip opens and shares. One the service answers is not
 * there stands unread for good, as a description's picture does
 * (`useDescriptionPictures`), and one that got no answer stands unread with
 * Try again, which asks for it anew. Note that a read that lands once the
 * page left is dropped.
 */
export function useCommentMedia(
  taskId: string | undefined,
  thread: DescriptionCommentThread | undefined,
): CommentMedia {
  const acts = useHostActs();
  const [read, setRead] = useState<CommentFilesRead>(NOTHING_READ);
  const [round, setRound] = useState(0);
  // The files asked for, by attachment, so each is asked for once while the page stands.
  const asked = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (taskId === undefined || thread === undefined) return;

    const landed = (id: string, file: CommentFileRead) => {
      if (mounted.current) setRead((held) => new Map(held).set(id, file));
    };

    for (const file of threadComments(thread).flatMap((entry) => entry.files ?? [])) {
      const id = file.attachmentId;

      if (asked.current.has(id)) continue;
      asked.current.add(id);

      acts[ACT_KIND.TASKS_PICTURE_READ]({ taskId, attachmentId: id })
        .then(async (answer) => {
          // Note that a file the service says is not there stays so, while one that got no answer offers Try again.
          if (!("base64" in answer) && answer.failure === TASK_CALL_FAILURE.NOT_FOUND) {
            landed(id, { source: null, size: undefined, gone: true });

            return;
          }

          if (!("base64" in answer)) throw new Error(`The file was not read: ${answer.failure}.`);
          const chip = { name: file.name, mediaType: file.mediaType, url: "" };
          landed(id, { source: await sourceOf(file, answer), size: chipSize(chip, answer.base64) });
        })
        .catch((cause: unknown) => {
          console.error("A comment's file was not read.", cause);
          landed(id, { source: null, size: undefined });
        });
    }
    // Note that `round` is read so a Try again, which forgets the file's ask, reads it anew.
  }, [acts, taskId, thread, round]);

  return useMemo(
    () => ({
      readOf: (attachmentId) => read.get(attachmentId),
      retry: (attachmentId) => {
        asked.current.delete(attachmentId);
        setRead((held) => {
          const next = new Map(held);
          next.delete(attachmentId);

          return next;
        });
        setRound((at) => at + 1);
      },
    }),
    [read],
  );
}

/** A reply's field on a thread: its words, whether they may go, and what a send that did not land said. */
export interface CommentReply {
  readonly words: string;
  readonly onWords: (words: string) => void;
  /** The pictures the reply carries, attached from Photos, as the panel's comment field attaches files. */
  readonly pictures: AttachedPictures;
  readonly sendable: boolean;
  readonly send: () => void;
  readonly note: string | undefined;
}

/** A thread's reply typed and not yet sent: its words, and the pictures picked for it. */
interface UnsentReply {
  readonly words: string;
  readonly pictures: readonly HeldPicture[];
}

/** No reply typed and nothing picked. */
const NO_UNSENT_REPLY: UnsentReply = { words: "", pictures: [] };

/**
 * Each thread's reply typed and not yet sent, by the task, then the thread,
 * so it outlives the screen that drew it, as a widening window hands a
 * thread from its tab's stack to a split view's detail, or a fold draws it
 * anew.
 */
const unsentReplies = new Map<string, Map<string, UnsentReply>>();

/** A thread's unsent reply, or none typed. */
function unsentReplyOf(taskId: string, threadId: string): UnsentReply {
  return unsentReplies.get(taskId)?.get(threadId) ?? NO_UNSENT_REPLY;
}

/** Keeps a change to a thread's unsent reply, or lets it go once it holds neither words nor pictures. */
function keepUnsentReply(taskId: string, threadId: string, change: Partial<UnsentReply>): void {
  const threads = unsentReplies.get(taskId) ?? new Map<string, UnsentReply>();
  const next = { ...unsentReplyOf(taskId, threadId), ...change };

  if (next.words === "" && next.pictures.length === 0) threads.delete(threadId);
  else threads.set(threadId, next);

  if (threads.size === 0) unsentReplies.delete(taskId);
  else unsentReplies.set(taskId, threads);
}

/** A reply sent and not yet answered as posted: its words, the pictures it carried, and the key it went under. */
interface SentReply {
  readonly words: string;
  readonly files: readonly AgentAttachment[];
  readonly key: string;
}

/**
 * Whether a send goes again as the one `sent` names, under its key: the same
 * words and the same pictures, by their bytes, as the panel's field asks
 * (`sameFiles`), since the service answers a key it took as posted whatever
 * the send carries, so a picture changed since would be dropped unseen.
 */
function sameSend(sent: SentReply | undefined, words: string, files: readonly AgentAttachment[]) {
  return (
    sent !== undefined &&
    sent.words === words &&
    sent.files.length === files.length &&
    sent.files.every(
      (file, at) => file.mediaType === files[at]?.mediaType && file.data === files[at]?.data,
    )
  );
}

/**
 * A reply on one thread, as the panel's thread sends it: the words go at
 * once under a key kept for as long as they stand, so the same words sent
 * again after a lost answer are taken once, and other words go under a key
 * of their own; the field is emptied as they go and given them back where
 * the service refused them, with why. Note that a reply out holds back no
 * other, since each is a declared write the host draws at once under its own
 * key, so a second reply goes while the first is still unanswered, as the
 * panel's does.
 */
export function useCommentReply(taskId: string, threadId: string): CommentReply {
  const acts = useHostActs();
  const write = useWrite();
  const [words, setWords] = useState(() => unsentReplyOf(taskId, threadId).words);
  // Note that the reply is kept beside its thread as it changes, so a screen drawn anew for the thread opens on it.
  useEffect(() => keepUnsentReply(taskId, threadId, { words }), [taskId, threadId, words]);
  // Note that the last reply sent is held outside render, so a second tap before the next render reuses its key and the service takes the reply once.
  const sent = useRef<SentReply | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);

  // Note that the pictures picked are kept with the words, so a rotation or a fold never drops one.
  const pictures = useAttachedPictures(setNote, undefined, undefined, {
    held: unsentReplyOf(taskId, threadId).pictures,
    keep: (held) => keepUnsentReply(taskId, threadId, { pictures: held }),
  });

  return useMemo(() => {
    const send = () => {
      const kept = words.trim();

      if (kept === "") return;

      // A picture past a bound holds the send back, saying why, as an agent's composer does.
      if (pictures.refusal !== undefined) {
        setNote(pictures.refusal);
        buzz(BUZZ.WARNING);

        return;
      }

      const files = pictures.files ?? [];

      const key =
        sameSend(sent.current, kept, files) && sent.current !== undefined
          ? sent.current.key
          : randomUUID();

      sent.current = { words: kept, files, key };
      setNote(undefined);
      setWords("");
      // The pictures go with the words, and come back with them where the reply is refused.
      const carried = pictures.take();

      // Note that a reply refused says why under the box, where its words go back, rather than in the notice.
      write(
        () =>
          acts[ACT_KIND.TASKS_COMMENT_ACT]({
            taskId: taskId,
            threadId,
            action: {
              action: DESCRIPTION_COMMENT_ACTION.REPLY,
              clientKey: key,
              words: kept,
              ...(carried.length === 0
                ? undefined
                : { attachments: carried.map(({ file }) => file) }),
            },
          }),
        {
          refused: (answer) => ("thread" in answer ? undefined : COMMENT_NOTE.NOT_POSTED),
          unanswered: COMMENT_NOTE.NOT_POSTED,
          inPlace: (said) => {
            // Note that words typed while it was out stay, after the reply given back, so neither is lost.
            setWords((now) => (now.trim() === "" ? kept : `${kept}\n\n${now}`));
            pictures.putBack(carried);
            setNote(said);
          },
          went: BUZZ.SUCCESS,
        },
      ).then((went) => {
        // Note that a reply answered after a later one went lets go of its key only while it is still the one held.
        if (went && sent.current?.key === key) sent.current = undefined;
      });
    };

    return {
      words,
      onWords: setWords,
      pictures,
      sendable: words.trim() !== "",
      send,
      note,
    };
  }, [acts, write, taskId, threadId, words, note, pictures]);
}

/** The open threads standing on each block of a description, by the block's start, the oldest started first. */
export function threadsOnBlocks(
  threads: readonly DescriptionCommentThread[],
  blocks: readonly DescriptionBlock[],
): ReadonlyMap<number, readonly DescriptionCommentThread[]> {
  const on = new Map<number, DescriptionCommentThread[]>();

  for (const thread of threads.filter(threadOpen)) {
    const { anchor } = thread;

    if (anchor === undefined) continue;
    const block = blocks.find((each) => anchor.from >= each.from && anchor.from < each.to);

    if (block === undefined) continue;
    on.set(block.from, [...(on.get(block.from) ?? []), thread]);
  }

  return on;
}

/** A new thread's field on a block: its words, whether they may go, what a send that did not land said, and the send, which answers the thread's id once it is posted. */
export interface CommentStart {
  readonly words: string;
  readonly onWords: (words: string) => void;
  /** The pictures the thread's first comment carries, attached from Photos. */
  readonly pictures: AttachedPictures;
  readonly sendable: boolean;
  readonly send: () => Promise<string | undefined>;
  readonly note: string | undefined;
}

/** A start sent and not yet answered as posted: its words, the key it went under, and the thread's id it named. */
interface SentStart extends SentReply {
  readonly threadId: string;
}

/**
 * A new thread on one block of a task's description, as the panel's block
 * comment starts one (`TASKS_COMMENT_START`): its first comment's words, the
 * block's quote and span, and the description's text the span is measured
 * in, which the service carries over to the text as it stands. It goes
 * under an id minted here, so the host draws the thread at once, and a key
 * kept for as long as the words stand, so the same words sent again after a
 * lost answer start one thread; a refusal keeps the words with why. The
 * words typed are kept for the block until they are sent, so a new comment
 * handed to another screen by a rotation opens on them.
 */
export function useCommentStart(
  taskId: string,
  text: string,
  block: DescriptionBlock | undefined,
): CommentStart {
  const acts = useHostActs();
  const write = useWrite();
  const [words, setLocal] = useState(() => startDraftOf(taskId, block)?.words ?? "");
  const [sent, setSentLocal] = useState(() => startDraftOf(taskId, block)?.sent);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  // Note that a second tap before the next render reads no `sending` yet, so the send in flight is held here too, or two taps would start two threads.
  const inFlight = useRef(false);
  const quote = block?.quote;

  // Note that the pictures picked are kept with the draft's words, so a rotation or a fold never drops one.
  const pictures = useAttachedPictures(setNote, undefined, undefined, {
    held: startDraftOf(taskId, block)?.pictures ?? [],
    keep: (held) => {
      if (block === undefined) return;
      const was = startDraftOf(taskId, block);

      keepStartDraft(
        taskId,
        block,
        held.length === 0 && (was?.words ?? "") === "" && was?.sent === undefined
          ? undefined
          : {
              quote: block.quote,
              words: was?.words ?? "",
              pictures: held,
              sent: was?.sent,
              revision: was?.revision ?? nextEdit(),
            },
      );
    },
  });

  // Note that a block read after the first draw takes up the draft kept for it, where nothing was typed or picked meanwhile.
  const takeUp = useEffectEvent((kept: StartDraft) => {
    setLocal((was) => (was === "" ? kept.words : was));
    setSentLocal((was) => was ?? kept.sent);

    if (pictures.attached.length === 0 && kept.pictures.length > 0) pictures.putBack(kept.pictures);
  });

  useEffect(() => {
    const kept = startDraftOf(taskId, block);

    if (kept !== undefined) takeUp(kept);
  }, [taskId, block]);

  const setWords = useCallback(
    (next: string) => {
      setLocal(next);

      if (block === undefined) return;
      const was = startDraftOf(taskId, block);

      keepStartDraft(
        taskId,
        block,
        next === "" && was?.sent === undefined && (was?.pictures.length ?? 0) === 0
          ? undefined
          : {
              quote: block.quote,
              words: next,
              pictures: was?.pictures ?? [],
              sent: was?.sent,
              revision: nextEdit(),
            },
      );
    },
    [taskId, block],
  );

  return useMemo(() => {
    const send = async (): Promise<string | undefined> => {
      const kept = words.trim();

      if (kept === "" || inFlight.current || block === undefined || quote === undefined) {
        return undefined;
      }

      // A picture past a bound holds the start back, saying why, as an agent's composer does.
      if (pictures.refusal !== undefined) {
        setNote(pictures.refusal);
        buzz(BUZZ.WARNING);

        return undefined;
      }

      const files = pictures.files ?? [];
      inFlight.current = true;
      const again = sameSend(sent, kept, files) ? sent : undefined;
      const key = again?.key ?? randomUUID();
      const threadId = again?.threadId ?? randomUUID();
      const start = { words: kept, files, key, threadId };
      setSentLocal(start);
      // Note that the start is kept with the draft, so a screen drawn anew by a rotation sends the same words again under the same key.
      const held = startDraftOf(taskId, block);
      const revision = held?.revision ?? 0;
      keepStartDraft(taskId, block, {
        quote: block.quote,
        words: held?.words ?? words,
        pictures: held?.pictures ?? [],
        sent: start,
        revision,
      });
      setSending(true);
      setNote(undefined);

      const went = await write(
        () =>
          acts[ACT_KIND.TASKS_COMMENT_START]({
            taskId: taskId,
            start: {
              id: threadId,
              clientKey: key,
              scope: DESCRIPTION_COMMENT_SCOPE.BLOCK,
              quote,
              anchor: { from: block.from, to: block.to },
              text,
              words: kept,
              attachments: [...files],
            },
          }),
        {
          refused: (answer) =>
            "thread" in answer
              ? undefined
              : "refused" in answer
                ? commentRefusalNote(answer.refused)
                : COMMENT_NOTE.NOT_POSTED,
          unanswered: COMMENT_NOTE.NOT_POSTED,
          inPlace: setNote,
          went: BUZZ.SUCCESS,
        },
      ).finally(() => {
        inFlight.current = false;
        setSending(false);
      });

      if (!went) return undefined;
      // Note that the pictures that went are taken off before the draft is settled, so the draft never keeps them.
      pictures.take();
      const now = heldDraftAt(taskId, block);
      // Note that a newer send's key, kept by a screen a rotation drew, stays with the draft until that send settles.
      const pending = now?.sent?.threadId === threadId ? undefined : now?.sent;

      // Note that the draft goes only while it still holds the words this send carried, so words typed meanwhile, on this screen or one a rotation drew, stay in the field and kept; and a draft another block's words now stand under at these offsets is left as it is.
      if (now === undefined || now.revision === revision) {
        setSentLocal(pending);
        setLocal("");
        keepStartDraft(taskId, block, undefined);
      } else if (now.quote !== block.quote) {
        setSentLocal(undefined);
        setLocal("");
      } else {
        setSentLocal(pending);
        setLocal(now.words);
        keepStartDraft(taskId, block, { ...now, sent: pending });
      }

      return threadId;
    };

    return {
      words,
      onWords: setWords,
      pictures,
      sendable: words.trim() !== "" && !sending && quote !== undefined,
      send,
      note,
    };
  }, [acts, write, taskId, text, block, quote, words, setWords, sent, sending, note, pictures]);
}
