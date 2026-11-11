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
 * Starting a thread needs words of the description chosen, which the app's
 * read-only description has no selection for, so it is left to the desktop
 * and the web.
 */

import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
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
import { useMemo, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useWrite } from "../use-write.js";

/** No threads read yet. */
const NO_THREADS: readonly DescriptionCommentThread[] = [];

/** What an entry says of who wrote it where its writer's account is gone. */
const SOMEONE = "Someone";

/** What a reply that did not land says under the field, as the panel's thread says it. */
const NOT_POSTED = "The comment could not be posted.";

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

/** Who wrote an entry, as the panel's thread names them: a member by their name, the app by its own, and a coding agent by the name its task lists it under. */
function writerOf(
  entry: DescriptionCommentEntry,
  agentNames: ReadonlyMap<string, string>,
): ThreadMessage["writer"] {
  const { writer } = entry;
  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.APP) return { name: PRODUCT_NAME, agent: true };
  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.AGENT) {
    const named = writer.agentId === undefined ? undefined : agentNames.get(writer.agentId);
    return { name: named ?? PRODUCT_NAME, agent: true };
  }
  return { name: writer.by?.name ?? SOMEONE, agent: false };
}

/** A thread's comments as its page draws them, each by its writer, its words typed line by line; the files a comment carries are left to the desktop and the web. */
export function threadMessages(
  thread: DescriptionCommentThread,
  agentNames: ReadonlyMap<string, string>,
): readonly ThreadMessage[] {
  return threadComments(thread).map((entry) => ({
    id: entry.id,
    writer: writerOf(entry, agentNames),
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
          refused: (answer) => ("thread" in answer ? undefined : NOT_POSTED),
          unanswered: NOT_POSTED,
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
