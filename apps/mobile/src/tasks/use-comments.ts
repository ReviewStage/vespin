/**
 * use-comments.ts -- a task's description comments as the app's screens read and answer them: its threads, followed while a screen shows them, each drawn as a thread's messages, and a reply sent on one.
 *
 * The threads are the panel's own read (`TASKS_COMMENTS_FOLLOW`), which the
 * host holds on the document while a screen holds it
 * (`LIVE_READ.DESCRIPTION_COMMENTS`), so a teammate's comment or an agent's
 * reply lands while the page is open. A reply, a resolve and a reopen are the panel's act
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
import {
  COMMENT_ACT,
  COMMENT_EVENT_WORDS,
  type CommentEvent,
  commentThreadLines,
  threadComments,
} from "@repo/features/description-comment-model";
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
import { agentName, providerOf } from "@repo/features/model-label";
import type { ModelProvider } from "@repo/features/models-wire";
import { PICTURE_OWNER } from "@repo/features/picture-source-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { COMMENT_SUBJECT, TASK_CALL_FAILURE } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import type { ActPortClient } from "@repo/host/contract";
import {
  BUZZ,
  buzz,
  GLYPH,
  type LongPressGroup,
  NOTICE_KIND,
  type PictureById,
  THREAD_MEDIA,
  type ThreadEvent,
  type ThreadMedia,
  type ThreadMessage,
  useFailureNotices,
} from "@repo/ui-native";
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
import { usePictures } from "../use-pictures.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";
import type { TaskAgentLine } from "./use-tasks.js";

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

/** What draws a thread's files: each picture by its attachment, which it reads where it is drawn, each other file's read, none while on its way, and what reads one again that could not be. */
export interface CommentMedia {
  readonly pictureOf: (attachmentId: string) => PictureById;
  readonly retryPicture: (attachmentId: string) => void;
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

/** The file a comment's file other than a picture is written to once its bytes land, under its own name in the app's caches, which its chip opens and shares. */
function sourceOf(file: DescriptionCommentFile, base64: string): Promise<string> {
  return cachedFile(COMMENT_MEDIA_PREFIX, file.attachmentId, file.name, file.mediaType, base64);
}

/** Every file a thread's comments carry, in order; none for no thread. */
function threadFiles(
  thread: DescriptionCommentThread | undefined,
): readonly DescriptionCommentFile[] {
  return thread === undefined ? [] : threadComments(thread).flatMap((entry) => entry.files ?? []);
}

/**
 * A new thread's draft kept beside its block: the words typed, the start
 * sent under them that the service refused or never answered, so the same
 * words sent again go under the same key, and why it did not go.
 */
type StartDraft = {
  /** The block's words as the draft was typed on it, since an edited description can stand another block at the same offsets. */
  readonly quote: string | undefined;
  readonly words: string;
  /** The pictures picked for it and not yet sent. */
  readonly pictures: readonly HeldPicture[];
  readonly sent: SentStart | undefined;
  readonly note?: string | undefined;
};

/**
 * Each new thread's draft, by the task, then the block's start and end, so
 * it outlives the screen that drew it, as a refused start's field opens
 * again on a screen of its own in its thread's place.
 */
const startDrafts = new Map<string, Map<number, Map<number, StartDraft>>>();

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

/** Whether a task's description threads have been read once, so a thread it does not hold is one that is not there rather than one still on its way. */
export function useTaskCommentsHeld(taskId: string | undefined): boolean {
  const { data: held = false } = useQuery({
    ...appStateQuery,
    select: (state) =>
      taskId !== undefined &&
      state[LIVE_READ.DESCRIPTION_COMMENTS][COMMENT_SUBJECT.DESCRIPTION][taskId]?.rows !==
        undefined,
  });

  return held;
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

/** Whether a thread still stands open, rather than resolved into the description's history. */
export function threadOpen(thread: DescriptionCommentThread): boolean {
  return thread.status === DESCRIPTION_COMMENT_STATUS.OPEN;
}

/** An agent on the task as a comment's writer line names it: its name, and the harness whose mark its tile wears, where its model says. */
export interface CommentAgent {
  readonly name: string;
  readonly harness: ModelProvider | undefined;
}

/** The task's agents by their ids, as a comment's writer names one (`CommentAgent`), archived ones among them, since an agent archived since it wrote is still its writer. */
export function commentAgents(lines: readonly TaskAgentLine[]): ReadonlyMap<string, CommentAgent> {
  return new Map(
    lines.map(
      ({ agent }) =>
        [agent.id, { name: agentName(agent), harness: providerOf(agent.model) }] as const,
    ),
  );
}

/** Who wrote an entry, as the panel's thread names them: a member by their name and picture, and a coding agent by the name its task lists it under. */
export function commentWriter(
  entry: DescriptionCommentEntry,
  agents: ReadonlyMap<string, CommentAgent>,
  pictureOf: PictureOf,
): ThreadMessage["writer"] {
  const { writer } = entry;

  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.AGENT) {
    const known = writer.agentId === undefined ? undefined : agents.get(writer.agentId);

    return {
      name: known?.name ?? PRODUCT_NAME,
      agent: true,
      id: writer.agentId,
      harness: known?.harness,
    };
  }

  return {
    name: writer.by?.name ?? SOMEONE,
    agent: false,
    id: writer.by?.userId,
    picture: pictureOf(writer.by?.userId),
  };
}

/** A comment's files as its message draws them after its words, in the order attached: a picture as a picture, any other file as its chip, one that could not be read offering Try again. */
function commentMedia(entry: DescriptionCommentEntry, media: CommentMedia): readonly ThreadMedia[] {
  return (entry.files ?? []).map((file): ThreadMedia => {
    const key = file.attachmentId;

    if (pictured(file)) {
      return {
        kind: THREAD_MEDIA.PICTURE,
        key,
        source: media.pictureOf(key),
        alt: file.name,
        onRetry: () => media.retryPicture(key),
      };
    }

    const read = media.readOf(key);

    const onRetry =
      read?.source === null && read.gone !== true ? () => media.retry(key) : undefined;

    return {
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

/** The glyph leading each line of what happened to a thread, as the thread's bar marks the act: Resolve's check, and Reopen's turn back. */
const EVENT_GLYPH = {
  [DESCRIPTION_COMMENT_ENTRY.RESOLVED]: GLYPH.RESOLVED,
  [DESCRIPTION_COMMENT_ENTRY.REOPENED]: GLYPH.RESTORE,
} as const;

/** A thread as its page draws it: the lines of what happened before any comment, then its comments as messages, each with the lines after it. */
export interface ThreadDrawn {
  readonly opening: readonly ThreadEvent[];
  readonly messages: readonly ThreadMessage[];
}

/** A line of what happened to a thread, as its page draws it: who did it, what in the panel's words ("resolved this"), when, and its act's glyph. */
function threadEvent(
  entry: CommentEvent,
  agents: ReadonlyMap<string, CommentAgent>,
  pictureOf: PictureOf,
): ThreadEvent {
  const writer = commentWriter(entry, agents, pictureOf);

  return {
    key: entry.id,
    who: { name: writer.name, agent: writer.agent },
    did: COMMENT_EVENT_WORDS[entry.kind],
    at: entry.at,
    glyph: EVENT_GLYPH[entry.kind],
  };
}

/** A thread's comments as its page draws them, each by its writer, its words typed line by line, the files it carries after them, whether it was edited, its long press menu, and the resolves and reopens after it, as the panel's thread stands them between its comments. */
export function threadMessages(
  thread: DescriptionCommentThread,
  agents: ReadonlyMap<string, CommentAgent>,
  pictureOf: PictureOf,
  media: CommentMedia,
  /** What a comment's long press holds after Copy message, such as Copy link, Edit, and Delete. */
  menuOf: (entry: DescriptionCommentEntry) => readonly LongPressGroup[],
): ThreadDrawn {
  const { opening, comments } = commentThreadLines(thread);
  const event = (entry: CommentEvent) => threadEvent(entry, agents, pictureOf);

  return {
    opening: opening.map(event),
    messages: comments.map(({ comment: entry, after }) => ({
      id: entry.id,
      writer: commentWriter(entry, agents, pictureOf),
      at: entry.at,
      // Note that a marker naming one of its files is said as the file's name, since the file stands as its own picture or chip after the words.
      words: markersAsNames(entry.words ?? ""),
      typed: entry.writer.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER,
      media: commentMedia(entry, media),
      edited: entry.editedAt !== undefined,
      after: after.map(event),
      menu: menuOf(entry),
    })),
  };
}

/**
 * Each file a thread's comments carry: a picture handed to its message by
 * its attachment, which it reads where it is drawn and expo-image loads
 * from the service's address (`usePictures`, under the page's
 * `PicturesProvider`), and any other file read once through the host while
 * the page stands, as the panel reads a comment's (`TASKS_PICTURE_READ`),
 * and written under the app's caches, which its chip opens and shares. One the service answers is not
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

  // Note that no picture is read ahead until the task's id is known, which names whose pictures they are.
  const pictureIds = useMemo(
    () =>
      taskId === undefined
        ? []
        : threadFiles(thread)
            .filter(pictured)
            .map((file) => file.attachmentId),
    [taskId, thread],
  );

  const pictures = usePictures(PICTURE_OWNER.TASK, taskId ?? "", pictureIds);
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

    for (const file of threadFiles(thread).filter((each) => !pictured(each))) {
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
          landed(id, {
            source: await sourceOf(file, answer.base64),
            size: chipSize(chip, answer.base64),
          });
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
      pictureOf: pictures.refOf,
      retryPicture: pictures.retry,
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
    [pictures, read],
  );
}

/** A reply's field on a thread: its words, whether they may go, and what a send that did not land said. */
export interface CommentReply {
  readonly words: string;
  readonly onWords: (words: string) => void;
  /** The pictures the reply carries, attached from Photos, as the panel's comment field attaches files. */
  readonly pictures: AttachedPictures;
  readonly sendable: boolean;
  /** Sends the words Send took out of the field, answering whether it took them (`ComposerSend`). */
  readonly send: (typed: string) => boolean;
  readonly note: string | undefined;
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
  const [words, setWords] = useState("");
  // Note that the last reply sent is held outside render, so a second tap before the next render reuses its key and the service takes the reply once.
  const sent = useRef<SentReply | undefined>(undefined);
  // The keys of the replies still out, so a second tap on the same reply before the next render sends nothing, while another reply still goes.
  const out = useRef(new Set<string>());
  const [note, setNote] = useState<string | undefined>(undefined);
  const pictures = useAttachedPictures(setNote);

  return useMemo(() => {
    const send = (typed: string): boolean => {
      const kept = typed.trim();

      // Note that a picture still being read holds the send back, since it would land in the field after the reply had gone without it.
      if (kept === "" || pictures.reading) return false;

      // A picture past a bound holds the send back, saying why, as an agent's composer does.
      if (pictures.refusal !== undefined) {
        setNote(pictures.refusal);
        buzz(BUZZ.WARNING);

        return false;
      }

      const files = pictures.files ?? [];
      const again = sameSend(sent.current, kept, files) ? sent.current : undefined;
      const key = again?.key ?? randomUUID();

      if (out.current.has(key)) return false;
      out.current.add(key);
      sent.current = { words: kept, files, key };
      setNote(undefined);
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
      )
        .then((went) => {
          // Note that a reply answered after a later one went lets go of its key only while it is still the one held.
          if (went && sent.current?.key === key) sent.current = undefined;
        })
        .finally(() => out.current.delete(key));

      return true;
    };

    return {
      words,
      onWords: setWords,
      pictures,
      sendable: words.trim() !== "" && !pictures.reading,
      send,
      note,
    };
  }, [acts, write, taskId, threadId, words, note, pictures]);
}

/**
 * Resolves a thread that stands open, or reopens one resolved, as the
 * panel's check on a thread's first comment does (`TASKS_COMMENT_ACT` with
 * `resolve` or `reopen`): the host draws it on the press, and one refused is
 * taken back and said in the notice, in the panel's words for it.
 */
export function useCommentSettle(taskId: string): (thread: DescriptionCommentThread) => void {
  const acts = useHostActs();
  const write = useWrite();

  return (thread) => {
    const action = threadOpen(thread)
      ? DESCRIPTION_COMMENT_ACTION.RESOLVE
      : DESCRIPTION_COMMENT_ACTION.REOPEN;

    void write(
      () =>
        acts[ACT_KIND.TASKS_COMMENT_ACT]({
          taskId,
          threadId: thread.id,
          action: { action },
        }),
      {
        refused: (answer) =>
          "thread" in answer || "deleted" in answer
            ? undefined
            : "refused" in answer
              ? commentRefusalNote(answer.refused)
              : COMMENT_NOTE.NOT_CHANGED,
        unanswered: COMMENT_NOTE.NOT_CHANGED,
        // Note that a resolve or reopen sent again lands the thread where it was asked to stand, so the notice offers Try again.
        retry: true,
        // Note that the thread is the write's subject, so a newer resolve or reopen voids an older one's Try again.
        subject: { kind: WRITE_SUBJECT.TASK_COMMENT, id: thread.id },
        went: BUZZ.SUCCESS,
      },
    );
  };
}

/** A comment being edited in its thread's field: which, the words it holds now, the field's words, the names of the files it carries, which its markers name as pills, and what a save that did not land said. */
export interface CommentEditing {
  readonly entryId: string;
  readonly was: string;
  readonly words: string;
  readonly files: ReadonlySet<string>;
  readonly note?: string | undefined;
}

/** A delete asked and not yet answered: a reply alone, or the whole thread from its first comment. */
export interface CommentDeleting {
  readonly act: typeof COMMENT_ACT.DELETE | typeof COMMENT_ACT.DELETE_THREAD;
  readonly entryId: string;
}

/** What a thread's own comments' acts hold: the edit in its field, the delete being asked, and what starts, saves, and lets each go. */
export interface CommentActs {
  readonly editing: CommentEditing | undefined;
  /** Moves each time an edit starts, so the field takes the keyboard (`Composer`'s `focusAsk`). */
  readonly editAsk: number;
  readonly startEdit: (entry: DescriptionCommentEntry) => void;
  readonly onEditWords: (words: string) => void;
  readonly cancelEdit: () => void;
  /** Saves the words Save took out of the field in the comment's place, answering whether it took them (`ComposerSend`). */
  readonly saveEdit: (typed: string) => boolean;
  readonly deleting: CommentDeleting | undefined;
  readonly askDelete: (deleting: CommentDeleting) => void;
  readonly confirmDelete: () => void;
  readonly dismissDelete: () => void;
}

/** What the host answers a thread's act. */
type CommentActAnswer = Awaited<ReturnType<ActPortClient[typeof ACT_KIND.TASKS_COMMENT_ACT]>>;

/** The words a refused edit or delete of a comment is said in, as the panel's thread says them; none for one that landed. */
function changeRefusal(answer: CommentActAnswer): string | undefined {
  if ("thread" in answer || "deleted" in answer) return undefined;

  return "refused" in answer ? commentRefusalNote(answer.refused) : COMMENT_NOTE.NOT_CHANGED;
}

/**
 * Edits and deletes a thread's comments, as the panel's comment menu does
 * (`TASKS_COMMENT_ACT` with `edit`, `delete`, or `delete-thread`). An edit
 * lays the comment's words in the thread's field, which saves them in its
 * place, its files kept as they are; the host draws it at once, and one
 * refused comes back in the field with why. A delete asks first, since
 * none comes back, then goes; a whole thread's goes with its page
 * (`onThreadGone`), and one refused is said in the notice, as a resolve is.
 */
export function useCommentActs(
  taskId: string,
  threadId: string,
  onThreadGone: () => void,
): CommentActs {
  const acts = useHostActs();
  const write = useWrite();
  const [editing, setEditingState] = useState<CommentEditing | undefined>(undefined);
  const [editAsk, setEditAsk] = useState(0);
  const [deleting, setDeleting] = useState<CommentDeleting | undefined>(undefined);
  const notices = useFailureNotices();
  // Note that the edit open now is kept beside the state as each press moves it, since a save's refusal may land before the render that closed it, or after another edit was opened.
  const editingNow = useRef(editing);

  const setEditing = useCallback((next: CommentEditing | undefined) => {
    editingNow.current = next;
    setEditingState(next);
  }, []);

  return useMemo(() => {
    const saveEdit = (typed: string): boolean => {
      const kept = typed.trim();

      if (editing === undefined || kept === "") return false;
      // Note that words saved as the comment holds them change nothing, so the edit just closes.
      setEditing(undefined);

      if (kept === editing.was.trim()) return true;
      const { entryId, was, files } = editing;

      void write(
        () =>
          acts[ACT_KIND.TASKS_COMMENT_ACT]({
            taskId,
            threadId,
            action: { action: DESCRIPTION_COMMENT_ACTION.EDIT, entry: entryId, words: kept },
          }),
        {
          refused: changeRefusal,
          unanswered: COMMENT_NOTE.NOT_CHANGED,
          // Note that an edit refused comes back in the field with why, so its words are never lost, unless another edit was opened since, whose words stay and the notice says why this one did not go.
          inPlace: (note, noticed) => {
            if (editingNow.current === undefined) {
              setEditing({ entryId, was, words: kept, files, note });
            } else if (!noticed) {
              notices.say({ kind: NOTICE_KIND.REFUSED, words: note });
            }
          },
          went: BUZZ.SUCCESS,
        },
      );

      return true;
    };

    const confirmDelete = () => {
      if (deleting === undefined) return;
      setDeleting(undefined);

      const action =
        deleting.act === COMMENT_ACT.DELETE_THREAD
          ? { action: DESCRIPTION_COMMENT_ACTION.DELETE_THREAD }
          : { action: DESCRIPTION_COMMENT_ACTION.DELETE, entry: deleting.entryId };

      // Note that an edit of what goes goes with it.
      if (deleting.act === COMMENT_ACT.DELETE_THREAD || editing?.entryId === deleting.entryId) {
        setEditing(undefined);
      }

      if (deleting.act === COMMENT_ACT.DELETE_THREAD) onThreadGone();

      void write(() => acts[ACT_KIND.TASKS_COMMENT_ACT]({ taskId, threadId, action }), {
        refused: changeRefusal,
        unanswered: COMMENT_NOTE.NOT_CHANGED,
        went: BUZZ.SUCCESS,
      });
    };

    return {
      editing,
      editAsk,
      startEdit: (entry) => {
        // Note that the field holds the words as written, so a file's marker stays where it stands and its file stays named.
        const words = entry.words ?? "";
        const files = new Set((entry.files ?? []).map((file) => file.name));
        setEditing({ entryId: entry.id, was: words, words, files });
        setEditAsk((at) => at + 1);
      },
      onEditWords: (words) => {
        const was = editingNow.current;

        if (was !== undefined) setEditing({ ...was, words });
      },
      cancelEdit: () => setEditing(undefined),
      saveEdit,
      deleting,
      askDelete: setDeleting,
      confirmDelete,
      dismissDelete: () => setDeleting(undefined),
    };
  }, [
    acts,
    write,
    notices,
    taskId,
    threadId,
    editing,
    setEditing,
    editAsk,
    deleting,
    onThreadGone,
  ]);
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

/** A new thread's field on a block: its words, whether they may go, what a send that was refused said, and the send, which answers the thread's id at once, before the service has. */
export interface CommentStart {
  readonly words: string;
  readonly onWords: (words: string) => void;
  /** The pictures the thread's first comment carries, attached from Photos. */
  readonly pictures: AttachedPictures;
  readonly sendable: boolean;
  /** Starts the thread on the words Send took out of the field, answering its id, or none where it did not take them. */
  readonly send: (
    typed: string,
    refused: (start: RefusedStart, noticed: boolean) => void,
  ) => string | undefined;
  readonly note: string | undefined;
}

/** A start sent and not yet answered as posted: its words, the key it went under, and the thread's id it named. */
interface SentStart extends SentReply {
  readonly threadId: string;
}

/** A start the service refused or never answered: what was sent, and why it did not go. */
interface RefusedStart extends SentStart {
  readonly note: string;
}

/**
 * A new thread on one block of a task's description, as the panel's block
 * comment starts one (`TASKS_COMMENT_START`): its first comment's words, the
 * block's quote and span, and the description's text the span is measured
 * in, which the service carries over to the text as it stands. It goes
 * under an id minted here, so the host draws the thread at once and the
 * send answers that id before the service does, and under a key kept for as
 * long as the words stand, so the same words sent again after a lost answer
 * start one thread. The words typed are kept for the block until they are
 * sent, so a new comment opened again on the block opens on them; a
 * refusal keeps them again with its key and why, for the field it reopens,
 * and is handed to `refused` with the id it went under.
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
  const [note, setNote] = useState(() => startDraftOf(taskId, block)?.note);
  // Note that a second tap before the screen has gone would start the thread twice, so the send in flight is held here.
  const inFlight = useRef(false);
  const quote = block?.quote;
  // The pictures held now, as the keeper last heard them, which a send carries and a refusal keeps again.
  const heldPictures = useRef<readonly HeldPicture[]>(startDraftOf(taskId, block)?.pictures ?? []);

  // Note that the pictures picked are kept with the draft's words, so a rotation or a fold never drops one.
  const pictures = useAttachedPictures(setNote, undefined, undefined, {
    held: startDraftOf(taskId, block)?.pictures ?? [],
    keep: (held) => {
      heldPictures.current = held;

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
              note: was?.note,
            },
      );
    },
  });

  // Note that a block read after the first draw takes up the draft kept for it, where nothing was typed or picked meanwhile.
  const takeUp = useEffectEvent((kept: StartDraft) => {
    setLocal((was) => (was === "" ? kept.words : was));
    setSentLocal((was) => was ?? kept.sent);
    setNote((was) => was ?? kept.note);

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
              note: was?.note,
            },
      );
    },
    [taskId, block],
  );

  return useMemo(() => {
    const send = (
      typed: string,
      refused: (start: RefusedStart, noticed: boolean) => void,
    ): string | undefined => {
      const kept = typed.trim();

      // Note that a picture still being read holds the start back, since it would land after the thread had gone without it.
      if (
        kept === "" ||
        inFlight.current ||
        pictures.reading ||
        block === undefined ||
        quote === undefined
      ) {
        return undefined;
      }

      // A picture past a bound holds the start back, saying why, as an agent's composer does.
      if (pictures.refusal !== undefined) {
        setNote(pictures.refusal);
        buzz(BUZZ.WARNING);

        return undefined;
      }

      inFlight.current = true;
      const files = pictures.files ?? [];
      const carried = heldPictures.current;
      const repeated = sameSend(sent, kept, files) ? sent : undefined;

      const start: SentStart = {
        words: kept,
        files,
        key: repeated?.key ?? randomUUID(),
        threadId: repeated?.threadId ?? randomUUID(),
      };

      setSentLocal(start);
      setNote(undefined);

      // Note that the draft goes as the send does, since the thread opens in the field's place; a refusal keeps it again below, so whichever field opens next on this block opens on the words under the same key.
      if (startDraftOf(taskId, block) !== undefined) keepStartDraft(taskId, block, undefined);

      void write(
        () =>
          acts[ACT_KIND.TASKS_COMMENT_START]({
            taskId: taskId,
            start: {
              id: start.threadId,
              clientKey: start.key,
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
          inPlace: (why, noticed) => {
            const now = heldDraftAt(taskId, block);

            // Note that words typed toward this block since the send, in a field opened on it again, are kept over the refused ones, and so is a draft another block's words now stand under at these offsets; an earlier refusal's draft on this block gives way to this one.
            const ours =
              now === undefined ||
              (now.quote === quote && (now.sent !== undefined || now.words.trim() === ""));

            if (ours) {
              keepStartDraft(taskId, block, {
                quote,
                words: kept,
                pictures: carried,
                sent: start,
                note: why,
              });
            }

            refused({ ...start, note: why }, noticed);
          },
          went: BUZZ.SUCCESS,
        },
      ).finally(() => {
        inFlight.current = false;
      });

      return start.threadId;
    };

    return {
      words,
      onWords: setWords,
      pictures,
      sendable: words.trim() !== "" && quote !== undefined && !pictures.reading,
      send,
      note,
    };
  }, [acts, write, taskId, text, block, quote, words, setWords, sent, note, pictures]);
}
