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
 */

import type { DescriptionBlock } from "@repo/features/description-blocks";
import { COMMENT_NOTE, commentRefusalNote } from "@repo/features/description-comment-notes";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentEntry,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { COMMENT_SUBJECT } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { BUZZ, type ThreadMessage } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import type { PictureOf } from "../member-pictures.js";
import { useWrite } from "../use-write.js";

/** No threads read yet. */
const NO_THREADS: readonly DescriptionCommentThread[] = [];

/** What an entry says of who wrote it where its writer's account is gone. */
const SOMEONE = "Someone";

/**
 * A new thread's draft kept beside its block: the words typed, the start
 * sent under them that the service refused or never answered, so the same
 * words sent again go under the same key, and why it did not go.
 */
type StartDraft = {
  readonly words: string;
  readonly sent: SentStart | undefined;
  readonly note?: string | undefined;
};

/**
 * Each new thread's draft, by the task, then the block's start and end, so
 * it outlives the screen that drew it, as a rotation hands a new comment
 * between a split view's detail and its tab's stack, each drawing its own
 * screen.
 */
const startDrafts = new Map<string, Map<number, Map<number, StartDraft>>>();

/** The draft kept toward a new thread on one block of a task; none kept, or no block yet read. */
function startDraftOf(taskId: string, block: DescriptionBlock | undefined): StartDraft | undefined {
  if (block === undefined) return undefined;

  return startDrafts.get(taskId)?.get(block.from)?.get(block.to);
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

/** A thread's comments as its page draws them, each by its writer, its words typed line by line; the files a comment carries are left to the desktop and the web. */
export function threadMessages(
  thread: DescriptionCommentThread,
  agentNames: ReadonlyMap<string, string>,
  pictureOf: PictureOf,
): readonly ThreadMessage[] {
  return threadComments(thread).map((entry) => ({
    id: entry.id,
    writer: writerOf(entry, agentNames, pictureOf),
    at: entry.at,
    words: entry.words ?? "",
    typed: entry.writer.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER,
    media: [],
  }));
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
  const [note, setNote] = useState<string | undefined>(undefined);

  return useMemo(() => {
    const send = () => {
      const kept = words.trim();

      if (kept === "") return;
      const key = sent.current?.words === kept ? sent.current.key : randomUUID();
      sent.current = { words: kept, key };
      setNote(undefined);
      setWords("");
      // Note that a reply refused says why under the box, where its words go back, rather than in the notice.
      write(
        () =>
          acts[ACT_KIND.TASKS_COMMENT_ACT]({
            taskId: taskId,
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
      ).then((went) => {
        // Note that a reply answered after a later one went lets go of its key only while it is still the one held.
        if (went && sent.current?.key === key) sent.current = undefined;
      });
    };

    return {
      words,
      onWords: setWords,
      sendable: words.trim() !== "",
      send,
      note,
    };
  }, [acts, write, taskId, threadId, words, note]);
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
  readonly sendable: boolean;
  readonly send: (refused: (start: RefusedStart, noticed: boolean) => void) => string | undefined;
  readonly note: string | undefined;
}

/** A start sent and not yet answered as posted: its words, the key it went under, and the thread's id it named. */
export interface SentStart extends SentReply {
  readonly threadId: string;
}

/** A start the service refused or never answered: what was sent, and why it did not go. */
export interface RefusedStart extends SentStart {
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
 * sent, so a new comment handed to another screen by a rotation opens on
 * them; a refusal keeps them again with its key and why, for the field it
 * reopens, and is handed to `refused` with the id it went under.
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

  // Note that a block read after the first draw takes up the draft kept for it, where nothing was typed meanwhile.
  useEffect(() => {
    const kept = startDraftOf(taskId, block);

    if (kept === undefined) return;
    setLocal((was) => (was === "" ? kept.words : was));
    setSentLocal((was) => was ?? kept.sent);
    setNote((was) => was ?? kept.note);
  }, [taskId, block]);

  const setWords = useCallback(
    (next: string) => {
      setLocal(next);

      if (block === undefined) return;
      const was = startDraftOf(taskId, block);

      keepStartDraft(
        taskId,
        block,
        next === "" && was?.sent === undefined
          ? undefined
          : { words: next, sent: was?.sent, note: was?.note },
      );
    },
    [taskId, block],
  );

  return useMemo(() => {
    const send = (refused: (start: RefusedStart, noticed: boolean) => void): string | undefined => {
      const kept = words.trim();

      if (kept === "" || inFlight.current || block === undefined || quote === undefined) {
        return undefined;
      }

      inFlight.current = true;
      const repeated = sent?.words === kept ? sent : undefined;

      const start: SentStart = {
        words: kept,
        key: repeated?.key ?? randomUUID(),
        threadId: repeated?.threadId ?? randomUUID(),
      };

      setSentLocal(start);
      setNote(undefined);
      // Note that the draft goes as the send does, since the thread opens in the field's place; a refusal keeps it again below, so whichever field opens next, on this block, after a rotation or in a split view's detail, opens on the words under the same key.
      keepStartDraft(taskId, block, undefined);

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
          inPlace: (why, noticed) => {
            const now = startDraftOf(taskId, block);

            // Note that words typed toward this block since the send, in a field opened on it again, are kept over the refused ones; an earlier refusal's draft gives way to this one.
            if (now === undefined || now.sent !== undefined || now.words.trim() === "") {
              keepStartDraft(taskId, block, { words: kept, sent: start, note: why });
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
      sendable: words.trim() !== "" && quote !== undefined,
      send,
      note,
    };
  }, [acts, write, taskId, text, block, quote, words, setWords, sent, note]);
}
