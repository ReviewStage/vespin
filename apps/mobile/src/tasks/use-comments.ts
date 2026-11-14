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

import {
  ATTACHMENT_VIEW,
  attachmentText,
  attachmentView,
  linesLabel,
  sizeLabel,
} from "@repo/features/attachment-model";
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
import { LIVE_READ } from "@repo/features/live-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { COMMENT_SUBJECT } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { BUZZ, THREAD_MEDIA, type ThreadMedia, type ThreadMessage } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { cachedFile } from "../cached-media.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import type { PictureOf } from "../member-pictures.js";
import { useWrite } from "../use-write.js";

/** No threads read yet. */
const NO_THREADS: readonly DescriptionCommentThread[] = [];

/** What an entry says of who wrote it where its writer's account is gone. */
const SOMEONE = "Someone";

/** The prefix a comment's file is written under in the app's caches. */
const COMMENT_MEDIA_PREFIX = "comment";

/** One file of a comment as read: what it is drawn from, or `null` where it could not be read, and its size in words once read. */
interface CommentFileRead {
  readonly source: string | null;
  readonly size: string | undefined;
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

/** A text file's count of lines, as the panel's chip says it, or its bytes where they are no text the system reads, as the panel's says then. */
function sizeOf(file: DescriptionCommentFile, base64: string): string {
  if (
    attachmentView({ name: file.name, mediaType: file.mediaType, url: "" }) !== ATTACHMENT_VIEW.TEXT
  ) {
    return sizeLabel(base64);
  }

  try {
    return linesLabel(attachmentText(base64));
  } catch {
    return sizeLabel(base64);
  }
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
    const onRetry = read?.source === null ? () => media.retry(key) : undefined;

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
    words: entry.words ?? "",
    typed: entry.writer.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER,
    media: commentMedia(entry, media),
  }));
}

/**
 * Each file a thread's comments carry, read once through the host while
 * the page stands, as the panel reads a comment's (`TASKS_PICTURE_READ`):
 * a picture drawn from its bytes, any other file written under the app's
 * caches, which its chip opens and shares. One the service answers is not
 * there, or that got no answer, stands unread with Try again, which asks
 * for it anew. Note that a read that lands once the page left is dropped.
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

      acts[ACT_KIND.TASKS_PICTURE_READ]({ planId: taskId, attachmentId: id })
        .then(async (answer) => {
          if (!("base64" in answer)) throw new Error(`The file was not read: ${answer.failure}.`);
          landed(id, { source: await sourceOf(file, answer), size: sizeOf(file, answer.base64) });
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
  readonly sendable: boolean;
  readonly send: () => void;
  readonly note: string | undefined;
}

/** A reply sent and not yet answered as posted: its words, and the key it went under. */
interface SentReply {
  readonly words: string;
  readonly key: string;
}

/**
 * A reply on one thread, as the panel's thread sends it: the words go at
 * once under a key kept for as long as they stand, so the same words sent
 * again after a lost answer are taken once, and other words go under a key
 * of their own; the field is emptied as they go and given them back where
 * the service refused them, with why.
 */
export function useCommentReply(taskId: string, threadId: string): CommentReply {
  const acts = useHostActs();
  const write = useWrite();
  const [words, setWords] = useState("");
  const [sent, setSent] = useState<SentReply | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);

  return useMemo(() => {
    const send = () => {
      const kept = words.trim();

      if (kept === "" || sending) return;
      const key = sent?.words === kept ? sent.key : randomUUID();
      setSent({ words: kept, key });
      setSending(true);
      setNote(undefined);
      setWords("");
      // Note that a reply refused says why under the box, where its words go back, rather than in the notice.
      write(
        () =>
          acts[ACT_KIND.TASKS_COMMENT_ACT]({
            planId: taskId,
            threadId,
            action: { action: DESCRIPTION_COMMENT_ACTION.REPLY, clientKey: key, words: kept },
          }),
        {
          refused: (answer) => ("thread" in answer ? undefined : COMMENT_NOTE.NOT_POSTED),
          unanswered: COMMENT_NOTE.NOT_POSTED,
          inPlace: (said) => {
            // Note that words typed while it was out stay, after the reply given back, so neither is lost.
            setWords((now) => (now.trim() === "" ? kept : `${kept}\n\n${now}`));
            setNote(said);
          },
          went: BUZZ.SUCCESS,
        },
      )
        .then((went) => {
          if (went) setSent(undefined);
        })
        .finally(() => setSending(false));
    };

    return {
      words,
      onWords: setWords,
      sendable: words.trim() !== "" && !sending,
      send,
      note,
    };
  }, [acts, write, taskId, threadId, words, sent, sending, note]);
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
 * lost answer start one thread; a refusal keeps the words with why.
 */
export function useCommentStart(
  taskId: string,
  text: string,
  block: DescriptionBlock | undefined,
): CommentStart {
  const acts = useHostActs();
  const write = useWrite();
  const [words, setWords] = useState("");
  const [sent, setSent] = useState<SentStart | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  // Note that a second tap before the next render reads no `sending` yet, so the send in flight is held here too, or two taps would start two threads.
  const inFlight = useRef(false);
  const quote = block?.quote;

  return useMemo(() => {
    const send = async (): Promise<string | undefined> => {
      const kept = words.trim();

      if (kept === "" || inFlight.current || block === undefined || quote === undefined) {
        return undefined;
      }

      inFlight.current = true;
      const again = sent?.words === kept ? sent : undefined;
      const key = again?.key ?? randomUUID();
      const threadId = again?.threadId ?? randomUUID();
      setSent({ words: kept, key, threadId });
      setSending(true);
      setNote(undefined);

      const went = await write(
        () =>
          acts[ACT_KIND.TASKS_COMMENT_START]({
            planId: taskId,
            start: {
              id: threadId,
              clientKey: key,
              scope: DESCRIPTION_COMMENT_SCOPE.BLOCK,
              quote,
              anchor: { from: block.from, to: block.to },
              text,
              words: kept,
              attachments: [],
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
      setSent(undefined);
      setWords("");

      return threadId;
    };

    return {
      words,
      onWords: setWords,
      sendable: words.trim() !== "" && !sending && quote !== undefined,
      send,
      note,
    };
  }, [acts, write, taskId, text, block, quote, words, sent, sending, note]);
}
