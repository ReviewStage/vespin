import {
  ACCOUNT_STATUS,
  type AccountSnapshot,
  signedInAccountId,
} from "@repo/credentials/snapshot";
import { COMMENT_NOTE, commentRefusalNote } from "@repo/features/description-comment-notes";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentActionRequest,
  type DescriptionCommentStart,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import { sectionAt } from "@repo/features/description-sections";
import {
  FAILURE_CONDITION,
  FAILURE_SURFACE,
  type FailureSurface,
} from "@repo/features/shown-failure";
import {
  DESCRIPTION_COMMENT_CALL_FAILURE,
  type TasksCommentAnswer,
} from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { STATUS_TONE } from "@repo/ui";
import type { DescriptionCommentsControl } from "@repo/ui/description-comments";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { DRAFT_PLACE, useDraftWriter } from "../composer-drafts.js";
import {
  type CommentSubject,
  descriptionCommentsQuery,
  descriptionCommentsRetryMutation,
} from "../live-reads.js";
import { useToast } from "../toast.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";

/**
 * use-description-comments.ts -- a description's comment threads, or one of its task's pages', as one control: held by the host while the surface shows them, and each write on its way back.
 *
 * The host follows the subject's threads while a surface holds them
 * (`LIVE_READ.DESCRIPTION_COMMENTS`) and lays them on app state, so a teammate's
 * comment or an agent's reply lands in every open window, and a surface
 * drawn again draws them in its first frame. A read that did not answer
 * says so, with Try again.
 *
 * Every write is drawn by the host over the held threads the moment it is
 * asked (`@repo/host`'s `description-comment-writes.ts`), a thread started among
 * them under the id its caller minted, and stands until the read carries
 * it, so nothing here waits on one. A thread started on the description is
 * drawn here too, in the frame it is asked, until the host's answer comes
 * back across the act port, by which time the host draws it, so its words
 * and its card never stand unmarked between the two. A thread is started, and each comment
 * posted, under a key the caller keeps for as long as its words stand, so a
 * write sent again after a lost answer is taken once. A write that did not
 * land is taken back by the host: a reply's is said on its thread, its words
 * kept by its field, and any other's in a toast, since what it was pressed
 * on may have closed or gone meanwhile, an edit's words kept as its draft. Posting a comment reaches the agents
 * in its thread, the page's writer among them on a page, and one it
 * mentions, and is said on its thread where one in it could not take it.
 */

const UNANSWERED = { failure: DESCRIPTION_COMMENT_CALL_FAILURE.UNANSWERED } as const;

/** No threads, while a read has not answered. */
const NO_THREADS: readonly DescriptionCommentThread[] = [];

/** What a comment's answer says of the agents its mentions asked who could not take the thread; nothing where every one did. */
function unsentWords(answer: TasksCommentAnswer): string | undefined {
  const unsent = "thread" in answer ? (answer.unsent ?? []) : [];

  return unsent.length === 0 ? undefined : COMMENT_NOTE.AGENT_AWAY;
}

/**
 * A thread started on the description as the host draws it before the
 * service answers: open, its one comment the member's; none for a page's,
 * for a start naming no id, or where the window names no member, which the
 * host draws alone.
 */
function startedThread(
  start: DescriptionCommentStart,
  account: AccountSnapshot | undefined,
  at: number,
): DescriptionCommentThread | undefined {
  if ("page" in start || start.id === undefined) return undefined;
  const userId = signedInAccountId(account);
  const name = account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.name : undefined;

  if (userId === undefined || name === undefined) return undefined;

  return {
    id: start.id,
    scope: start.scope,
    quote: start.quote,
    anchor: start.anchor,
    section: sectionAt(start.text, start.anchor.from),
    status: DESCRIPTION_COMMENT_STATUS.OPEN,
    entries: [
      {
        id: start.clientKey,
        kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
        writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: { userId, name } },
        words: start.words,
        at,
      },
    ],
    createdAt: at,
    updatedAt: at,
    revision: 0,
  };
}

/** Where a write's refusal is reported, by what it did. */
function surfaceOf(action: DescriptionCommentActionRequest["action"]): FailureSurface {
  switch (action) {
    case DESCRIPTION_COMMENT_ACTION.REPLY:
      return FAILURE_SURFACE.DESCRIPTION_COMMENT_SEND;
    case DESCRIPTION_COMMENT_ACTION.EDIT:
      return FAILURE_SURFACE.DESCRIPTION_COMMENT_EDIT;
    case DESCRIPTION_COMMENT_ACTION.DELETE:
    case DESCRIPTION_COMMENT_ACTION.DELETE_THREAD:
      return FAILURE_SURFACE.DESCRIPTION_COMMENT_DELETE;
    case DESCRIPTION_COMMENT_ACTION.RESOLVE:
      return FAILURE_SURFACE.DESCRIPTION_THREAD_RESOLVE;
    case DESCRIPTION_COMMENT_ACTION.REOPEN:
      return FAILURE_SURFACE.DESCRIPTION_THREAD_REOPEN;
  }
}

/**
 * The description's comments, or one of its task's pages' where the subject names
 * one, held while a subject is named: the threads, and the doors that write
 * them, each answered as the service holds the thread after it.
 */
export function useDescriptionComments(
  subject: CommentSubject | undefined,
): DescriptionCommentsControl | undefined {
  const read = useQuery(descriptionCommentsQuery(subject));
  const { mutate: retryComments } = useMutation(descriptionCommentsRetryMutation());
  const { mutateAsync: sendStart } = useMutation(actMutation(ACT_KIND.TASKS_COMMENT_START));
  const { mutateAsync: sendCommentAct } = useMutation(actMutation(ACT_KIND.TASKS_COMMENT_ACT));
  const toast = useToast();
  const drafts = useDraftWriter();
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map());
  // The threads started here that the host's answer has not come back for yet, drawn over the read's.
  const [drawing, setDrawing] = useState<readonly DescriptionCommentThread[]>([]);
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const taskId = subject?.taskId;

  /** Says in a toast that a write the host drew was taken back, and why. */
  const takenBack = useCallback(
    (words: string, surface: FailureSurface, answer: TasksCommentAnswer) =>
      toast({
        replayUnmasked: true,
        words,
        tone: STATUS_TONE.DANGER,
        failure: {
          surface,
          cause: "refused" in answer ? FAILURE_CONDITION.REFUSED : FAILURE_CONDITION.NOT_KEPT,
          about: { taskId: taskId },
        },
      }),
    [toast, taskId],
  );

  const note = useCallback((threadId: string, words: string | undefined) => {
    setNotes((was) => {
      const next = new Map(was);

      if (words === undefined) next.delete(threadId);
      else next.set(threadId, words);

      return next;
    });
  }, []);

  const start = useCallback(
    async (begun: DescriptionCommentStart) => {
      if (taskId === undefined) return { note: COMMENT_NOTE.NOT_POSTED };
      const drawn = startedThread(begun, account, Date.now());

      if (drawn !== undefined) setDrawing((was) => [...was, drawn]);

      const answer = await sendStart({ taskId, start: begun }).catch(
        (): TasksCommentAnswer => UNANSWERED,
      );

      // Note that the host drew the thread before it answered, or took it back where it was refused, so its own draw takes over.
      if (drawn !== undefined) setDrawing((was) => was.filter((each) => each !== drawn));

      if (!("thread" in answer)) {
        const words =
          "refused" in answer ? commentRefusalNote(answer.refused) : COMMENT_NOTE.NOT_POSTED;

        takenBack(words, FAILURE_SURFACE.DESCRIPTION_COMMENT_SEND, answer);

        return { note: words };
      }

      note(answer.thread.id, unsentWords(answer));

      return { thread: answer.thread };
    },
    [taskId, account, sendStart, note, takenBack],
  );

  const act = useCallback(
    async (threadId: string, action: DescriptionCommentActionRequest): Promise<boolean> => {
      if (taskId === undefined) return false;
      note(threadId, undefined);

      const answer = await sendCommentAct({ taskId, threadId, action }).catch(
        (): TasksCommentAnswer => UNANSWERED,
      );

      if ("thread" in answer || "deleted" in answer) {
        note(threadId, unsentWords(answer));

        return true;
      }

      const reply = action.action === DESCRIPTION_COMMENT_ACTION.REPLY;

      const words =
        "refused" in answer
          ? commentRefusalNote(answer.refused)
          : reply
            ? COMMENT_NOTE.NOT_POSTED
            : COMMENT_NOTE.NOT_CHANGED;

      // Note that a reply's refusal is said under its field, which its words go back into.
      if (reply) note(threadId, words);
      else takenBack(words, surfaceOf(action.action), answer);

      // Note that an edit's field closed as it was sent, so its words go back to its draft, which Edit opens on.
      if (action.action === DESCRIPTION_COMMENT_ACTION.EDIT) {
        drafts.update(
          {
            kind: DRAFT_PLACE.DESCRIPTION_COMMENT,
            taskId,
            on: { threadId, entryId: action.entry },
          },
          (was) => ({ ...was, text: action.words }),
        );
      }

      return false;
    },
    [taskId, sendCommentAct, note, takenBack, drafts],
  );

  const held = read.data;

  // Note that a thread the read holds already is drawn as the read holds it.
  const rows = useMemo(() => {
    const extra = drawing.filter((each) => !held?.some((row) => row.id === each.id));

    return extra.length === 0 ? held : [...(held ?? NO_THREADS), ...extra];
  }, [held, drawing]);

  const { isSuccess, isError } = read;
  // Note that Try again moves with the subject alone, as the read's own did, since a render builds it anew.
  const pageId = subject?.pageId;

  const retry = useCallback(() => {
    if (taskId === undefined) return;
    retryComments(pageId === undefined ? { taskId: taskId } : { taskId: taskId, pageId });
  }, [retryComments, taskId, pageId]);

  return useMemo(
    () =>
      taskId === undefined
        ? undefined
        : {
            taskId,
            threads: rows ?? NO_THREADS,
            read: isSuccess,
            failed: isError,
            onRetry: retry,
            notes,
            start,
            act,
          },
    [taskId, rows, isSuccess, isError, retry, notes, start, act],
  );
}
