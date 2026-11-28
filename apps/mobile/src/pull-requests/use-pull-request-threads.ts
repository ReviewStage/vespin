/**
 * use-pull-request-threads.ts -- a pull request's review threads, as a file's diff stands them under their lines, and the member's pending review, as Finish review lists it, read from the pull request's conversation as the panel's Files changed reads them.
 *
 * The threads ride the conversation (`PULL_REQUEST_PART.CONVERSATION`), each
 * under the review it was opened in, held by the host while a screen showing
 * them is in focus (`usePullRequestParts`), as the pull request's page and a
 * thread's own screen hold it, so they share the one read.
 */

import { PULL_REQUEST_PART } from "@repo/features/agent-view";
import type { PendingReviewComment, ReviewThread } from "@repo/features/agent-wire";
import { landedAnswer } from "@repo/host/app-state-reads";
import { useMemo } from "react";
import { type PullRequestKey, usePullRequestParts } from "./use-pull-request.js";

/** The one part the threads are read from. */
const THREAD_PARTS = [PULL_REQUEST_PART.CONVERSATION] as const;

/** No threads, the same array every draw, so a diff is not read again for want of them. */
const NO_THREADS: readonly ReviewThread[] = [];

/** The review threads of the pull request `key` names, in the conversation's order; none until the conversation is read, or where its read failed. */
export function usePullRequestThreads(key: PullRequestKey): readonly ReviewThread[] {
  const conversation = landedAnswer(
    usePullRequestParts(key, THREAD_PARTS).conversation,
  )?.pullRequest;

  return useMemo(
    () => conversation?.conversation.flatMap((entry) => entry.threads ?? []) ?? NO_THREADS,
    [conversation],
  );
}

/** The member's pending review: how many comments it holds, and those read of them; none where they hold none, or before the conversation is read. */
export interface PendingReview {
  readonly comments: number;
  readonly drafts: readonly PendingReviewComment[];
}

/** The member's pending review on the pull request `key` names, read with its conversation. */
export function usePendingReview(key: PullRequestKey): PendingReview | undefined {
  const conversation = landedAnswer(
    usePullRequestParts(key, THREAD_PARTS).conversation,
  )?.pullRequest;

  return useMemo(() => {
    const pending = conversation?.pendingReview;

    return pending === undefined || pending === null || pending.comments === 0
      ? undefined
      : { comments: pending.comments, drafts: pending.drafts ?? [] };
  }, [conversation]);
}
